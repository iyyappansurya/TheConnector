// src/utils/webhookAuth.js
// Verifies Meta webhook signature using X-Hub-Signature-256 header.
// Rejects unsigned or tampered payloads with 401.

const crypto = require('crypto');
const logger = require('./logger');

/**
 * Express middleware to verify Meta webhook signatures.
 * Must be applied BEFORE JSON body parsing, using raw body.
 *
 * @param {object} req
 * @param {object} res
 * @param {function} next
 */
function verifyWebhookSignature(req, res, next) {
  // Skip verification for GET requests (webhook verification pings)
  if (req.method === 'GET') {
    return next();
  }

  const appSecret = process.env.WHATSAPP_APP_SECRET;

  // If no app secret configured, log warning and allow (development mode)
  if (!appSecret) {
    logger.warn('webhookAuth', 'WHATSAPP_APP_SECRET not set — skipping signature verification. NOT SAFE FOR PRODUCTION.');
    return next();
  }

  const signature = req.headers['x-hub-signature-256'];
  if (!signature) {
    logger.warn('webhookAuth', 'Missing X-Hub-Signature-256 header — rejecting request');
    return res.status(401).send('Missing signature');
  }

  const rawBody = req.rawBody;
  if (!rawBody) {
    logger.warn('webhookAuth', 'No raw body available for signature verification');
    return res.status(401).send('Cannot verify signature');
  }

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  const isValid = crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );

  if (!isValid) {
    logger.warn('webhookAuth', 'Invalid webhook signature — rejecting request');
    return res.status(401).send('Invalid signature');
  }

  next();
}

module.exports = { verifyWebhookSignature };
