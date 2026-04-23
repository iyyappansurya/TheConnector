// src/services/concurrencyService.js
// Provides atomic locking and idempotency tracking using Redis

const { getRedis } = require('./sessionStore'); // Need access to the single Redis client

/**
 * Ensures a webhook message is processed exactly once by setting an expiring key.
 * @param {string} messageId - The unique webhook event ID
 * @returns {Promise<boolean>} true if this is the first time processing, false if duplicate
 */
async function checkIdempotency(messageId) {
  if (!messageId) return true; // Fail open if no ID provided in payload

  const redis = getRedis();
  const key = `idempotency:${messageId}`;
  
  // Try to set key with 10 minute (600s) TTL. NX ensures we only set if it doesn't exist
  const result = await redis.set(key, '1', 'NX', 'EX', 600);
  return result === 'OK'; // OK means we acquired the lock, null means duplicate
}

/**
 * Acquires an exclusive lock for a specific patient's session.
 * @param {string} phone - Patient's WhatsApp number
 * @param {string} requestId - Unique ID for this execution context (UUID)
 * @param {number} ttlSeconds - Auto-release TTL to prevent deadlocks (default 15s)
 * @returns {Promise<boolean>} true if lock successfully acquired
 */
async function acquireLock(phone, requestId, ttlSeconds = 15) {
  if (!phone) return true;

  const redis = getRedis();
  const key = `lock:session:${phone}`;
  
  const result = await redis.set(key, requestId, 'NX', 'EX', ttlSeconds);
  return result === 'OK';
}

/**
 * Releases a session lock safely using a Lua script.
 * Only deletes the lock if the value matches our requestId,
 * ensuring we never unlock a lock held by a timed-out retry.
 * @param {string} phone - Patient's WhatsApp number
 * @param {string} requestId - Same unique ID used during acquisition
 * @returns {Promise<boolean>} true if lock was deleted
 */
async function releaseLock(phone, requestId) {
  if (!phone) return true;

  const redis = getRedis();
  const key = `lock:session:${phone}`;
  
  const luaScript = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;

  try {
    const result = await redis.eval(luaScript, 1, key, requestId);
    return result === 1;
  } catch (err) {
    console.error(`[concurrency] Error releasing lock for ${phone}:`, err.message);
    return false;
  }
}

module.exports = {
  checkIdempotency,
  acquireLock,
  releaseLock
};
