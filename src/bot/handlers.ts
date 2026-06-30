import { Bot, Context } from 'grammy';
import {
  createUser,
  getUser,
  getSession,
  setSessionState,
  updateUserVerified,
  addBalance,
  updateLastBonus,
  getReferralCount,
  getReferralCount,
  getTopReferrers,
  getAllUserIds,
  claimBonus
} from '../db/queries';
import { mainMenu, joinChannelsKeyboard, captchaKeyboard, CHANNELS } from './menus';
import { generateCaptcha } from '../utils/captcha';

export type MyContext = Context & { db: D1Database, queue: Queue, waitUntil: (promise: Promise<any>) => void };

const SIGNUP_BONUS = 0.000001; // BNB
const DAILY_BONUS = 0.000001;
const MIN_WITHDRAWAL = 30; // $30 equivalent

export function setupHandlers(bot: Bot<MyContext>) {
  // Global error boundary
  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`);
    const e = err.error;
    console.error(e);
  });

  // --- Middleware for DB injection is expected to be added before these handlers ---

  bot.command('start', async (ctx) => {
    if (!ctx.from) return;
    const userId = ctx.from.id;
    const firstName = ctx.from.first_name;
    const username = ctx.from.username || '';
    const refParam = ctx.match; // e.g. /start 123456

    let referredBy = undefined;
    if (refParam && !isNaN(Number(refParam)) && Number(refParam) !== userId) {
      referredBy = Number(refParam);
    }

    const user = await getUser(ctx.db, userId);
    
    if (!user) {
      try {
        await createUser(ctx.db, userId, firstName, username, referredBy);
        await addBalance(ctx.db, userId, SIGNUP_BONUS);
        await ctx.reply(`You just earned a bonus of ${SIGNUP_BONUS} BNB for joining us!.`);
      } catch (e: any) {
        // If referred_by FK fails, fallback to creating without referrer
        if (e.message?.includes('FOREIGN KEY constraint failed')) {
          await createUser(ctx.db, userId, firstName, username, undefined);
          await addBalance(ctx.db, userId, SIGNUP_BONUS);
          await ctx.reply(`You just earned a bonus of ${SIGNUP_BONUS} BNB for joining us!.`);
        } else {
          throw e; // Rethrow other errors
        }
      }
    }

    ctx.waitUntil(setSessionState(ctx.db, userId, 'awaiting_channels'));
    
    await ctx.reply('💡 You must join all our channels to continue.', {
      reply_markup: joinChannelsKeyboard()
    });
  });

  bot.command('broadcast', async (ctx) => {
    if (!ctx.from) return;
    const user = await getUser(ctx.db, ctx.from.id);
    
    if (!user?.is_admin) {
      return ctx.reply('You are not authorized to use this command.');
    }

    const message = ctx.match;
    if (!message) {
      return ctx.reply('Please provide a message to broadcast.\nUsage: /broadcast Hello everyone!');
    }

    await ctx.reply('Started broadcasting message...');
    
    let offset = 0;
    const limit = 500;
    let totalQueued = 0;
    
    while (true) {
      const userIds = await getAllUserIds(ctx.db, limit, offset);
      if (userIds.length === 0) break;
      
      const batchSize = 100;
      for (let i = 0; i < userIds.length; i += batchSize) {
        const batch = userIds.slice(i, i + batchSize).map(id => ({
          body: { userId: id, text: message }
        }));
        await ctx.queue.sendBatch(batch);
      }
      
      totalQueued += userIds.length;
      offset += limit;
    }
    
    await ctx.reply(`Broadcast queued for ${totalQueued} users.`);
  });

  bot.callbackQuery('action_all_joined', async (ctx) => {
    if (!ctx.from) return;
    const userId = ctx.from.id;
    
    // Optional: Actually verify channel membership here using ctx.api.getChatMember
    // For simplicity, we assume they joined or we just generate the captcha
    /*
    for (const channel of CHANNELS) {
      try {
        const member = await ctx.api.getChatMember('@drkingbd', userId);
        if (member.status === 'left' || member.status === 'kicked') {
           return ctx.reply('You have not joined all channels!');
        }
      } catch (e) {
        // Bot is not admin or channel invalid
      }
    }
    */

    const captcha = generateCaptcha();
    await setSessionState(ctx.db, userId, 'awaiting_captcha', captcha.emoji);
    
    await ctx.editMessageText(`Please select the emoji **${captcha.emoji}** to continue.\n\nChoose from the options below:`, {
      reply_markup: captchaKeyboard(captcha.options),
      parse_mode: 'Markdown'
    });
  });

  bot.callbackQuery(/^captcha_(.+)$/, async (ctx) => {
    if (!ctx.from) return;
    const userId = ctx.from.id;
    const selectedEmoji = ctx.match[1];
    
    const session = await getSession(ctx.db, userId);
    
    if (!session || session.state !== 'awaiting_captcha') {
      return ctx.answerCallbackQuery('Session expired. Please /start again.');
    }

    if (session.pending_captcha_emoji === selectedEmoji) {
      await updateUserVerified(ctx.db, userId, true);
      await setSessionState(ctx.db, userId, 'main_menu');
      await ctx.answerCallbackQuery('Captcha correct!');
      await ctx.editMessageText('Verification successful! Welcome to BNB Rush 💪');
      await ctx.reply('Main Menu:', { reply_markup: mainMenu });
    } else {
      // Wrong captcha, generate a new one
      const newCaptcha = generateCaptcha();
      await setSessionState(ctx.db, userId, 'awaiting_captcha', newCaptcha.emoji);
      await ctx.answerCallbackQuery('Wrong emoji! Try again.');
      await ctx.editMessageText(`Wrong! Please select the emoji **${newCaptcha.emoji}** to continue.`, {
        reply_markup: captchaKeyboard(newCaptcha.options),
        parse_mode: 'Markdown'
      });
    }
  });

  // --- Main Menu Handlers ---
  
  // Middleware to enforce verification for main menu commands
  const requireVerified = async (ctx: MyContext, next: () => Promise<void>) => {
    if (!ctx.from) return;
    const user = await getUser(ctx.db, ctx.from.id);
    if (!user?.is_verified) {
      return ctx.reply('Please /start and complete verification first.');
    }
    await next();
  };

  bot.hears('💰 Balance', requireVerified, async (ctx) => {
    const user = await getUser(ctx.db, ctx.from!.id);
    await ctx.reply(
      `💰 **Your Balance:**\n\n` +
      `Balance: ${user?.balance.toFixed(6)} BNB\n` +
      `Min. withdrawal is $${MIN_WITHDRAWAL} (equivalent)`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.hears('🔗 Ref Stats', requireVerified, async (ctx) => {
    const userId = ctx.from!.id;
    const refCount = await getReferralCount(ctx.db, userId);
    const botInfo = await ctx.api.getMe();
    const refLink = `https://t.me/${botInfo.username}?start=${userId}`;
    
    await ctx.reply(
      `🔗 **Referral Statistics**\n\n` +
      `You have invited: ${refCount} users\n\n` +
      `Your Referral Link:\n${refLink}`,
      { parse_mode: 'Markdown' }
    );
  });

  bot.hears('🤑 Withdraw', requireVerified, async (ctx) => {
    const user = await getUser(ctx.db, ctx.from!.id);
    // Assuming BNB is roughly $600 for simplicity in display, or just sticking to a static message
    await ctx.reply(`😔 To withdraw, you need at least $${MIN_WITHDRAWAL} in equivalent balance.\nInvite your friends to get more!`);
  });

  bot.hears('💲 Earn More', requireVerified, async (ctx) => {
    await ctx.reply('Invite friends to earn more! Use the 🔗 Ref Stats button to get your link.');
  });

  bot.hears('🥳 Bonus', requireVerified, async (ctx) => {
    const userId = ctx.from!.id;
    const now = Date.now();
    
    // claimBonus will only succeed if 24 hours have passed since last_bonus_at
    const success = await claimBonus(ctx.db, userId, DAILY_BONUS, now);

    if (success) {
      await ctx.reply(`🎉 You received a daily bonus of ${DAILY_BONUS} BNB!`);
    } else {
      const user = await getUser(ctx.db, userId);
      if (user) {
         const nextBonus = new Date(user.last_bonus_at + (24 * 60 * 60 * 1000));
         await ctx.reply(`You've already claimed your daily bonus!\nCome back at: ${nextBonus.toLocaleString()}`);
      }
    }
  });

  bot.hears('🏆 Ref Contest', requireVerified, async (ctx) => {
    const top = await getTopReferrers(ctx.db, 10);
    let msg = `🏆 **Referral Contest** 🏆\n\n`;
    
    if (top.length === 0) {
      msg += `No participants yet!`;
    } else {
      top.forEach((u, i) => {
        msg += `${i + 1}. User ${u.id.toString().substring(0, 6)}XXXX - ${u.ref_count} refs\n`;
      });
    }
    
    const myRank = await getReferralCount(ctx.db, ctx.from!.id);
    msg += `\n👑 **You - ${myRank} refs**`;
    
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  });
}
