'use strict';
require('dotenv').config({ quiet: true });
const TelegramBot = require('node-telegram-bot-api');
const logger = require('./logger');
const { storeEvent } = require('./eventRunner');
const { processEvent } = require('./eventCloser');
const fs = require('fs/promises');
const path = require('path');

const token = process.env.BOT_TOKEN;
if (!token) {
    throw new Error('Telegram BOT_TOKEN is not configured in .env file.');
}

const REQUIRED_CHANNEL_ID = process.env.REQUIRED_CHANNEL_ID || '@MOMIS_studio';

const bot = new TelegramBot(token, { polling: true });

// A more robust state management for each user
let userStates = {};

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
        logger.info(`Membership check for user ${userId}: Status='${chatMember.status}', IsAdmin=${isAdmin}`);
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
            if (fileContent.includes('ONTON_EVENT_UUID="')) {
                activeGames.push(key);
            }
        } catch (error) {
            logger.error(`Error reading .env for ${key}: ${error.message}`);
        }
    }
    return activeGames;
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

    // New /status handler
    bot.onText(/^\/status$/, async (msg) => {
        const userId = msg.from.id;
        const isAdmin = await isUserAdmin(userId);
        if (!isAdmin) return;

        const statusMessage = await getStatusMessage();
        await bot.sendMessage(userId, statusMessage, { parse_mode: 'Markdown' });
    });

    // Helper function to generate status message
    async function getStatusMessage() {
        let status = "*Current Event Status:*\n\n";
        for (const [gameKey, gameValue] of Object.entries(GAME_INFO)) {
            try {
                const fileContent = await fs.readFile(gameValue.envPath, 'utf8');
                const match = fileContent.match(/ONTON_EVENT_UUID="([^"]+)"/);
                if (match) {
                    status += `✅ *${gameKey}*: Active (ID: \`${match[1]}\`)\n`;
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

        const state = userStates[userId];

        if (callbackData.startsWith('select_')) {
            const selectedGame = callbackData.substring(7);
            state.flow = 'waiting_for_eventId';
            state.selectedGame = selectedGame;
            logger.info(`User ${userId} selected game: ${selectedGame}. Waiting for eventId.`);
            await bot.sendMessage(userId, `✅ You have selected **${selectedGame}**! Please send the *Event ID* now.`, { parse_mode: 'Markdown' });
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
            await processEvent(gameToClose);
            await bot.sendMessage(userId, `✅ You have closed **${gameToClose}**!`, { parse_mode: 'Markdown' });
            state.flow = null;
            await bot.sendMessage(userId, await getStatusMessage(), { parse_mode: 'Markdown' });
        } else if (callbackData === 'confirm_event') {
            const { selectedGame, eventId } = state;
            if (selectedGame && eventId) {
                await storeEvent(selectedGame, eventId);
                await bot.sendMessage(userId, `✅ The Event ID has been saved as: **${eventId}**! \nNow choose another game if you want.`, { parse_mode: 'Markdown' });
                state.flow = null;
                state.selectedGame = null;
                state.eventId = null;
            }
        } else if (callbackData === 'cancel_event') {
            state.flow = null;
            state.selectedGame = null;
            state.eventId = null;
            await bot.sendMessage(userId, `❌ Event creation canceled.`, { reply_markup: { remove_keyboard: true } });
        } else if (callbackData === 'back_to_main') {
            state.flow = null;
            state.selectedGame = null;
            state.eventId = null;
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
        }
    });

    bot.on('message', async (msg) => {
        const userId = msg.from.id;
        const text = msg.text;
        const state = userStates[userId];

        if (state && state.flow === 'waiting_for_eventId') {
            state.eventId = text;
            logger.info(`User ${userId} sent Event Id: ${state.eventId} for game: ${state.selectedGame}`);
            
            const confirmMessage = `Please confirm the following details:\n\n*Game:* ${state.selectedGame}\n*Event ID:* \`${state.eventId}\`\n\nIs this correct?`;
            const confirmOptions = {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '✅ Confirm', callback_data: 'confirm_event' }],
                        [{ text: '❌ Cancel', callback_data: 'cancel_event' }],
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