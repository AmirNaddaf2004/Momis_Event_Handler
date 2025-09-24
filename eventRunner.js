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
 * Stores the event start time by updating the corresponding .env file and restarting the PM2 process.
 * @param {string} selectedGame The name of the selected game.
 * @param {Date} startTime The Date object representing the event's start time.
 */
async function setStartTime(selectedGame, startTime) {
    if (!selectedGame || !startTime) {
        logger.error('Cannot set start time: selectedGame or startTime is missing.');
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

        // Prepare the new line to be written
        const newStartTimeLine = `START_TIME="${startTime.toISOString()}"`;

        // Regular expression to find and replace any existing START_TIME line
        const pattern = /(#?\s*START_TIME=.*)/g;

        // Replace the line. If it doesn't exist, this does nothing.
        const updatedFileContent = fileContent.replace(
            pattern,
            ''
        );

        // Append the new line at the end of the file.
        const newFileContent = `${updatedFileContent.trim()}\n\n${newStartTimeLine}\n`;
        
        // Write the updated content back to the .env file
        await fs.writeFile(filePath, newFileContent, 'utf8');
        logger.info(`Successfully set START_TIME in .env file for game '${selectedGame}' to '${startTime.toISOString()}'.`);

        // Execute the pm2 restart command
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


/**
 * Stores the event ID and end time by updating the corresponding .env file and restarting the PM2 process.
 * @param {string} selectedGame The name of the selected game.
 * @param {string} eventId The ID of the event to be written.
 * @param {Date} endTime The Date object representing the event's end time.
 */
async function storeEvent(selectedGame, eventId, endTime) {
    if (!selectedGame || !eventId || !endTime) {
        logger.error('Cannot store event: selectedGame, eventId, or endTime is missing.');
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

        // Prepare the new lines to be written
        const newUuidLine = `ONTON_EVENT_UUID="${eventId}"`;
        const newEndTimeLine = `END_TIME="${endTime.toISOString()}"`; // Save the end time as an ISO string

        // Regular expression to find and replace both UUID and END_TIME lines
        const combinedPattern = /(#?\s*ONTON_EVENT_UUID=.*)|(#?\s*END_TIME=.*)|(#?\s*START_TIME=.*)/g;

        // Replace both lines in one go. If they don't exist, this does nothing.
        const updatedFileContent = fileContent.replace(
            combinedPattern,
            ''
        );

        // Append the new lines at the end of the file.
        const newFileContent = `${updatedFileContent.trim()}\n\n${newUuidLine}\n${newEndTimeLine}\n`;
        
        // Write the updated content back to the .env file
        await fs.writeFile(filePath, newFileContent, 'utf8');
        logger.info(`Successfully updated .env file for game '${selectedGame}' with Event ID '${eventId}' and End Time '${endTime.toISOString()}'.`);

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
    setStartTime,
};