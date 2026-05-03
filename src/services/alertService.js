// src/services/alertService.js
// Sends critical error alerts to the doctor's WhatsApp number.
// Used for unrecoverable errors that need human attention.

const logger = require('../utils/logger');

/**
 * Send a critical alert to the doctor/admin.
 * Uses sendText directly to avoid circular dependencies.
 * @param {string} message — alert message
 */
async function sendAlert(message) {
  try {
    // Lazy-require to avoid circular dependency at module load
    const { sendText } = require('./whatsappService');
    const adminNumber = process.env.DOCTOR_WA_NUMBER;

    if (!adminNumber) {
      logger.error('alertService', 'No DOCTOR_WA_NUMBER configured for alerts');
      return;
    }

    await sendText(adminNumber, `⚠️ SYSTEM ALERT\n──────────────────\n${message}\n──────────────────\nTime: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`);
    logger.info('alertService', 'Alert sent successfully', { to: adminNumber });
  } catch (err) {
    // Don't throw — alerts are best-effort, must never crash the main flow
    logger.error('alertService', 'Failed to send alert', { error: err.message });
  }
}

module.exports = { sendAlert };
