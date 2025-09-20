'use strict';
require('dotenv').config({ quiet: true });
const TelegramBot = require('node-telegram-bot-api');
const logger = require('./logger');

const token = process.env.BOT_TOKEN;
if (!token) {
    throw new Error('Telegram BOT_TOKEN is not configured in .env file.');
}

// خواندن متغیرها از فایل تنظیمات
const REQUIRED_CHANNEL_ID = process.env.REQUIRED_CHANNEL_ID || '@MOMIS_studio';

const bot = new TelegramBot(token, { polling: true });

let selectedGame = null;


// --- Channel Membership Check ---
/**
 * Checks if the user is an administrator of the specified channel.
 * @param {number} userId - The user's Telegram ID.
 * @returns {Promise<boolean>} - True if the user is an administrator, false otherwise.
 */
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

// --- Main Bot Logic ---
function startListening() {
    // ---- هندلر برای دستور /start ----
    bot.onText(/^\/start$/, async (msg) => {
        const userId = msg.from.id;
        const firstName = msg.from.first_name;

        try {
            const isAdmin = await isUserAdmin(userId);

            if (!isAdmin) {
                return await bot.sendMessage(userId, 
                    `❌ Hello, *${firstName}*! This bot is restricted to administrators of the **MOMIS_studio** channel.`, 
                    { parse_mode: 'Markdown' }
                );
            }
            
            const welcomeText = `🎉 Welcome, *${firstName}*! Please choose a game from the options below:`;
            const options = {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🎲 2048", callback_data: '2048' }],
                        [{ text: "🎨 Color Memory", callback_data: 'Color Memory' }],
                        [{ text: "➕ Math Battle", callback_data: 'Math Battle' }]
                    ]
                }
            };
            await bot.sendMessage(userId, welcomeText, options);

        } catch (error) {
            logger.error(`Error in /start handler: ${error.message}`);
            await bot.sendMessage(userId, '❌ An error occurred. Please try again later.');
        }
    });

    // ---- هندلر برای مدیریت کلیک روی دکمه‌ها ----
    bot.on('callback_query', async (callbackQuery) => {
        const userId = callbackQuery.from.id;
        const callbackData = callbackQuery.data;

        await bot.answerCallbackQuery(callbackQuery.id);

        if (callbackData === 'back') {
            selectedGame = null;
            userStates[userId] = null; // پاک کردن حالت کاربر
            logger.info(`User ${userId} went back to the main menu. selectedGame is now null.`);
            
            const welcomeText = `🎉 Welcome back! Please choose a game from the options below:`;
            const options = {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🎲 2048", callback_data: '2048' }],
                        [{ text: "🎨 Color Memory", callback_data: 'Color Memory' }],
                        [{ text: "➕ Math Battle", callback_data: 'Math Battle' }]
                    ]
                }
            };
            await bot.sendMessage(userId, welcomeText, options);

        } else {
            selectedGame = callbackData;
            userStates[userId] = 'waiting_for_eventId'; // تنظیم حالت کاربر
            logger.info(`User ${userId} selected the game: ${selectedGame}. Waiting for eventId.`);

            const message = `✅ You have selected **${selectedGame}**!\nSend the Event Id`;
            const options = {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "◀️ Back", callback_data: 'back' }]
                    ]
                }
            };
            await bot.sendMessage(userId, message, options);
        }
    });

    // ---- هندلر جدید برای دریافت Event Id ----
    bot.onText(/(.*)/, async (msg) => {
        const userId = msg.from.id;
        const text = msg.text;

        // اگر کاربر در حالتی است که باید eventId ارسال کند
        if (userStates[userId] === 'waiting_for_eventId') {
            const eventId = text; // ذخیره پیام کاربر در متغیر eventId
            logger.info(`User ${userId} sent Event Id: ${eventId}`);

            // پاک کردن حالت کاربر برای جلوگیری از لوپ
            delete userStates[userId];

            // در اینجا می توانید از eventId و selectedGame برای انجام کارهای بعدی استفاده کنید
            await bot.sendMessage(userId, `Thank you! The Event Id has been saved as: **${eventId}**`, { parse_mode: 'Markdown' });
            // حالا میتوانید بقیه منطق برنامه را بر اساس eventId و selectedGame اجرا کنید
        }
    });

    // --- Start Polling and Error Handling ---
    bot.on("polling_error", (error) => logger.error(`Telegram Polling Error: ${error.message}`));
    logger.info("Telegram Bot initialized and is now listening for commands...");
}

startListening();

module.exports = {
    bot,
    isUserAdmin,
    startListening,
};