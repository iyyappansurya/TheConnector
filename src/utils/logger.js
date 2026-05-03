// src/utils/logger.js
// Structured JSON logger for production observability.
// All modules should use this instead of raw console.log.

/**
 * Log a structured JSON message.
 * @param {'info'|'warn'|'error'} level
 * @param {string} component — module name (e.g. 'patientHandler', 'whatsappService')
 * @param {string} message — human-readable log message
 * @param {object} [meta] — optional metadata
 */
function log(level, component, message, meta = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    component,
    message,
    ...meta
  };
  
  if (level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

module.exports = {
  info: (component, message, meta) => log('info', component, message, meta),
  warn: (component, message, meta) => log('warn', component, message, meta),
  error: (component, message, meta) => log('error', component, message, meta)
};
