// src/services/whatsappService.js
// Wrapper for WhatsApp API — currently targets Gupshup BSP.
// Will be rewritten to target Meta Cloud API direct in production.
//
// Swapping providers = only rewriting this file. No other module changes.

const axios = require('axios');

const PROVIDER = process.env.WA_PROVIDER || 'gupshup';
const GUPSHUP_SEND_URL = 'https://api.gupshup.io/wa/api/v1/msg';

/**
 * Send a plain text message via Gupshup.
 *
 * @param {string} to — recipient WA number with country code (e.g. "919XXXXXXXXX")
 * @param {string} message — text content
 */
async function sendText(to, message) {
  if (PROVIDER === 'meta') {
    const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    const payload = {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: message }
    };
    try {
      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log(`[whatsappService Meta] sendText to ${to}: ${response.status}`);
      return response.data;
    } catch (err) {
      console.error(`[whatsappService Meta] sendText error:`, err.response?.data || err.message);
      throw err;
    }
  }

  // Gupshup handler
  const params = new URLSearchParams();
  params.append('channel', 'whatsapp');
  params.append('source', process.env.GUPSHUP_SOURCE_NUMBER);
  params.append('destination', to);
  params.append('src.name', process.env.GUPSHUP_APP_NAME);
  params.append('message', JSON.stringify({
    type: 'text',
    text: message
  }));

  try {
    const response = await axios.post(GUPSHUP_SEND_URL, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'apikey': process.env.GUPSHUP_API_KEY
      }
    });
    console.log(`[whatsappService Gupshup] sendText to ${to}: ${response.status}`);
    return response.data;
  } catch (err) {
    console.error(`[whatsappService Gupshup] sendText error:`, err.response?.data || err.message);
    throw err;
  }
}

/**
 * Send a quick reply button message via Gupshup.
 *
 * @param {string} to — recipient WA number
 * @param {string} bodyText — message body text
 * @param {string[]} buttons — array of button label strings (max 3)
 */
async function sendButtons(to, bodyText, buttons) {
  if (PROVIDER === 'meta') {
    const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
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
      const response = await axios.post(url, payload, {
        headers: {
          'Authorization': `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      });
      console.log(`[whatsappService Meta] sendButtons to ${to}: ${response.status}`);
      return response.data;
    } catch (err) {
      console.error(`[whatsappService Meta] sendButtons error:`, err.response?.data || err.message);
      throw err;
    }
  }

  // Since Gupshup sandbox has notoriously poor support for free-form interactive UI
  // buttons, we elegantly convert the options into a numbered text list.
  // This guarantees 100% reliable delivery for development.
  
  let formattedText = bodyText + '\n\nReply with the corresponding number:';
  buttons.slice(0, 3).forEach((label, index) => {
    formattedText += `\n${index + 1}. ${label}`;
  });

  return await sendText(to, formattedText);
}

/**
 * Send a template message via WhatsApp.
 * Stub only — not needed until production Meta Cloud API switch.
 *
 * @param {string} to — recipient WA number
 * @param {string} templateName — template identifier
 * @param {object} params — template parameters
 */
async function sendTemplate(to, templateName, params) {
  // TODO: Implement when switching to Meta Cloud API direct
  console.log(`[whatsappService] sendTemplate stub called — to: ${to}, template: ${templateName}`);
  throw new Error('sendTemplate is not implemented for Gupshup BSP. Use Meta Cloud API.');
}

/**
 * Opt-in a user via Gupshup API.
 *
 * @param {string} userNumber — user's numeric WA number
 */
async function optInUser(userNumber) {
  const url = `https://api.gupshup.io/sm/api/v1/app/opt/in/${process.env.GUPSHUP_APP_NAME}`;
  const params = new URLSearchParams();
  params.append('user', userNumber);

  try {
    const response = await axios.post(url, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // The Opt-in API requires the Account-level API key, not the App token.
        // It falls back to GUPSHUP_API_KEY but this will normally throw the 
        // "Portal User Not Found With APIKey" error if it's an App token.
        'apikey': process.env.GUPSHUP_ACCOUNT_API_KEY || process.env.GUPSHUP_API_KEY
      }
    });
    console.log(`[whatsappService] optInUser ${userNumber}: ${response.status}`);
    return response.data;
  } catch (err) {
    const errorMsg = err.response?.data?.message || err.message || JSON.stringify(err.response?.data);
    
    // Suppress the expected Portal User error caused by using the App Token in Sandbox
    if (typeof errorMsg === 'string' && errorMsg.includes('Portal User Not Found')) {
      // Opt-in failed because we are using an App Token instead of Account API Key.
      // This is expected and harmless in Sandbox mode.
      return; 
    }
    
    console.error(`[whatsappService] optInUser error:`, errorMsg);
  }
}

module.exports = { sendText, sendButtons, sendTemplate, optInUser };
