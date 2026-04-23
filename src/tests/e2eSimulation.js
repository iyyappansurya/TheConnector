require('dotenv').config({ path: require('path').resolve(__dirname, '../../Config.env') });
const axios = require('axios');

const WEBHOOK_URL = 'http://127.0.0.1:3000/webhook';
const DEBUG_URL = 'http://127.0.0.1:3000/debug/session';

const DOCTOR = process.env.DOCTOR_WA_NUMBER;
const PHARMACY = process.env.PHARMACY_WA_NUMBER;
const PATIENT = '918610447907';
const PATIENT2 = '919999999999'; // Note: Cannot use Pharmacy's number as Patient 2

let msgCounter = 0;

function createBasicPayload(senderNumber, replyType, textOrTitle) {
  msgCounter++;
  const payloadData = { type: replyType };
  
  if (replyType === 'button_reply') {
    payloadData.title = textOrTitle;
  } else {
    payloadData.text = textOrTitle;
  }

  return {
    app: "SkinSpecialist",
    timestamp: Date.now(),
    version: 2,
    type: "message",
    payload: {
      id: `test-msg-${msgCounter}`,
      source: senderNumber,
      type: replyType,
      payload: payloadData,
      sender: {
        phone: senderNumber,
        name: "TestUser"
      }
    }
  };
}

async function sendMsg(senderNumber, replyType, textOrTitle, description) {
  console.log(`[TEST] Step ${msgCounter + 1}: ${description} — sending payload`);
  const payload = createBasicPayload(senderNumber, replyType, textOrTitle);
  try {
    await axios.post(WEBHOOK_URL, payload);
    // 500ms delay as requested
    await new Promise(resolve => setTimeout(resolve, 500));
  } catch (err) {
    console.error(`Error sending step ${msgCounter}:`, err.message);
  }
}

async function run() {
  console.log('--- STARTING E2E SIMULATION ---\n');

  await sendMsg(PATIENT, 'text', 'Hi', 'Patient sends "Hi"');
  await sendMsg(PATIENT2, 'text', 'Hi', 'Patient 2 sends "Hi" and gets queued');
  await sendMsg(PATIENT, 'text', 'Ravi', 'Patient sends name "Ravi"');
  await sendMsg(PATIENT, 'text', '34', 'Patient sends age "34"');
  await sendMsg(PATIENT, 'text', 'Fever since 2 days, body ache', 'Patient sends symptoms');
  
  await sendMsg(DOCTOR, 'text', 'Hello Ravi, noted your symptoms', 'Doctor sends "Hello Ravi..."');
  await sendMsg(PATIENT, 'text', 'Thank you doctor', 'Patient sends "Thank you doctor"');
  
  await sendMsg(DOCTOR, 'text', 'done', 'Doctor sends "done"');
  
  await sendMsg(DOCTOR, 'button_reply', 'Yes, start prescription', 'Doctor sends button reply "Yes, start prescription"');
  await sendMsg(DOCTOR, 'text', 'Paracetamol 500mg', 'Doctor sends "Paracetamol 500mg"');
  await sendMsg(DOCTOR, 'text', '1 tab twice daily', 'Doctor sends "1 tab twice daily"');
  await sendMsg(DOCTOR, 'text', '3 days', 'Doctor sends "3 days"');
  
  await sendMsg(DOCTOR, 'button_reply', 'Done, send prescription', 'Doctor sends button reply "Done, send prescription"');
  await sendMsg(DOCTOR, 'button_reply', 'Confirm & Send', 'Doctor sends button reply "Confirm & Send"');
  
  await sendMsg(PHARMACY, 'text', 'Hi Ravi medicines are ready, 15% discount available', 'Pharmacy sends discount notification');
  await sendMsg(PATIENT, 'text', 'Thank you, I will visit today', 'Patient replies to pharmacy');
  await sendMsg(PHARMACY, 'text', 'See you!', 'Pharmacy says See you!');
  await sendMsg(PHARMACY, 'text', 'order confirmed', 'Pharmacy confirms order to fulfill session & advance queue');

  console.log('\n--- FETCHING FINAL SESSION STATES ---');
  try {
    console.log('\nPatient 1:');
    const res1 = await axios.get(`${DEBUG_URL}/${PATIENT}`);
    console.log(JSON.stringify(res1.data, null, 2));

    console.log('\nPatient 2:');
    const res2 = await axios.get(`${DEBUG_URL}/${PATIENT2}`);
    console.log(JSON.stringify(res2.data, null, 2));
  } catch (err) {
    console.error('Could not fetch session state:', err.message);
  }
  console.log('\n--- E2E SIMULATION COMPLETE ---');
}

run();
