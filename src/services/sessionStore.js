// src/services/sessionStore.js
// V4 Production Redis session store with atomic concurrency controls

const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

let redis;

function initRedis() {
  redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  redis.on('error', (err) => console.error('[sessionStore] Redis error:', err));
  console.log('[sessionStore] Redis initialized');
}

function getRedis() {
  return redis;
}

// Strictly enforce state machine
const VALID_TRANSITIONS = {
  'INTAKE': ['WAITING', 'ACTIVE'],
  'WAITING': ['INTAKE'],
  'ACTIVE': ['PRESCRIBING', 'COMPLETE'],
  'PRESCRIBING': ['ACTIVE', 'COMPLETE'],
  'COMPLETE': ['FULFILLED', 'ACTIVE'] // Allowing edit back to active if doctor chooses
};

/**
 * Perform minimal HSET updates without fetching everything.
 */
async function updateSession(patientNumber, updates) {
  const sessionKey = `session:${patientNumber}`;
  const hsetArgs = {};
  hsetArgs.updatedAt = new Date().toISOString();

  // Validate State Transitions natively
  if (updates.state) {
    const currentState = await redis.hget(sessionKey, 'state');
    if (currentState && currentState !== updates.state) {
      const validNext = VALID_TRANSITIONS[currentState] || [];
      if (!validNext.includes(updates.state)) {
        throw new Error(`Invalid state transition from ${currentState} to ${updates.state}`);
      }
    }
    hsetArgs.state = updates.state;
    
    // Explicit Index Tracking instead of SCAN
    if (updates.state === 'ACTIVE' || updates.state === 'PRESCRIBING') {
      await redis.set('tracking:activeSession', patientNumber);
    } else if (updates.state === 'COMPLETE') {
      const active = await redis.get('tracking:activeSession');
      if (active === patientNumber) await redis.del('tracking:activeSession');
      await redis.set('tracking:lastCompleted', patientNumber);
    }
  }

  // Handle Nested Merges targeted
  if (updates.intakeData) {
    const currentIntakeStr = await redis.hget(sessionKey, 'intakeData');
    const currentIntake = currentIntakeStr ? JSON.parse(currentIntakeStr) : {};
    hsetArgs.intakeData = JSON.stringify({ ...currentIntake, ...updates.intakeData });
  }

  if (updates.prescription) {
    const currentPresStr = await redis.hget(sessionKey, 'prescription');
    const currentPres = currentPresStr ? JSON.parse(currentPresStr) : {};
    hsetArgs.prescription = JSON.stringify({ ...currentPres, ...updates.prescription });
    
    // Explicit Index for Reverse Lookup
    if (updates.prescription.referenceCode) {
      await redis.set(`index:ref:${updates.prescription.referenceCode}`, patientNumber);
    }
  }

  for (const key of Object.keys(updates)) {
    if (key !== 'intakeData' && key !== 'prescription' && key !== 'state') {
      hsetArgs[key] = updates[key];
    }
  }

  // Atomic HSET update
  await redis.hset(sessionKey, hsetArgs);
  return await getSession(patientNumber); // Return full obj for runtime
}

async function createSession(patientNumber) {
  const now = new Date().toISOString();
  const flatRecord = {
    sessionId: uuidv4(),
    patientNumber,
    state: 'INTAKE',
    intakeData: JSON.stringify({ name: '', age: '', symptoms: '' }),
    prescription: JSON.stringify({ medicines: [], currentMedicine: {}, referenceCode: '' }),
    createdAt: now,
    updatedAt: now
  };
  
  await redis.hmset(`session:${patientNumber}`, flatRecord);
  await redis.sadd('index:all_sessions', patientNumber);
  return await getSession(patientNumber);
}

async function getSession(patientNumber) {
  const data = await redis.hgetall(`session:${patientNumber}`);
  if (!data || Object.keys(data).length === 0) return null;
  return {
    ...data,
    intakeData: data.intakeData ? JSON.parse(data.intakeData) : { name: '', age: '', symptoms: '' },
    prescription: data.prescription ? JSON.parse(data.prescription) : { medicines: [], currentMedicine: {}, referenceCode: '' }
  };
}

async function deleteSession(patientNumber) {
  const activePn = await redis.get('tracking:activeSession');
  if (activePn === patientNumber) await redis.del('tracking:activeSession');
  await redis.srem('index:all_sessions', patientNumber);
  await redis.del(`session:${patientNumber}`);
}

async function getActiveSession() {
  const patient = await redis.get('tracking:activeSession');
  if (!patient) return null;
  const s = await getSession(patient);
  if (s && (s.state === 'ACTIVE' || s.state === 'PRESCRIBING')) return s;
  return null;
}

async function getLastCompletedSession() {
  const patient = await redis.get('tracking:lastCompleted');
  return patient ? await getSession(patient) : null;
}

async function getByReferenceCode(refCode) {
  const patient = await redis.get(`index:ref:${refCode}`);
  return patient ? await getSession(patient) : null;
}

async function hasActiveSession() {
  const patient = await redis.get('tracking:activeSession');
  return patient !== null;
}

async function addToQueue(patientNumber) {
  await redis.rpush('queue:patients', patientNumber);
}

async function getQueuePosition(patientNumber) {
  // LPOS requires newer Redis, lrange handles small lists easily for index
  const elements = await redis.lrange('queue:patients', 0, -1);
  const idx = elements.indexOf(patientNumber);
  return idx > -1 ? idx + 1 : null;
}

async function removeFromQueue(patientNumber) {
  await redis.lrem('queue:patients', 0, patientNumber);
}

async function getNextInQueue() {
  return await redis.lindex('queue:patients', 0) || null;
}

/**
 * ATOMIC QUEUE PROTESTION LUA SCRIPT
 * Popping the patient off the queue and jumping their state into INTAKE autonomously.
 */
async function atomicPromoteNextInQueue() {
  const luaScript = `
    local nextPatient = redis.call("LPOP", "queue:patients")
    if not nextPatient then
      return nil
    end

    local sessionKey = "session:" .. nextPatient
    if redis.call("EXISTS", sessionKey) == 1 then
      redis.call("HSET", sessionKey, "state", "INTAKE")
      redis.call("HSET", sessionKey, "updatedAt", ARGV[1])
      
      -- Reset tracking data organically
      redis.call("HSET", sessionKey, "intakeData", '{"name":"","age":"","symptoms":""}')
    end

    return nextPatient
  `;
  try {
    const nextPn = await redis.eval(luaScript, 0, new Date().toISOString());
    return nextPn;
  } catch (err) {
    console.error("[sessionStore] Atomic queue promote fail:", err);
    throw err;
  }
}

module.exports = {
  initRedis,
  getRedis,
  createSession,
  getSession,
  updateSession,
  deleteSession,
  getByReferenceCode,
  getActiveSession,
  getLastCompletedSession,
  addToQueue,
  getQueuePosition,
  removeFromQueue,
  getNextInQueue,
  hasActiveSession,
  atomicPromoteNextInQueue
};
