// src/index.js — Express app entry point
// Loads environment variables and starts the HTTP server.

require('dotenv').config({ path: './Config.env' });
const express = require('express');
const webhookRouter = require('./routes/webhook');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  console.error('Failed to initialize local services. Halting boot:', err);
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`TheConnector server running on port ${PORT}`);
});
