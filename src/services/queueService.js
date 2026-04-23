// src/services/queueService.js
const { getNextInQueue, removeFromQueue, updateSession } = require('./sessionStore');
// Intentionally importing sendText to handle Queue bridging decoupled from pharmacy handlers
const { sendText } = require('./whatsappService');

async function advanceQueue() {
  const next = await getNextInQueue();

  if (!next) {
    console.log('[queue] Queue empty');
    return;
  }

  await removeFromQueue(next);
  await updateSession(next, { state: 'INTAKE', intakeData: { name: '', age: '', symptoms: '' } });

  await sendText(next, "✅ The doctor is ready for you now!\nLet's start — what is your name?");
  await sendText(process.env.DOCTOR_WA_NUMBER, "🔔 Next patient from queue is ready.\nStarting new consultation.");
}

module.exports = { advanceQueue };
