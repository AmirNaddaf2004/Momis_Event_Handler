'use strict';
const fs = require('fs/promises');
const path = require('path');
const logger = require('./logger');
const { exec } = require('child_process'); // This line is added here

const DATA_FILE_PATH = path.join(__dirname, 'game_events.json');

/**
 * Loads the existing data from the file.
 * @returns {Promise<Object>} An object containing the data, or an empty object if the file doesn't exist.
 */
async function loadData() {
    try {
        const data = await fs.readFile(DATA_FILE_PATH, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            logger.info('Data file not found. Creating a new one.');
            return {};
        }
        logger.error(`Error loading data file: ${error.message}`);
        throw error;
    }
}

/**
 * Saves the updated data back to the file.
 * @param {Object} data The data object to be saved.
 */
async function saveData(data) {
    try {
        const jsonData = JSON.stringify(data, null, 2);
        await fs.writeFile(DATA_FILE_PATH, jsonData, 'utf8');
        logger.info('Data saved successfully.');
    } catch (error) {
        logger.error(`Error saving data file: ${error.message}`);
        throw error; // Propagate the error to the caller
    }
}

/**
 * Stores the game and event ID in the data file and restarts PM2 process.
 * @param {string} selectedGame The name of the selected game.
 * @param {string} eventId The ID of the event.
 */
async function storeEvent(selectedGame, eventId) {
    if (!selectedGame || !eventId) {
        logger.error('Cannot store event: selectedGame or eventId is missing.');
        return;
    }

    try {
        const data = await loadData();
        
        if (!data[selectedGame]) {
            data[selectedGame] = [];
        }

        data[selectedGame].push({
            eventId: eventId,
            timestamp: new Date().toISOString()
        });

        await saveData(data);

        // Execute the pm2 restart command after the data is successfully saved
        exec('pm2 restart Momis_Event_Handler', (error, stdout, stderr) => {
            if (error) {
                logger.error(`exec error: ${error.message}`);
                return;
            }
            logger.info(`stdout: ${stdout}`);
            if (stderr) {
                logger.error(`stderr: ${stderr}`);
            }
        });

        logger.info(`Successfully stored Event ID '${eventId}' for game '${selectedGame}' and initiated PM2 restart.`);
    } catch (error) {
        logger.error(`Failed to store event: ${error.message}`);
    }
}

module.exports = {
    storeEvent,
};