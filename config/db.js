// config/db.js
// MongoDB connection with 3-retry logic and 5s delay between attempts.
// Fixes B-25: old version had zero retries — one failure killed the process.

const mongoose = require('mongoose');
const config = require('./config');
const logger = require('./logger');

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

const connectDB = async () => {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const conn = await mongoose.connect(config.MONGO_URI);
      logger.info(`MongoDB Connected: ${conn.connection.host}`);
      return;
    } catch (error) {
      logger.error(`MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);

      if (attempt < MAX_RETRIES) {
        logger.info(`Retrying in ${RETRY_DELAY / 1000}s...`);
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }

  logger.error('All MongoDB connection attempts failed. Exiting.');
  process.exit(1);
};

module.exports = connectDB;
