import { Bot, webhookCallback } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';
import { setupHandlers, MyContext } from './bot/handlers';

export interface Env {
  BOT_TOKEN: string;
  DB: D1Database;
  QUEUE: Queue;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    try {
      const bot = new Bot<MyContext>(env.BOT_TOKEN);
      
      // Use auto-retry plugin to handle Telegram 429 errors
      bot.api.config.use(autoRetry());
      
      // Middleware to inject D1 database, Queue, and waitUntil into context
      bot.use(async (botCtx, next) => {
        botCtx.db = env.DB;
        botCtx.queue = env.QUEUE;
        botCtx.waitUntil = ctx.waitUntil.bind(ctx);
        await next();
      });

      setupHandlers(bot);
      
      // Create a webhook callback handle
      const handleUpdate = webhookCallback(bot, 'cloudflare-mod');
      
      return await handleUpdate(request);
    } catch (err: any) {
      console.error(err);
      return new Response(err.message, { status: 500 });
    }
  },
  
  async queue(batch: MessageBatch<any>, env: Env): Promise<void> {
    const bot = new Bot(env.BOT_TOKEN);
    bot.api.config.use(autoRetry());
    
    for (const message of batch.messages) {
      const { userId, text } = message.body;
      try {
        await bot.api.sendMessage(userId, text);
        message.ack(); // Acknowledge successful delivery
      } catch (err: any) {
        console.error(`Failed to send message to ${userId}:`, err);
        // If it's a block/deactivated user error, we could acknowledge and ignore it,
        // but for now let's retry if it's transient, or ack if it's permanent.
        if (err.error_code === 403) {
            // User blocked the bot, acknowledge to avoid retries
            message.ack();
        } else {
            message.retry();
        }
      }
    }
  }
};
