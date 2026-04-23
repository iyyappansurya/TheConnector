// src/handlers/pharmacyHandler.js
// Handles inbound messages from pharmacy (forwards to patient only).
//
// Privacy rules:
// - Must never import or reference sessionStore for read operations
//   beyond looking up the patient number by reference code.
// - Must never receive or access any consultation conversation content.
//
// TODO (Mission 8): Implement pharmacy-to-patient message forwarding

/**
 * Handle an inbound message from the pharmacy.
 * @param {{ senderNumber: string, messageText: string }} parsed
 */
const { getLastCompletedSession } = require('../services/sessionStore');
const { sendText } = require('../services/whatsappService');
const { advanceQueue } = require('../services/queueService');

async function handle(parsed) {
  const { messageText } = parsed;
  console.log(`[pharmacyHandler] received: ${messageText}`);

  const session = await getLastCompletedSession();

  if (!session) {
    await sendText(process.env.PHARMACY_WA_NUMBER, "No active prescription found. Please include the reference code in your message.");
    return;
  }

  // Idempotency Guard
  if (session.state === 'FULFILLED') {
    console.warn(`[pharmacyHandler] Session for ${session.patientNumber} already FULFILLED. Skipping duplicate fulfillment.`);
    return;
  }

  const pharmacyName = process.env.PHARMACY_NAME || 'Pharmacy';
  await sendText(session.patientNumber, `[Pharmacy - ${pharmacyName}]: ${messageText}`);
  console.log(`[pharmacyHandler] forwarded to ${session.patientNumber}`);

  const lowerMsg = messageText.toLowerCase();
  if (lowerMsg.includes('done') || lowerMsg.includes('order confirmed') || lowerMsg.includes('completed') || lowerMsg.includes('fulfilled')) {
    const { updateSession, removeFromQueue } = require('../services/sessionStore');
    
    await updateSession(session.patientNumber, { state: 'FULFILLED' });
    await removeFromQueue(session.patientNumber);

    const ref = session.prescription?.referenceCode || 'Unknown';
    await sendText(process.env.PHARMACY_WA_NUMBER, `✅ Session closed for ${session.intakeData.name}. Reference: ${ref}`);
    await sendText(session.patientNumber, `✅ Your consultation and order are complete!\nThank you for using TheConnector. Get well soon 🙏`);
    await sendText(process.env.DOCTOR_WA_NUMBER, `✅ Case closed: ${session.intakeData.name} | ${ref}`);
    
    await advanceQueue();
  }
}

module.exports = { handle };
