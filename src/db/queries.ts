export interface User {
  id: number;
  first_name: string;
  username: string;
  balance: number;
  referred_by: number | null;
  is_verified: boolean;
  is_admin: boolean;
  last_bonus_at: number;
  created_at: string;
}

export interface Session {
  id: number;
  pending_captcha_emoji: string | null;
  state: string;
}

export async function getUser(db: D1Database, userId: number): Promise<User | null> {
  return await db.prepare('SELECT * FROM users WHERE id = ?').bind(userId).first<User>();
}

export async function createUser(
  db: D1Database,
  userId: number,
  firstName: string,
  username: string,
  referredBy?: number
): Promise<void> {
  await db
    .prepare(
      'INSERT INTO users (id, first_name, username, referred_by) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING'
    )
    .bind(userId, firstName, username, referredBy || null)
    .run();
}

export async function updateUserVerified(db: D1Database, userId: number, isVerified: boolean): Promise<void> {
  await db.prepare('UPDATE users SET is_verified = ? WHERE id = ?').bind(isVerified ? 1 : 0, userId).run();
}

export async function addBalance(db: D1Database, userId: number, amount: number): Promise<void> {
  await db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').bind(amount, userId).run();
}

/**
 * Atomically attempts to claim the daily bonus.
 * @returns boolean indicating if the bonus was successfully claimed (true) or if they already claimed it (false).
 */
export async function claimBonus(db: D1Database, userId: number, amount: number, nowTimestamp: number): Promise<boolean> {
  const oneDayMs = 24 * 60 * 60 * 1000;
  const { success, meta } = await db.prepare(`
    UPDATE users 
    SET balance = balance + ?, last_bonus_at = ? 
    WHERE id = ? AND (? - last_bonus_at >= ?)
  `).bind(amount, nowTimestamp, userId, nowTimestamp, oneDayMs).run();
  
  // meta.changes contains the number of rows modified
  return success && (meta.changes > 0);
}

export async function getReferralCount(db: D1Database, userId: number): Promise<number> {
  const result = await db.prepare('SELECT COUNT(*) as count FROM users WHERE referred_by = ?').bind(userId).first<{ count: number }>();
  return result?.count || 0;
}

export async function getTopReferrers(db: D1Database, limit: number = 10): Promise<{ first_name: string; id: number; ref_count: number }[]> {
  const { results } = await db.prepare(`
    SELECT u.first_name, u.id, COUNT(r.id) as ref_count
    FROM users r
    JOIN users u ON r.referred_by = u.id
    GROUP BY r.referred_by
    ORDER BY ref_count DESC
    LIMIT ?
  `).bind(limit).all<{ first_name: string; id: number; ref_count: number }>();
  
  return results;
}

export async function getAllUserIds(db: D1Database, limit: number = 1000, offset: number = 0): Promise<number[]> {
  const { results } = await db.prepare('SELECT id FROM users ORDER BY id LIMIT ? OFFSET ?')
    .bind(limit, offset)
    .all<{ id: number }>();
  return results.map(r => r.id);
}

// Session queries
export async function getSession(db: D1Database, userId: number): Promise<Session | null> {
  return await db.prepare('SELECT * FROM sessions WHERE id = ?').bind(userId).first<Session>();
}

export async function setSessionState(db: D1Database, userId: number, state: string, pendingCaptchaEmoji: string | null = null): Promise<void> {
  await db
    .prepare(
      'INSERT INTO sessions (id, state, pending_captcha_emoji) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET state = ?, pending_captcha_emoji = ?'
    )
    .bind(userId, state, pendingCaptchaEmoji, state, pendingCaptchaEmoji)
    .run();
}

export async function clearSession(db: D1Database, userId: number): Promise<void> {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(userId).run();
}

// Withdrawal queries
export async function deductBalance(db: D1Database, userId: number, amount: number): Promise<boolean> {
  const { success, meta } = await db.prepare(`
    UPDATE users SET balance = balance - ? 
    WHERE id = ? AND balance >= ?
  `).bind(amount, userId, amount).run();
  
  return success && (meta.changes > 0);
}

export async function createWithdrawal(db: D1Database, userId: number, amount: number, address: string): Promise<void> {
  await db.prepare(`
    INSERT INTO withdrawals (user_id, amount, wallet_address)
    VALUES (?, ?, ?)
  `).bind(userId, amount, address).run();
}
