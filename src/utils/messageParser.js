// src/utils/messageParser.js
// Extracts message type, body, and sender from the Gupshup webhook payload.
//
// Gupshup wraps the actual message inside payload.payload (double-nested).
// This module normalises that into a clean flat object.

/**
 * Parse an inbound Gupshup webhook payload.
 *
 * @param {object} body — req.body from Express
 * @returns {{ senderNumber: string, messageType: string, messageText: string, messageId: string } | null}
 */
const PROVIDER = process.env.WA_PROVIDER || 'gupshup';

function parseInbound(body) {
  try {
    if (PROVIDER === 'meta') {
      return parseMetaInbound(body);
    }
    // Gupshup sends the type at the top level (e.g. "message", "message-event")
    const eventType = body.type;

    // We only care about actual messages, not delivery/read events
    if (eventType !== 'message') {
      console.log(`[messageParser] Ignoring non-message event: ${eventType}`);
      return null;
    }

    // Gupshup nests the message content inside payload.payload
    const outerPayload = body.payload;
    if (!outerPayload) {
      console.log('[messageParser] No payload found in body');
      return null;
    }

    const senderNumber = outerPayload.sender?.phone || outerPayload.source || '';
    const messageId = outerPayload.id || '';

    // The actual message content is in payload.payload (the inner payload)
    const innerPayload = outerPayload.payload;
    if (!innerPayload) {
      console.log('[messageParser] No inner payload found');
      return null;
    }

    // Determine message type and extract text
    let messageType = 'text';
    let messageText = '';

    if (typeof innerPayload === 'string') {
      // Sometimes Gupshup sends the inner payload as a JSON string
      try {
        const parsed = JSON.parse(innerPayload);
        return extractFromParsedPayload(parsed, senderNumber, messageId);
      } catch {
        // It's a plain text string
        messageType = 'text';
        messageText = innerPayload;
      }
    } else if (typeof innerPayload === 'object') {
      return extractFromParsedPayload(innerPayload, senderNumber, messageId);
    }

    return { senderNumber, messageType, messageText, messageId };
  } catch (err) {
    console.error('[messageParser] Error parsing inbound message:', err.message);
    return null;
  }
}

/**
 * Parses native Meta Cloud API incoming webhooks.
 */
function parseMetaInbound(body) {
  try {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];

    if (!message) return null; // Likely a status update, ignore

    const senderNumber = message.from || '';
    const messageId = message.id || '';
    const type = message.type || 'text';

    let messageType = type;
    let messageText = '';

    if (type === 'text') {
      messageText = message.text?.body || '';
    } else if (type === 'interactive') {
      messageType = 'button_reply';
      messageText = message.interactive?.button_reply?.title || '';
    }

    return { senderNumber, messageType, messageText, messageId };
  } catch (err) {
    console.error('[messageParser] Error parsing Meta message:', err.message);
    return null;
  }
}

/**
 * Extract message fields from a parsed inner payload object.
 */
function extractFromParsedPayload(payload, senderNumber, messageId) {
  const type = payload.type || 'text';
  let messageType = 'text';
  let messageText = '';

  if (type === 'text') {
    messageType = 'text';
    messageText = payload.text || payload.body || '';
  } else if (type === 'quick_reply' || type === 'button_reply') {
    // Button reply from interactive quick_reply buttons
    messageType = 'button_reply';
    messageText = payload.title || payload.text || payload.body || payload.id || '';
  } else if (type === 'interactive') {
    messageType = 'interactive';
    messageText = payload.title || payload.text || payload.body || '';
  } else {
    // Fallback — treat as text with whatever content is available
    messageType = type;
    messageText = payload.text || payload.body || payload.title || '';
  }

  return { senderNumber, messageType, messageText, messageId };
}

module.exports = { parseInbound };
