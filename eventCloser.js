'use strict';
require('dotenv').config({ quiet: true });
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs/promises');
const util = require('util');
const execPromise = util.promisify(exec);
const logger = require('./logger');

const gameInfo = {
    'Color Memory': {
        name: "Color Memory",
        dir: path.join(__dirname, '../../color_memory/backend'),
        envFile: path.join(__dirname, '../../color_memory/backend/.env'),
        restartCmd: 'pm2 restart 0',
        rewardCmd: 'node reward-top-players.js'
    },
    '2048': {
        name: "2048",
        dir: path.join(__dirname, '../../my_2048/backend'),
        envFile: path.join(__dirname, '../../my_2048/backend/.env'),
        restartCmd: 'pm2 restart 10',
        rewardCmd: 'node reward-top-players.js'
    },
    'Math Battle': {
        name: "Math Battle",
        dir: path.join(__dirname, '../../mini-app/backend'),
        envFile: path.join(__dirname, '../../mini-app/backend/.env'),
        restartCmd: 'pm2 restart 1',
        rewardCmd: 'node reward-top-players.js'
    }
};

async function processEvent(bot, gameKey) {
    const game = gameInfo[gameKey];
    if (!game) {
        logger.error(`Invalid game key: ${gameKey}`);
        return;
    }

    // Save the original working directory
    const originalDir = process.cwd();

    try {
        const envContent = await fs.readFile(game.envFile, 'utf8');
        const match = envContent.match(/ONTON_EVENT_UUID="([^"]+)"/);
        const eventId = match ? match[1] : null;

        if (!eventId) {
            logger.info(`No active event found for ${game.name}. Skipping process event.`);
            await bot.sendMessage(process.env.ADMIN_GROUP_ID, `⚠️ **Event close skipped:** No active event found for **${game.name}** to close.`, { parse_mode: 'Markdown' });
            return;
        }

        // Change the working directory to the game's backend folder
        process.chdir(game.dir);
        logger.info(`Executing reward script for ${game.name}...`);
        
        // Execute the reward command and capture the output
        const { stdout, stderr } = await execPromise(game.rewardCmd, { env: { ...process.env, ONTON_EVENT_UUID: eventId } });
        
        logger.info(`Reward script for ${game.name} finished.`);

        // Send the output to the Telegram group
        await bot.sendMessage(process.env.ADMIN_GROUP_ID, `🎉 **Event Results for ${game.name}**\n\n\`\`\`\n${stdout.substring(0, 4000)}\n\`\`\``, { parse_mode: 'Markdown' });
        
        // Reset the ONTON_EVENT_UUID in the .env file
        const newEnvContent = envContent.replace(/ONTON_EVENT_UUID="[^"]*"/, 'ONTON_EVENT_UUID=""');
        await fs.writeFile(game.envFile, newEnvContent, 'utf8');
        logger.info(`ONTON_EVENT_UUID for ${game.name} has been reset.`);

        // Restart the PM2 process
        logger.info(`Restarting PM2 process for ${game.name}...`);
        await execPromise(game.restartCmd);
        logger.info(`PM2 process for ${game.name} restarted successfully.`);

    } catch (error) {
        logger.error(`Error processing event for ${game.name}: ${error.message}`);
        await bot.sendMessage(process.env.ADMIN_GROUP_ID, `❌ **Error Closing Event:**\n\nAn error occurred while closing the event for **${game.name}**. Please check the server logs.\n\n\`\`\`\n${error.message}\n\`\`\``, { parse_mode: 'Markdown' });
        
    } finally {
        // Always return to the original directory, even if an error occurred
        process.chdir(originalDir);
        logger.info(`Returned to original directory: ${originalDir}`);
    }
}

module.exports = {
    processEvent
};