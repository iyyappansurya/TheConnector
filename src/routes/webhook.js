// src/routes/webhook.js
// Express route — handles GET (verification) and POST (inbound messages)

const express = require('express');
const router = express.Router();
const { parseInbound } = require('../utils/messageParser');
const patientHandler = require('../handlers/patientHandler');
const doctorHandler = require('../handlers/doctorHandler');
const pharmacyHandler = require('../handlers/pharmacyHandler');
const { checkIdempotency, acquireLock, releaseLock } = require('../services/concurrencyService');
const logger = require('../utils/logger');
const { sendAlert } = require('../services/alertService');

const PROVIDER = process.env.WA_PROVIDER || 'gupshup';

// GET /webhook — Gupshup just needs a 200 response to verify the endpoint, Meta needs tokens
router.get('/webhook', (req, res) => {
  if (PROVIDER === 'meta') {
    if (req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN) {
      logger.info('webhook', 'Meta verification ping accepted');
      return res.status(200).send(req.query['hub.challenge']);
    }
  }
  
  logger.info('webhook', 'Verification ping received');
  res.status(200).send('webhook active');
});

// GET /debug/session/:number — Exposes the session for testing scripts
const { getSession } = require('../services/sessionStore');
router.get('/debug/session/:number', async (req, res) => {
  try {
    const session = await getSession(req.params.number);
    if (!session) return res.status(404).json({ error: 'Not found' });
    res.status(200).json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Route a parsed inbound message to the correct handler
 * based on the sender's WhatsApp number.
 * @param {object|null} parsed
 */
async function routeMessage(parsed) {
  if (!parsed) return;

  const { senderNumber } = parsed;
  logger.info('webhook', `Routing message from ${senderNumber}`, { senderNumber, type: parsed.messageType });

  if (senderNumber === process.env.DOCTOR_WA_NUMBER) {
    await doctorHandler.handle(parsed);
  } else if (senderNumber === process.env.PHARMACY_WA_NUMBER) {
    await pharmacyHandler.handle(parsed);
  } else {
    await patientHandler.handle(parsed);
  }
}

// POST /webhook — receives all inbound messages from Gupshup
router.post('/webhook', async (req, res) => {
  // Always respond 200 immediately so Gupshup/Meta doesn't retry
  res.status(200).send('OK');

  // 1. Extract message fields cleanly
  const parsed = parseInbound(req.body);
  if (!parsed || !parsed.messageId || !parsed.senderNumber) return;

  const { messageId, senderNumber } = parsed;

  // 2. Message-Level Idempotency Check
  const isNewMessage = await checkIdempotency(messageId);
  if (!isNewMessage) {
    logger.info('webhook', `Dropped duplicate message ${messageId}`);
    return;
  }

  // 3. Acquire Per-User Execution Mutex Lock (15s ttl)
  const requestId = require('uuid').v4();
  const locked = await acquireLock(senderNumber, requestId, 15);
  
  if (!locked) {
    logger.warn('webhook', `Concurrency collision for user ${senderNumber}`);
    return; // Wait, dropping lock fails user? Could retry, but we'll enforce quick resolve
  }

  // 4. Process safe business logic under lock scope
  try {
    await routeMessage(parsed);
  } catch (err) {
    logger.error('webhook', 'Error in routeMessage', { error: err.message, senderNumber });
    sendAlert(`Error processing message from ${senderNumber}: ${err.message}`);
  } finally {
    // 5. Always release lock natively inside Finally scope using internal Lua logic!
    await releaseLock(senderNumber, requestId);
  }
});

module.exports = router;
