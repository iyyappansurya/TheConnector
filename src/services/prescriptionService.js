// src/services/prescriptionService.js
// Prescription parser, reference code generator, dispatch logic
const { sendText } = require('./whatsappService');
const { generateReferenceCode } = require('../utils/referenceCode');
// Intentionally importing updateSession directly rather than using sessionStore methods
// to avoid cyclic dependencies if possible, or we just require sessionStore.
const sessionStore = require('./sessionStore');

/**
 * Dispatches the prescription to the pharmacy and notifies the patient and doctor.
 * PRIVACY CHECK: Only uses non-sensitive session data for the pharmacy.
 * @param {object} session
 */
async function dispatch(session) {
  const referenceCode = generateReferenceCode();
  
  // Update session
  await sessionStore.updateSession(session.patientNumber, {
    state: 'COMPLETE',
    prescription: { referenceCode }
  });

  // Today's date DD/MM/YYYY
  const today = new Date();
  const dateStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;

  // Build pharmacy message
  let pharmacyMessage = `🔔 New Prescription | ${referenceCode}\n`;
  pharmacyMessage += `Patient: ${session.intakeData.name} | Contact: +${session.patientNumber}\n`;
  pharmacyMessage += `──────────────────\n`;
  
  session.prescription.medicines.forEach((med, i) => {
    pharmacyMessage += `${i + 1}. ${med.name} — ${med.dosage} — ${med.duration}\n`;
  });
  
  pharmacyMessage += `──────────────────\n`;
  pharmacyMessage += `${process.env.DOCTOR_NAME} | Reg: ${process.env.DOCTOR_REG_NUMBER}\n`;
  pharmacyMessage += `Date: ${dateStr}`;

  // Build patient confirmation
  const patientMessage = `✅ Consultation complete!\n` +
    `Your prescription has been sent to ${process.env.PHARMACY_NAME}.\n` +
    `Reference code: *${referenceCode}*\n` +
    `They will contact you shortly.\n` +
    `Show this code at the counter: *${referenceCode}*`;

  // Build doctor confirmation
  const doctorMessage = `✅ Prescription sent successfully!\nReference: ${referenceCode}`;

  // Dispatch all messages
  await sendText(process.env.PHARMACY_WA_NUMBER, pharmacyMessage);
  await sendText(session.patientNumber, patientMessage);
  await sendText(process.env.DOCTOR_WA_NUMBER, doctorMessage);
}

module.exports = { dispatch };
