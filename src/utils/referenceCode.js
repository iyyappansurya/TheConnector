// src/utils/referenceCode.js
// Generates RX-XXXX codes

/**
 * Generates a reference code like "RX-A1B2"
 * using 4 random uppercase alphanumeric characters.
 */
function generateReferenceCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = 'RX-';
  for (let i = 0; i < 4; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

module.exports = { generateReferenceCode };
