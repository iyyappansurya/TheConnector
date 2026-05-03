// src/services/whatsappService.js
// Wrapper for WhatsApp API — supports Meta Cloud API and Gupshup BSP.
// Swapping providers = only rewriting this file. No other module changes.

const axios = require('axios');
const { withRetry } = require('../utils/retryHelper');
const logger = require('../utils/logger');

const PROVIDER = process.env.WA_PROVIDER || 'gupshup';
const GUPSHUP_SEND_URL = 'https://api.gupshup.io/wa/api/v1/msg';

/** Helper: Meta API headers */
function metaHeaders() {
  return {
    'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
    'Content-Type': 'application/json'
  };
}

/** Helper: Meta API base URL */
function metaUrl() {
  return `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

/**
 * Send a plain text message.
 *
 * @param {string} to — recipient WA number with country code (e.g. "919XXXXXXXXX")
 * @param {string} message — text content
 */
async function sendText(to, message) {
  if (PROVIDER === 'meta') {
    return withRetry(async () => {
      const response = await axios.post(metaUrl(), {
        messaging_product: "whatsapp",
        to: to,
        type: "text",
        text: { body: message }
      }, { headers: metaHeaders() });
      logger.info('whatsappService', `sendText to ${to}: ${response.status}`);
      return response.data;
    });
  }

  // Gupshup handler
  const params = new URLSearchParams();
  params.append('channel', 'whatsapp');
  params.append('source', process.env.GUPSHUP_SOURCE_NUMBER);
  params.append('destination', to);
  params.append('src.name', process.env.GUPSHUP_APP_NAME);
  params.append('message', JSON.stringify({ type: 'text', text: message }));

  const response = await axios.post(GUPSHUP_SEND_URL, params, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'apikey': process.env.GUPSHUP_API_KEY
    }
  });
  logger.info('whatsappService', `[Gupshup] sendText to ${to}: ${response.status}`);
  return response.data;
}

/**
 * Send a quick reply button message.
 *
 * @param {string} to — recipient WA number
 * @param {string} bodyText — message body text
 * @param {string[]} buttons — array of button label strings (max 3)
 */
async function sendButtons(to, bodyText, buttons) {
  if (PROVIDER === 'meta') {
    const payload = {
      messaging_product: "whatsapp",
      to: to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: buttons.slice(0, 3).map((btn, index) => ({
            type: "reply",
            reply: { id: `btn-${index}`, title: btn }
          }))
        }
      }
    };
    try {
      const response = await withRetry(async () => {
        return await axios.post(metaUrl(), payload, { headers: metaHeaders() });
      });
      logger.info('whatsappService', `sendButtons to ${to}: ${response.status}`);
      return response.data;
    } catch (err) {
      logger.warn('whatsappService', `sendButtons failed, falling back to text`, { error: err.response?.data || err.message });
      let fallback = bodyText + '\n\nReply with the number:';
      buttons.slice(0, 3).forEach((label, index) => {
        fallback += `\n${index + 1}. ${label}`;
      });
      return await sendText(to, fallback);
    }
  }

  // Gupshup — convert to numbered text list
  let formattedText = bodyText + '\n\nReply with the corresponding number:';
  buttons.slice(0, 3).forEach((label, index) => {
    formattedText += `\n${index + 1}. ${label}`;
  });

  return await sendText(to, formattedText);
}

/**
 * Forward a media message (image, document, audio, video).
 *
 * @param {string} to — recipient WA number
 * @param {string} mediaId — Meta media ID (reusable within same WABA)
 * @param {string} mediaType — one of: image, document, audio, video
 * @param {string} caption — optional caption text
 */
async function sendMedia(to, mediaId, mediaType, caption) {
  if (PROVIDER === 'meta') {
    const mediaPayload = { id: mediaId };
    if (caption && mediaType !== 'audio') {
      mediaPayload.caption = caption;
    }
    return withRetry(async () => {
      const response = await axios.post(metaUrl(), {
        messaging_product: "whatsapp",
        to: to,
        type: mediaType,
        [mediaType]: mediaPayload
      }, { headers: metaHeaders() });
      logger.info('whatsappService', `sendMedia to ${to}: ${response.status}`);
      return response.data;
    });
  }

  // Gupshup stub
  logger.warn('whatsappService', 'Media forwarding not supported on Gupshup provider');
}

/**
 * Send a template message via WhatsApp.
 * TODO: Implement when Meta templates are approved.
 *
 * @param {string} to — recipient WA number
 * @param {string} templateName — template identifier
 * @param {object} templateParams — template parameters
 */
async function sendTemplate(to, templateName, templateParams) {
  if (PROVIDER === 'meta') {
    return withRetry(async () => {
      const response = await axios.post(metaUrl(), {
        messaging_product: "whatsapp",
        to: to,
        type: "template",
        template: {
          name: templateName,
          language: { code: "en" },
          components: templateParams?.components || []
        }
      }, { headers: metaHeaders() });
      logger.info('whatsappService', `sendTemplate to ${to}: ${response.status}`, { template: templateName });
      return response.data;
    });
  }

  logger.warn('whatsappService', 'sendTemplate not supported on Gupshup provider');
  throw new Error('sendTemplate is not implemented for Gupshup BSP.');
}

/**
 * Opt-in a user via Gupshup API (legacy, not needed for Meta).
 * @param {string} userNumber — user's numeric WA number
 */
async function optInUser(userNumber) {
  if (PROVIDER === 'meta') return; // Not needed for Meta

  const url = `https://api.gupshup.io/sm/api/v1/app/opt/in/${process.env.GUPSHUP_APP_NAME}`;
  const params = new URLSearchParams();
  params.append('user', userNumber);

  try {
    const response = await axios.post(url, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'apikey': process.env.GUPSHUP_ACCOUNT_API_KEY || process.env.GUPSHUP_API_KEY
      }
    });
    logger.info('whatsappService', `optInUser ${userNumber}: ${response.status}`);
    return response.data;
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.message || JSON.stringify(err.response?.data);
    if (typeof errorMsg === 'string' && errorMsg.includes('Portal User Not Found')) {
      return; // Expected in sandbox mode
    }
    logger.error('whatsappService', `optInUser error`, { error: errorMsg });
  }
}

module.exports = { sendText, sendButtons, sendMedia, sendTemplate, optInUser };
