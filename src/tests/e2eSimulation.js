require('dotenv').config({ path: require('path').resolve(__dirname, '../../config.env') });
const axios = require('axios');

const WEBHOOK_URL = process.env.WEBHOOK_URL || 'http://localhost:3000/webhook';

const DOCTOR = process.env.DOCTOR_WA_NUMBER;
const PHARMACY = process.env.PHARMACY_WA_NUMBER;
const PATIENT = process.env.TEST_PATIENT_NUMBER || '918610447907';
const PATIENT2 = '919999999999';

let msgCounter = 0;

/**
 * Create a Meta Cloud API webhook payload.
 * Meta sends: { object, entry: [{ changes: [{ value: { messages: [...] } }] }] }
 */
function createMetaPayload(senderNumber, replyType, textOrTitle) {
  msgCounter++;
  const messageId = `test-msg-${msgCounter}-${Date.now()}`;

  let message = {
    from: senderNumber,
    id: messageId,
    timestamp: Math.floor(Date.now() / 1000).toString()
  };

  if (replyType === 'button_reply') {
    message.type = 'interactive';
    message.interactive = {
      type: 'button_reply',
      button_reply: {
        id: `btn-${msgCounter}`,
        title: textOrTitle
      }
    };
  } else if (replyType === 'image') {
    message.type = 'image';
    message.image = {
      id: textOrTitle,  // mediaId placeholder
      caption: 'Photo of affected area'
    };
  } else {
    message.type = 'text';
    message.text = { body: textOrTitle };
  }

  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WHATSAPP_BUSINESS_ACCOUNT_ID',
      changes: [{
        value: {
          messaging_product: 'whatsapp',
          metadata: {
            display_phone_number: '0000000000',
            phone_number_id: process.env.WHATSAPP_PHONE_NUMBER_ID || '0000'
          },
          messages: [message]
        },
        field: 'messages'
      }]
    }]
  };
}

async function sendMsg(senderNumber, replyType, textOrTitle, description) {
  console.log(`[TEST] Step ${msgCounter + 1}: ${description}`);
  const payload = createMetaPayload(senderNumber, replyType, textOrTitle);
  try {
    await axios.post(WEBHOOK_URL, payload, {
      headers: { 'Content-Type': 'application/json' }
    });
    // 2000ms delay — production API calls need more time
    await new Promise(resolve => setTimeout(resolve, 2000));
  } catch (err) {
    console.error(`Error sending step ${msgCounter}:`, err.message);
  }
}

async function run() {
  console.log('--- STARTING E2E SIMULATION ---');
  console.log(`Target: ${WEBHOOK_URL}`);
  console.log(`Patient: ${PATIENT} | Doctor: ${DOCTOR} | Pharmacy: ${PHARMACY}\n`);

  await sendMsg(PATIENT, 'text', 'Hi', 'Patient sends "Hi"');
  await sendMsg(PATIENT2, 'text', 'Hi', 'Patient 2 sends "Hi" and gets queued');
  await sendMsg(PATIENT, 'text', 'Ravi', 'Patient sends name "Ravi"');
  await sendMsg(PATIENT, 'text', '34', 'Patient sends age "34"');
  await sendMsg(PATIENT, 'text', 'Fever since 2 days, body ache', 'Patient sends symptoms');

  // Patient sends image of affected area (requires real media_id to fully test delivery)
  await sendMsg(PATIENT, 'image', 'placeholder-media-id-12345', 'Patient sends image of affected area');

  await sendMsg(DOCTOR, 'text', 'Hello Ravi, noted your symptoms', 'Doctor sends "Hello Ravi..."');
  await sendMsg(PATIENT, 'text', 'Thank you doctor', 'Patient sends "Thank you doctor"');

  await sendMsg(DOCTOR, 'text', 'done', 'Doctor sends "done"');

  await sendMsg(DOCTOR, 'button_reply', 'Start prescription', 'Doctor sends "Start prescription"');
  await sendMsg(DOCTOR, 'text', 'Paracetamol 500mg', 'Doctor sends "Paracetamol 500mg"');
  await sendMsg(DOCTOR, 'text', '1 tab twice daily', 'Doctor sends "1 tab twice daily"');
  await sendMsg(DOCTOR, 'text', '3 days', 'Doctor sends "3 days"');

  await sendMsg(DOCTOR, 'button_reply', 'Send prescription', 'Doctor sends "Send prescription"');
  await sendMsg(DOCTOR, 'button_reply', 'Confirm & Send', 'Doctor sends "Confirm & Send"');

  await sendMsg(PHARMACY, 'text', 'Hi Ravi medicines are ready, 15% discount available', 'Pharmacy sends discount notification');
  await sendMsg(PATIENT, 'text', 'Thank you, I will visit today', 'Patient replies to pharmacy');
  await sendMsg(PHARMACY, 'text', 'See you!', 'Pharmacy says See you!');
  await sendMsg(PHARMACY, 'text', 'order confirmed', 'Pharmacy confirms order to fulfill session & advance queue');

  console.log('\n--- E2E SIMULATION COMPLETE ---');
  console.log('Test complete — check your phones for messages');
}

run();
