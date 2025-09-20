'use strict';
const fs = require('fs/promises');
const path = require('path');
const logger = require('./logger');
const { exec } = require('child_process');

// Define a map of games to their respective .env file paths
const GAME_ENV_PATHS = {
    'Color Memory': path.join(__dirname, '../../color_memory/backend/.env'),
    '2048': path.join(__dirname, '../../my_2048/backend/.env'),
    'Math Battle': path.join(__dirname, '../../mini-app/backend/.env'),
};

const GAME_PROC_NUM = {
    'Color Memory': '0',
    '2048': '10',
    'Math Battle': '1',
};

/**
 * Stores the event ID by updating the corresponding .env file and restarting the PM2 process.
 * @param {string} selectedGame The name of the selected game.
 * @param {string} eventId The ID of the event to be written.
 */
async function storeEvent(selectedGame, eventId) {
    if (!selectedGame || !eventId) {
        logger.error('Cannot store event: selectedGame or eventId is missing.');
        return;
    }

    const filePath = GAME_ENV_PATHS[selectedGame];
    if (!filePath) {
        logger.error(`No file path defined for game: ${selectedGame}`);
        return;
    }

    try {
        // Read the contents of the .env file
        const fileContent = await fs.readFile(filePath, 'utf8');

        // The pattern to find the ONTON_EVENT_UUID line (with or without a leading #)
        const uuidPattern = /(#?\s*ONTON_EVENT_UUID=).*/;

        // Replace the entire line with the new eventId
        const newFileContent = fileContent.replace(
            uuidPattern,
            `ONTON_EVENT_UUID="${eventId}"`
        );

        // Write the updated content back to the .env file
        await fs.writeFile(filePath, newFileContent, 'utf8');
        logger.info(`Successfully updated .env file for game '${selectedGame}' with Event ID '${eventId}'.`);

        // Execute the pm2 restart command after the data is successfully saved
        exec('pm2 restart ' + GAME_PROC_NUM[selectedGame], (error, stdout, stderr) => {
            if (error) {
                logger.error(`exec error: ${error.message}`);
                return;
            }
            logger.info(`stdout: ${stdout}`);
            if (stderr) {
                logger.error(`stderr: ${stderr}`);
            }
        });

        logger.info(`PM2 restart initiated for process ID ${selectedGame}.`);
    } catch (error) {
        logger.error(`Failed to update .env file or restart PM2 process: ${error.message}`);
    }
}

module.exports = {
    storeEvent,
};