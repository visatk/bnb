import { InlineKeyboard, Keyboard } from 'grammy';

export const CHANNELS = [
  { name: 'Drkingbd', url: 'https://t.me/drkingbd' },
];

export const mainMenu = new Keyboard()
  .text('💰 Balance')
  .row()
  .text('🔗 Ref Stats').text('🤑 Withdraw')
  .row()
  .text('💲 Earn More').text('🥳 Bonus')
  .row()
  .text('🏆 Ref Contest')
  .resized();

export const joinChannelsKeyboard = () => {
  const keyboard = new InlineKeyboard();
  for (const channel of CHANNELS) {
    keyboard.url(`Join @${channel.url.split('t.me/')[1]}`, channel.url).row();
  }
  keyboard.text('All Joined', 'action_all_joined');
  return keyboard;
};

export const captchaKeyboard = (options: string[]) => {
  const keyboard = new InlineKeyboard();
  // Layout 3 emojis per row
  for (let i = 0; i < options.length; i += 3) {
    const row = options.slice(i, i + 3).map(opt => InlineKeyboard.text(opt, `captcha_${opt}`));
    keyboard.row(...row);
  }
  return keyboard;
};
