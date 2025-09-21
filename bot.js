'use strict';
require('dotenv').config({ quiet: true });
const TelegramBot = require('node-telegram-bot-api');
const logger = require('./logger');
const schedule = require('node-schedule');
const { storeEvent } = require('./eventRunner');
const { processEvent } = require('./eventCloser');
const fs = require('fs/promises');
const path = require('path');
const moment = require('moment'); // Changed to moment.js for native UTC handling

const token = process.env.BOT_TOKEN;
if (!token) {
    throw new Error('Telegram BOT_TOKEN is not configured in .env file.');
}

const REQUIRED_CHANNEL_ID = process.env.REQUIRED_CHANNEL_ID || '@MOMIS_studio';

const bot = new TelegramBot(token, { polling: true });

let userStates = {};
// Store references to all scheduled jobs so we can manage them later
let scheduledJobs = {};

const GAME_INFO = {
    'Color Memory': {
        name: "🎨 Color Memory",
        envPath: path.join(__dirname, '../../color_memory/backend/.env'),
    },
    '2048': {
        name: "🎲 2048",
        envPath: path.join(__dirname, '../../my_2048/backend/.env'),
    },
    'Math Battle': {
        name: "➕ Math Battle",
        envPath: path.join(__dirname, '../../mini-app/backend/.env'),
    },
};

async function isUserAdmin(userId) {
    try {
        const chatMember = await bot.getChatMember(REQUIRED_CHANNEL_ID, userId);
        const isAdmin = ['administrator', 'creator'].includes(chatMember.status);
        return isAdmin;
    } catch (error) {
        logger.error(`Failed to check channel membership for ${userId}: ${error.message}`);
        return false;
    }
}

async function getActiveGames() {
    const activeGames = [];
    for (const [key, value] of Object.entries(GAME_INFO)) {
        try {
            const fileContent = await fs.readFile(value.envPath, 'utf8');
            
            // Split the file content into lines
            const lines = fileContent.split('\n');
            
            // Check each line for the non-commented variable
            const isActive = lines.some(line => {
                const trimmedLine = line.trim();
                // Check if the line is not commented (#) and contains the variable
                return !trimmedLine.startsWith('#') && trimmedLine.includes('ONTON_EVENT_UUID="');
            });

            if (isActive) {
                activeGames.push(key);
            }
        } catch (error) {
            logger.error(`Error reading .env for ${key}: ${error.message}`);
        }
    }
    return activeGames;
}

async function scheduleEvent(userId, game, startDateTimeUTC, duration, eventId) {
    const startTime = moment.utc(startDateTimeUTC).toDate();
    const [count, unit] = duration.split(' ');
    const endTime = moment.utc(startDateTimeUTC).add(parseInt(count), unit).toDate();

    // Schedule storeEvent and save the job reference
    const startJob = schedule.scheduleJob(startTime, async () => {
        logger.info(`[Scheduler] Starting event for ${game} at ${startTime.toISOString()} UTC`);
        await storeEvent(game, eventId, endTime);
        await bot.sendMessage(userId, `✅ **Event Started!**\n\n*Game:* ${game}\n*Event ID:* \`${eventId}\``, { parse_mode: 'Markdown' });
    });

    // Schedule processEvent and save the job reference
    const endJob = schedule.scheduleJob(endTime, async () => {
        logger.info(`[Scheduler] Closing event for ${game} at ${endTime.toISOString()} UTC`);
        await processEvent(bot, game);
        await bot.sendMessage(userId, `🏁 **Event Ended!**\n\n*Game:* ${game}\n*Event ID:* \`${eventId}\``, { parse_mode: 'Markdown' });
        // Clean up the job reference after the job is finished
        delete scheduledJobs[eventId];
    });

    // Save the job references in our in-memory store
    scheduledJobs[eventId] = { start: startJob, end: endJob, game: game, startDateTime: startDateTimeUTC, duration: duration };

    logger.info(`Event scheduled for ${game} from ${startTime.toISOString()} to ${endTime.toISOString()}`);
}

