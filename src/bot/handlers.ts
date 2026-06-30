import { Bot, Context } from 'grammy';
import {
  createUser,
  getUser,
  getSession,
  setSessionState,
  updateUserVerified,
  addBalance,
  getReferralCount,
  getTopReferrers,
  getAllUserIds,
  claimBonus,
  deductBalance,
  createWithdrawal
} from '../db/queries';
import { mainMenu, joinChannelsKeyboard, captchaKeyboard, CHANNELS } from './menus';
import { generateCaptcha } from '../utils/captcha';

export type MyContext = Context & { db: D1Database, queue: Queue, waitUntil: (promise: Promise<any>) => void };

const SIGNUP_BONUS = 0.000001; // BNB
const DAILY_BONUS = 0.000001;
const MIN_WITHDRAWAL_BNB = 0.05; // ~ $30 equivalent

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
    
    // Verify channel membership
    for (const channel of CHANNELS) {
      try {
        const member = await ctx.api.getChatMember(channel.name.toLowerCase() === 'drkingbd' ? '@drkingbd' : channel.url, userId);
        if (member.status === 'left' || member.status === 'kicked') {
           return ctx.reply(`❌ You have not joined ${channel.name}! Please join and click "✅ All Joined" again.`);
        }
      } catch (e: any) {
        // Log the error but don't crash. If bot is not admin, it will fail here.
        console.error(`Failed to check membership for ${channel.name}:`, e.message);
        // For strict force join, if we can't verify, we should probably tell the user or admin.
        // We will assume they haven't joined if we get an error (e.g. chat not found/bot not admin)
        return ctx.reply(`⚠️ I cannot verify your membership in ${channel.name} right now. Please ensure I am an admin in the channel.`);
      }
    }

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
      `Min. withdrawal is ${MIN_WITHDRAWAL_BNB} BNB (~$30)`,
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
    if (!user) return;

    if (user.balance >= MIN_WITHDRAWAL_BNB) {
      await setSessionState(ctx.db, user.id, 'awaiting_wallet_address');
      await ctx.reply(`🏦 **Withdrawal**\n\nYou have ${user.balance.toFixed(6)} BNB available.\n\nPlease reply with your Binance Smart Chain (BEP-20) wallet address:`, { parse_mode: 'Markdown' });
    } else {
      await ctx.reply(`😔 To withdraw, you need at least ${MIN_WITHDRAWAL_BNB} BNB.\nInvite your friends to earn more!`);
    }
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

  // --- General Text Handler for Sessions ---
  bot.on('message:text', async (ctx) => {
    if (!ctx.from) return;
    const userId = ctx.from.id;
    const session = await getSession(ctx.db, userId);

    if (session && session.state === 'awaiting_wallet_address') {
      const walletAddress = ctx.message.text.trim();
      
      // Basic validation for BSC/ETH address
      if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
        return ctx.reply('⚠️ Invalid wallet address format. Please provide a valid BEP-20 (BSC) address starting with 0x.');
      }

      const user = await getUser(ctx.db, userId);
      if (!user) return;

      if (user.balance < MIN_WITHDRAWAL_BNB) {
        await setSessionState(ctx.db, userId, 'main_menu');
        return ctx.reply('❌ You no longer have enough balance to withdraw.');
      }

      // Deduct full balance
      const withdrawAmount = user.balance;
      const success = await deductBalance(ctx.db, userId, withdrawAmount);

      if (success) {
        await createWithdrawal(ctx.db, userId, withdrawAmount, walletAddress);
        await setSessionState(ctx.db, userId, 'main_menu');
        await ctx.reply(`✅ **Withdrawal Requested!**\n\nAmount: ${withdrawAmount.toFixed(6)} BNB\nAddress: \`${walletAddress}\`\n\nYour request has been recorded and is pending review.`, { parse_mode: 'Markdown' });
      } else {
        await ctx.reply('❌ Failed to process withdrawal. Please try again later.');
      }
    }
  });
}
