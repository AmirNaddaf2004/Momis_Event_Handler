'use strict';
const schedule = require('node-schedule');
const logger = require('./logger');

/**
 * Cancels all currently scheduled jobs gracefully.
 * This function waits for any ongoing jobs to finish before shutting down the scheduler.
 */
async function cancelAllSchedules() {
    logger.info('Starting graceful shutdown of all scheduled jobs...');
    // The gracefulShutdown function stops all jobs cleanly.
    await schedule.gracefulShutdown();
    logger.info('All scheduled jobs have been successfully cancelled.');
}

module.exports = {
    cancelAllSchedules,
};