function startListening() {
    bot.onText(/^\/start$/, async (msg) => {
        const userId = msg.from.id;
        const firstName = msg.from.first_name;

        const isAdmin = await isUserAdmin(userId);
        if (!isAdmin) {
            return bot.sendMessage(userId, `❌ Hello, *${firstName}*! This bot is restricted to administrators of the **MOMIS_studio** channel.`, { parse_mode: 'Markdown' });
        }

        userStates[userId] = {};
        const options = {
            parse_mode: "Markdown",
            reply_markup: {
                inline_keyboard: [
                    [{ text: GAME_INFO['2048'].name, callback_data: 'select_2048' }],
                    [{ text: GAME_INFO['Color Memory'].name, callback_data: 'select_Color Memory' }],
                    [{ text: GAME_INFO['Math Battle'].name, callback_data: 'select_Math Battle' }],
                    [{ text: "▶️ Close an Event", callback_data: 'show_close_options' }],
                ]
            }
        };
        await bot.sendMessage(userId, `🎉 Welcome, *${firstName}*! Please choose an option:`, options);
    });

    bot.onText(/^\/status$/, async (msg) => {
        const userId = msg.from.id;
        if (!await isUserAdmin(userId)) return;

        const statusMessage = await getStatusMessage();
        await bot.sendMessage(userId, statusMessage, { parse_mode: 'Markdown' });
    });

    // New command to list all scheduled events
    bot.onText(/^\/schedules$/, async (msg) => {
        const userId = msg.from.id;
        if (!await isUserAdmin(userId)) return;

        const eventIds = Object.keys(scheduledJobs);
        if (eventIds.length === 0) {
            return bot.sendMessage(userId, "There are no active scheduled events.");
        }

        const keyboard = eventIds.map(eventId => {
            const jobInfo = scheduledJobs[eventId];
            const gameName = GAME_INFO[jobInfo.game].name;
            return [{ text: `${gameName} - ID: ${eventId}`, callback_data: `manage_schedule_${eventId}` }];
        });
        
        await bot.sendMessage(userId, "📋 **Active Scheduled Events:**\n\nPlease select an event to manage:", {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: keyboard
            }
        });
    });

    async function getStatusMessage() {
        let status = "*Current Event Status:*\n\n";
        for (const [gameKey, gameValue] of Object.entries(GAME_INFO)) {
            try {
                const fileContent = await fs.readFile(gameValue.envPath, 'utf8');

                // Find the active event UUID, ignoring commented lines
                const lines = fileContent.split('\n');
                let activeEventId = null;

                for (const line of lines) {
                    const trimmedLine = line.trim();
                    if (!trimmedLine.startsWith('#')) {
                        const match = trimmedLine.match(/ONTON_EVENT_UUID="([^"]+)"/);
                        if (match && match[1]) {
                            activeEventId = match[1];
                            break; // Found the active ID, no need to check further
                        }
                    }
                }
                
                if (activeEventId) {
                    status += `✅ *${gameKey}*: Active (ID: \`${activeEventId}\`)\n`;
                } else {
                    status += `❌ *${gameKey}*: Inactive\n`;
                }
            } catch (error) {
                logger.error(`Failed to read status for ${gameKey}: ${error.message}`);
                status += `⚠️ *${gameKey}*: Status Unknown\n`;
            }
        }
        return status;
    }

    bot.on('callback_query', async (callbackQuery) => {
        const userId = callbackQuery.from.id;
        const callbackData = callbackQuery.data;
        await bot.answerCallbackQuery(callbackQuery.id);

        if (!await isUserAdmin(userId)) return;

        const state = userStates[userId] || {};

        if (callbackData.startsWith('select_')) {
            const selectedGame = callbackData.substring(7);
            state.flow = 'waiting_for_start_date';
            state.selectedGame = selectedGame;
            userStates[userId] = state;
            logger.info(`User ${userId} selected game: ${selectedGame}. Waiting for start date.`);
            await bot.sendMessage(userId, `✅ You have selected **${selectedGame}**!\n\nPlease send the *start date and time in UTC* in the format \`YYYY-MM-DD HH:mm\`. \n\n*Example:* \`2025-09-25 14:30\``, { parse_mode: 'Markdown' });
        } else if (callbackData === 'show_close_options') {
            const activeGames = await getActiveGames();
            if (activeGames.length === 0) {
                return await bot.sendMessage(userId, 'There are no active events to close.', { reply_markup: { inline_keyboard: [[{ text: "◀️ Back", callback_data: 'back_to_main' }]] } });
            }
            const closeButtons = activeGames.map(game => [{ text: `Close ${GAME_INFO[game].name}`, callback_data: `close_event_${game}` }]);
            const options = { reply_markup: { inline_keyboard: [...closeButtons, [{ text: "◀️ Back", callback_data: 'back_to_main' }]] } };
            await bot.sendMessage(userId, 'Please select the event you want to close:', options);
        } else if (callbackData.startsWith('close_event_')) {
            const gameToClose = callbackData.substring(12);
            logger.info(`User ${userId} requested to close event for game: ${gameToClose}.`);
            await processEvent(bot, gameToClose);
            await bot.sendMessage(userId, `✅ You have closed **${gameToClose}**!`, { parse_mode: 'Markdown' });
            userStates[userId] = {};
            await bot.sendMessage(userId, await getStatusMessage(), { parse_mode: 'Markdown' });
        } else if (callbackData.startsWith('manage_schedule_')) {
            const eventId = callbackData.substring(16);
            const jobInfo = scheduledJobs[eventId];
            if (!jobInfo) {
                 return await bot.sendMessage(userId, "❌ The selected schedule was not found or has already finished.");
            }
            const message = `Manage **${jobInfo.game}** Event\n*ID:* \`${eventId}\`\n*Start Time:* \`${jobInfo.startDateTime}\`\n*Duration:* ${jobInfo.duration}`;
            const keyboard = [
                [{ text: '❌ Delete Schedule', callback_data: `delete_schedule_${eventId}` }],
                [{ text: '◀️ Back to Schedules', callback_data: 'back_to_schedules' }]
            ];
            await bot.sendMessage(userId, message, {
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: keyboard }
            });
        } else if (callbackData.startsWith('delete_schedule_')) {
            const eventId = callbackData.substring(16);
            const jobInfo = scheduledJobs[eventId];
            if (jobInfo) {
                // Cancel the start and end jobs
                jobInfo.start.cancel();
                jobInfo.end.cancel();
                delete scheduledJobs[eventId];
                await bot.sendMessage(userId, `🗑️ Schedule for **${jobInfo.game}** (ID: \`${eventId}\`) has been deleted.`, { parse_mode: 'Markdown' });
            } else {
                await bot.sendMessage(userId, `❌ The schedule with ID \`${eventId}\` was not found.`, { parse_mode: 'Markdown' });
            }
        } else if (callbackData === 'confirm_schedule') {
            const { selectedGame, startDateTime, duration, eventId } = state;
            if (selectedGame && startDateTime && duration && eventId) {
                await scheduleEvent(userId, selectedGame, startDateTime, duration, eventId);
                await bot.sendMessage(userId, `🎉 **Event Scheduled!**\n\n*Game:* ${selectedGame}\n*Start Time (UTC):* \`${startDateTime}\`\n*Duration:* ${duration}\n*Event ID:* \`${eventId}\``, { parse_mode: 'Markdown' });
                userStates[userId] = {};
            }
        } else if (callbackData === 'cancel_schedule') {
            userStates[userId] = {};
            await bot.sendMessage(userId, `❌ Event scheduling canceled.`, { reply_markup: { remove_keyboard: true } });
        } else if (callbackData === 'back_to_main') {
            userStates[userId] = {};
            await bot.sendMessage(userId, `🎉 Welcome back! Please choose a game from the options below:`, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: GAME_INFO['2048'].name, callback_data: 'select_2048' }],
                        [{ text: GAME_INFO['Color Memory'].name, callback_data: 'select_Color Memory' }],
                        [{ text: GAME_INFO['Math Battle'].name, callback_data: 'select_Math Battle' }],
                        [{ text: "▶️ Close an Event", callback_data: 'show_close_options' }],
                    ]
                }
            });
        } else if (callbackData === 'back_to_schedules') {
            userStates[userId] = {};
            // Re-run the /schedules command logic to display the list again
            const eventIds = Object.keys(scheduledJobs);
            if (eventIds.length === 0) {
                return bot.sendMessage(userId, "There are no active scheduled events.");
            }
    
            const keyboard = eventIds.map(eventId => {
                const jobInfo = scheduledJobs[eventId];
                const gameName = GAME_INFO[jobInfo.game].name;
                return [{ text: `${gameName} - ID: ${eventId}`, callback_data: `manage_schedule_${eventId}` }];
            });
            
            await bot.sendMessage(userId, "📋 **Active Scheduled Events:**\n\nPlease select an event to manage:", {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: keyboard
                }
            });
        }
    });

    bot.on('message', async (msg) => {
        const userId = msg.from.id;
        const text = msg.text;
        const state = userStates[userId] || {};

        if (state.flow === 'waiting_for_start_date') {
            if (!moment.utc(text, 'YYYY-MM-DD HH:mm', true).isValid()) {
                return bot.sendMessage(userId, '❌ Invalid date/time format. Please use `YYYY-MM-DD HH:mm` and make sure it is a valid date.');
            }
            state.startDateTime = text;
            state.flow = 'waiting_for_duration';
            userStates[userId] = state;
            await bot.sendMessage(userId, `✅ Start time saved. Now, please send the *tournament duration* (e.g., \`1 day\`, \`3 hours\`, \`20 minutes\`).`, { parse_mode: 'Markdown' });
        } else if (state.flow === 'waiting_for_duration') {
            const match = text.match(/^(\d+)\s*(day|days|hour|hours|minute|minutes)$/i);
            if (!match) {
                return bot.sendMessage(userId, '❌ Invalid duration format. Please use a number followed by "day", "hour", or "minute".');
            }
            state.duration = text;
            state.flow = 'waiting_for_eventId';
            userStates[userId] = state;
            await bot.sendMessage(userId, `✅ Duration saved. Now, please send the *Event ID*.`);
        } else if (state.flow === 'waiting_for_eventId') {
            state.eventId = text;
            const confirmMessage = `Please confirm the following details:\n\n*Game:* ${state.selectedGame}\n*Start Time (UTC):* \`${state.startDateTime}\`\n*Duration:* ${state.duration}\n*Event ID:* \`${state.eventId}\`\n\nIs this correct?`;
            const confirmOptions = {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Confirm', callback_data: 'confirm_schedule' }],
                        [{ text: '❌ Cancel', callback_data: 'cancel_schedule' }],
                    ]
                }
            };
            await bot.sendMessage(userId, confirmMessage, confirmOptions);
            state.flow = 'waiting_for_confirmation';
        }
    });

    bot.on("polling_error", (error) => logger.error(`Telegram Polling Error: ${error.message}`));
    logger.info("Telegram Bot initialized and is now listening for commands...");
}

startListening();

module.exports = {
    bot,
    isUserAdmin,
    startListening,
};