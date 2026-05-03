// src/utils/retryHelper.js
// Generic retry wrapper with exponential backoff for API calls.

const logger = require('./logger');

/**
 * Wraps an async function with retry logic and exponential backoff.
 * Only retries on network errors and 5xx server errors.
 * Does NOT retry on 4xx client errors (bad request, auth failure, etc).
 *
 * @param {function} fn — async function to execute
 * @param {number} maxRetries — maximum retry attempts (default: 3)
 * @param {number} baseDelay — initial delay in ms (default: 1000)
 * @returns {Promise<*>} — result of the function
 */
async function withRetry(fn, maxRetries = 3, baseDelay = 1000) {
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const statusCode = err.response?.status;

      // Don't retry 4xx errors — they're client-side mistakes
      if (statusCode && statusCode >= 400 && statusCode < 500) {
        throw err;
      }

      // Last attempt — don't wait, just throw
      if (attempt === maxRetries) {
        logger.error('retryHelper', `All ${maxRetries} attempts failed`, { error: err.message });
        throw err;
      }

      // Exponential backoff: 1s → 2s → 4s
      const delay = baseDelay * Math.pow(2, attempt - 1);
      logger.warn('retryHelper', `Attempt ${attempt}/${maxRetries} failed, retrying in ${delay}ms`, {
        error: err.message,
        statusCode: statusCode || 'network_error'
      });
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

module.exports = { withRetry };
