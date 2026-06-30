// A list of simple, distinct emojis for the captcha
export const EMOJIS = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '🦟', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐈‍⬛', '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔'];

export function generateCaptcha(): { emoji: string; options: string[] } {
  const options = new Set<string>();
  
  // Select a target emoji
  const targetEmoji = EMOJIS[Math.floor(Math.random() * EMOJIS.length)];
  options.add(targetEmoji);
  
  // Select 5 other random emojis for options (total 6 options)
  while (options.size < 6) {
    options.add(EMOJIS[Math.floor(Math.random() * EMOJIS.length)]);
  }
  
  // Shuffle options
  const shuffledOptions = Array.from(options).sort(() => Math.random() - 0.5);
  
  return {
    emoji: targetEmoji,
    options: shuffledOptions
  };
}
