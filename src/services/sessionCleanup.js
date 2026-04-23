// src/services/sessionCleanup.js
const Redis = require('ioredis');
const { getSession, deleteSession, removeFromQueue } = require('./sessionStore');
const { sendText } = require('./whatsappService');
const { advanceQueue } = require('./queueService');

function startCleanupJob() {
  const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

  setInterval(async () => {
    try {
      let cursor = '0';
      do {
        const res = await redis.scan(cursor, 'MATCH', 'session:*', 'COUNT', 100);
        cursor = res[0];
        const keys = res[1];

        for (const key of keys) {
          const pn = key.split(':')[1];
          const session = await getSession(pn);

          if (session && (session.state === 'INTAKE' || session.state === 'WAITING')) {
            const updatedTime = new Date(session.updatedAt).getTime();
            const now = Date.now();
            if (now - updatedTime > 30 * 60 * 1000) {
              const name = session.intakeData?.name || session.patientNumber;

              await sendText(session.patientNumber, "⏰ Your session has expired due to inactivity. Please message us again when you are ready to consult.");

              if (session.state !== 'WAITING') {
                await sendText(process.env.DOCTOR_WA_NUMBER, `ℹ️ Session for patient ${name} expired due to inactivity.`);
              }

              await removeFromQueue(session.patientNumber);
              await deleteSession(session.patientNumber);

              console.log(`[cleanup] Expired session for ${session.patientNumber}`);

              if (session.state !== 'WAITING') {
                await advanceQueue();
              }
            }
          }
        }
      } while (cursor !== '0');
    } catch (err) {
      console.error('[cleanup] Job error:', err);
    }
  }, 5 * 60 * 1000);

  console.log('[cleanup] Session cleanup job started');
}

module.exports = { startCleanupJob };
