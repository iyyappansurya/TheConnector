// src/handlers/patientHandler.js
// Handles all inbound logic for patient-side messages.
//
// Responsibilities:
// - No session: create one, ask for name
// - INTAKE state: collect name, age, symptoms sequentially
// - ACTIVE state: stub for Mission 5 (proxied chat)
// - PRESCRIBING / COMPLETE: ignore

const { createSession, getSession, updateSession } = require('../services/sessionStore');
const { sendText, sendMedia } = require('../services/whatsappService');
const logger = require('../utils/logger');

const MEDIA_TYPES = ['image', 'document', 'audio', 'video'];

/**
 * Handle an inbound message from a patient.
 * @param {{ senderNumber: string, messageText: string }} parsed
 */
async function handle(parsed) {
  const { senderNumber, messageText, messageType, mediaId, mediaCaption } = parsed;
  const isMedia = MEDIA_TYPES.includes(messageType);
  let session = await getSession(senderNumber);

  // ── No session → first contact, create and ask for name ──
  if (!session) {
    const { hasActiveSession, addToQueue, getQueuePosition } = require('../services/sessionStore');
    const isBusy = await hasActiveSession();
    session = await createSession(senderNumber);
    logger.info('patientHandler', `New session created for ${senderNumber}`);
    
    if (isBusy) {
      await updateSession(senderNumber, { state: 'WAITING' });
      await addToQueue(senderNumber);
      const position = await getQueuePosition(senderNumber);
      await sendText(senderNumber,
        '👋 Welcome to TheConnector!\n' +
        'A consultation is currently in progress.\n' +
        `You are number ${position} in the queue.\n` +
        'We will notify you when the doctor is ready. 🙏'
      );
      return;
    }

    await sendText(senderNumber,
      '👋 Welcome to TheConnector!\n' +
      "I'll connect you with our doctor shortly.\n" +
      'First, what is your name?'
    );
    return;
  }

  // ── WAITING state ──
  if (session.state === 'WAITING') {
    const { getQueuePosition } = require('../services/sessionStore');
    const position = await getQueuePosition(senderNumber);
    await sendText(senderNumber, 
      `You are number ${position} in the queue.\n` +
      `Please wait, we will notify you shortly.`
    );
    return;
  }

  // ── INTAKE flow — sequential collection ──
  if (session.state === 'INTAKE') {
    // Reject media during intake — patient must complete text form first
    if (isMedia) {
      await sendText(senderNumber,
        'Please complete the consultation request first before sending photos.\n' +
        'What is your name?'
      );
      return;
    }

    const { intakeData } = session;

    // Step 1: collect name
    if (intakeData.name === '') {
      const name = messageText.trim();
      if (name.length < 2 || name.length > 50) {
        await sendText(senderNumber, 'Please enter a valid name (2-50 characters).');
        return;
      }
      if (/^\d+$/.test(name)) {
        await sendText(senderNumber, 'Name cannot be just numbers. Please enter your name.');
        return;
      }
      await updateSession(senderNumber, { intakeData: { name } });
      await sendText(senderNumber, `Thanks ${name}! How old are you?`);
      return;
    }

    // Step 2: collect age
    if (intakeData.age === '') {
      const age = parseInt(messageText.trim(), 10);
      if (isNaN(age) || age < 0 || age > 120) {
        await sendText(senderNumber, 'Please enter a valid age (0-120).');
        return;
      }
      await updateSession(senderNumber, { intakeData: { age: String(age) } });
      await sendText(senderNumber, 'Got it. Please briefly describe your symptoms.');
      return;
    }

    // Step 3: collect symptoms → notify doctor → go ACTIVE
    if (intakeData.symptoms === '') {
      const symptoms = messageText.trim();
      if (symptoms.length < 3) {
        await sendText(senderNumber, 'Please describe your symptoms in more detail (at least a few words).');
        return;
      }
      await updateSession(senderNumber, { intakeData: { symptoms } });

      // Re-read session to get the fully merged intakeData
      session = await getSession(senderNumber);
      const { name, age, symptoms } = session.intakeData;

      // Notify doctor
      const doctorNumber = process.env.DOCTOR_WA_NUMBER;
      await sendText(doctorNumber,
        '🔔 New consultation request\n' +
        '──────────────────\n' +
        `Name: ${name}\n` +
        `Age: ${age}\n` +
        `Symptoms: ${symptoms}\n` +
        '──────────────────\n' +
        'Reply to this chat to speak with the patient.'
      );

      // Confirm to patient
      await sendText(senderNumber,
        `Thank you ${name}! The doctor has been notified.\n` +
        'Please wait while we connect you. 🙏'
      );

      // Transition to ACTIVE
      await updateSession(senderNumber, { state: 'ACTIVE' });
      logger.info('patientHandler', `Intake complete for ${senderNumber}, state → ACTIVE`);
      return;
    }
  }

  // ── ACTIVE — Proxied chat ──
  if (session.state === 'ACTIVE') {
    const doctorNumber = process.env.DOCTOR_WA_NUMBER;
    if (isMedia) {
      await sendMedia(doctorNumber, mediaId, messageType, mediaCaption);
      if (mediaCaption) {
        await sendText(doctorNumber, `[Patient photo]: ${mediaCaption}`);
      }
    } else {
      await sendText(doctorNumber, `[Patient]: ${messageText}`);
    }
    return;
  }

  // ── PRESCRIBING — patient waiting ──
  if (session.state === 'PRESCRIBING') {
    if (isMedia) {
      await sendText(senderNumber, 'Please use text during the prescription process.');
    }
    return;
  }

  // ── COMPLETE — proxy to pharmacy ──
  if (session.state === 'COMPLETE') {
    const pharmacyNumber = process.env.PHARMACY_WA_NUMBER;
    await sendText(pharmacyNumber, `[Patient ${session.intakeData.name}]: ${messageText}`);
    logger.info('patientHandler', 'COMPLETE — forwarded to pharmacy');
    return;
  }
}

module.exports = { handle };
