'use strict';
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const logger = require('./logger');

const token = process.env.BOT_TOKEN;
if (!token) {
    throw new Error('Telegram BOT_TOKEN is not configured in .env file.');
}

// خواندن متغیرها از فایل تنظیمات
const REQUIRED_CHANNEL_ID = process.env.REQUIRED_CHANNEL_ID || '@MOMIS_studio';

const bot = new TelegramBot(token);

// --- Channel Membership Check (Simplified) ---
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
        const selectedGame = callbackQuery.data; // مقدار callback_data در اینجا ذخیره می‌شود

        // پاسخ به کلیک کاربر برای جلوگیری از نمایش "در حال بارگذاری"
        await bot.answerCallbackQuery(callbackQuery.id);

        logger.info(`User ${userId} selected the game: ${selectedGame}`);

        // در اینجا می‌توانید منطق مربوط به هر بازی را اجرا کنید.
        // برای مثال، ارسال یک پیام تأیید:
        const message = `✅ You have selected **${selectedGame}**!`;
        await bot.sendMessage(userId, message, { parse_mode: "Markdown" });
    });

    bot.startPolling();
    bot.on("polling_error", (error) => logger.error(`Telegram Polling Error: ${error.message}`));
    logger.info("Telegram Bot initialized and is now listening for commands...");
}

module.exports = {
    bot,
    isUserAdmin,
    startListening,
};