// src/handlers/doctorHandler.js
const { getActiveSession, updateSession } = require('../services/sessionStore');
const { sendText, sendButtons, sendMedia } = require('../services/whatsappService');
const prescriptionService = require('../services/prescriptionService');

const MEDIA_TYPES = ['image', 'document', 'audio', 'video'];

/**
 * Handle an inbound message from the doctor.
 * @param {{ senderNumber: string, messageText: string }} parsed
 */
async function handle(parsed) {
  const { senderNumber, messageText, messageType, mediaId, mediaCaption } = parsed;
  const isMedia = MEDIA_TYPES.includes(messageType);
  const session = await getActiveSession();

  if (!session) {
    await sendText(senderNumber, 'No active patient session found.');
    return;
  }

  const textLower = messageText.toLowerCase();

  // Guard against interacting with completed sessions
  if (session.state === 'COMPLETE' || session.state === 'FULFILLED') {
    if (textLower === 'done' || textLower === 'end' || textLower === 'finish') {
      await sendText(senderNumber, `This consultation is already ${session.state}. No action taken.`);
    }
    return;
  }

  // Detect done/end/finish commands
  if (session.state === 'ACTIVE' && (textLower === 'done' || textLower === 'end' || textLower === 'finish')) {
    await updateSession(session.patientNumber, { 
      state: 'PRESCRIBING',
      prescription: { step: 'confirm_start' }
    });

    await sendButtons(senderNumber, 
      `Ready to send prescription to ${process.env.PHARMACY_NAME}?`, 
      ['Yes, start prescription', 'No, continue chat']
    );
    return;
  }

  // ACTIVE state: proxied chat
  if (session.state === 'ACTIVE') {
    if (isMedia) {
      await sendMedia(session.patientNumber, mediaId, messageType, mediaCaption);
    } else {
      await sendText(session.patientNumber, `[Doctor]: ${messageText}`);
    }
    return;
  }

  // PRESCRIBING state: guided flow
  if (session.state === 'PRESCRIBING') {
    if (isMedia) {
      await sendText(senderNumber, 'Please use text during the prescription process.');
      return;
    }
    await handlePrescribing(parsed, session);
    return;
  }
}

/**
 * Handle the prescription button flow logic
 */
async function handlePrescribing(parsed, session) {
  const { senderNumber, messageText } = parsed;
  const { prescription, patientNumber } = session;
  const step = prescription.step;

  if (step === 'confirm_start') {
    if (messageText === 'Yes, start prescription' || messageText === '1') {
      await updateSession(patientNumber, { prescription: { step: 'medicine_name' } });
      await sendText(senderNumber, 'Medicine name and strength? \n(e.g. Paracetamol 500mg)');
    } else if (messageText === 'No, continue chat' || messageText === '2') {
      await updateSession(patientNumber, { state: 'ACTIVE', prescription: { step: '' } });
      await sendText(senderNumber, 'Okay, continuing chat.');
    }
    return;
  }

  if (step === 'medicine_name') {
    await updateSession(patientNumber, { 
      prescription: { currentMedicine: { name: messageText }, step: 'dosage' } 
    });
    await sendText(senderNumber, 'Dosage and frequency? \n(e.g. 1 tab twice daily)');
    return;
  }

  if (step === 'dosage') {
    await updateSession(patientNumber, { 
      prescription: { 
        currentMedicine: { ...prescription.currentMedicine, dosage: messageText }, 
        step: 'duration' 
      } 
    });
    await sendText(senderNumber, 'Duration? (e.g. 3 days)');
    return;
  }

  if (step === 'duration') {
    const currentMedicine = { ...prescription.currentMedicine, duration: messageText };
    await updateSession(patientNumber, { 
      prescription: { 
        medicines: [...prescription.medicines, currentMedicine],
        currentMedicine: {},
        step: 'add_more'
      } 
    });
    await sendButtons(senderNumber, 'Medicine added! Add another or finish?', ['Add another medicine', 'Done, send prescription']);
    return;
  }

  if (step === 'add_more') {
    if (messageText === 'Add another medicine' || messageText === '1') {
      await updateSession(patientNumber, { prescription: { step: 'medicine_name' } });
      await sendText(senderNumber, 'Medicine name and strength?');
    } else if (messageText === 'Done, send prescription' || messageText === '2') {
      // Re-fetch to get updated medicines properly
      const updatedSession = await updateSession(patientNumber, { prescription: { step: 'confirm_send' } });
      
      let summary = "Prescription summary:\n──────────────────\n";
      updatedSession.prescription.medicines.forEach((med, i) => {
        summary += `${i + 1}. ${med.name} — ${med.dosage} — ${med.duration}\n`;
      });
      summary += `──────────────────\nSend to ${process.env.PHARMACY_NAME}?`;

      await sendButtons(senderNumber, summary, ['Confirm & Send', 'Edit (start over)']);
    }
    return;
  }

  if (step === 'confirm_send') {
    if (messageText === 'Confirm & Send' || messageText === '1') {
      await prescriptionService.dispatch(session);
    } else if (messageText === 'Edit (start over)' || messageText === '2') {
      await updateSession(patientNumber, { 
        prescription: { 
          medicines: [], 
          currentMedicine: {}, 
          referenceCode: '', 
          step: 'medicine_name' 
        } 
      });
      await sendText(senderNumber, 'Starting over. Medicine name and strength?');
    }
    return;
  }
}

module.exports = { handle };
