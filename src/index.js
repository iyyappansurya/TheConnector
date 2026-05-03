// src/index.js — Express app entry point
// Loads environment variables and starts the HTTP server.

require('dotenv').config({ path: './config.env' });
const express = require('express');
const webhookRouter = require('./routes/webhook');
const { verifyWebhookSignature } = require('./utils/webhookAuth');
const logger = require('./utils/logger');

const app = express();

// Parse JSON body while preserving raw bytes for signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true }));

// Verify Meta webhook signatures before routing
app.use('/webhook', verifyWebhookSignature);

// Health check endpoint
app.get('/health', async (req, res) => {
  const { getRedis } = require('./services/sessionStore');
  let redisStatus = 'disconnected';
  try {
    const redis = getRedis();
    if (redis) {
      await redis.ping();
      redisStatus = 'connected';
    }
  } catch (e) {
    redisStatus = 'error';
  }

  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()) + 's',
    redis: redisStatus,
    provider: process.env.WA_PROVIDER || 'gupshup',
    timestamp: new Date().toISOString()
  });
});

// Mount webhook routes
app.use('/', webhookRouter);

const PORT = process.env.PORT || 3000;

// Initialize production services
const { initRedis } = require('./services/sessionStore');
const { startCleanupJob } = require('./services/sessionCleanup');

try {
  initRedis();
  startCleanupJob();
} catch (err) {
  logger.error('index', 'Failed to initialize local services. Halting boot.', { error: err.message });
  process.exit(1);
}

app.listen(PORT, () => {
  logger.info('index', `TheConnector server running on port ${PORT}`, { port: PORT });
});
