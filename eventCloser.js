'use strict';
const fs = require('fs/promises');
const path = require('path');
const { exec } = require('child_process');
const logger = require('./logger');

// Define a map of games to their respective backend paths
const GAME_BACKEND_PATHS = {
    'Color Memory': path.join(__dirname, '../../color_memory/backend'),
    '2048': path.join(__dirname, '../../my_2048/backend'),
    'Math Battle': path.join(__dirname, '../../mini-app/backend'),
};

const GAME_PROC_NUM = {
    'Color Memory': '0',
    '2048': '10',
    'Math Battle': '1',
};

/**
 * Handles the event processing pipeline:
 * 1. Finds the eventId from the .env file.
 * 2. Executes the reward script with the eventId.
 * 3. Comments out the ONTON_EVENT_UUID line in the .env file.
 * 4. Restarts the PM2 process.
 * @param {string} selectedGame The name of the game to process.
 */
async function processEvent(selectedGame) {
    if (!selectedGame) {
        logger.error('Cannot process event: selectedGame is missing.');
        return;
    }

    const backendPath = GAME_BACKEND_PATHS[selectedGame];
    if (!backendPath) {
        logger.error(`No backend path defined for game: ${selectedGame}`);
        return;
    }

    const envPath = path.join(backendPath, '.env');

    try {
        // Step 1: Find the eventId in the .env file
        const fileContent = await fs.readFile(envPath, 'utf8');
        const uuidRegex = /ONTON_EVENT_UUID="([^"]+)"/;
        const match = fileContent.match(uuidRegex);
        
        if (!match || !match[1]) {
            logger.error(`ONTON_EVENT_UUID not found in ${envPath}.`);
            return;
        }
        const eventId = match[1];
        logger.info(`Found eventId: ${eventId} for game: ${selectedGame}`);

        // Step 2: Execute the reward script
        const command = `node reward-top-players.js ${eventId}`;
        logger.info(`Executing command: "${command}" in directory: ${backendPath}`);
        
        await new Promise((resolve, reject) => {
            exec(command, { cwd: backendPath }, (error, stdout, stderr) => {
                if (error) {
                    logger.error(`Reward script failed with error: ${error.message}`);
                    return reject(error);
                }
                logger.info(`Reward script stdout: ${stdout}`);
                if (stderr) logger.error(`Reward script stderr: ${stderr}`);
                resolve();
            });
        });

        // Step 3: Comment out the ONTON_EVENT_UUID line
        const commentRegex = /^\s*ONTON_EVENT_UUID=.*$/m;
        const newFileContent = fileContent.replace(commentRegex, `\n# ONTON_EVENT_UUID="${eventId}"`);
        await fs.writeFile(envPath, newFileContent, 'utf8');
        logger.info(`Successfully commented out ONTON_EVENT_UUID in ${envPath}.`);

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
    processEvent
};