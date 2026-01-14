const TelegramBot = require("node-telegram-bot-api");
const { instagramGetUrl } = require("./lib/instagram");

const token = process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.warn(
    "[Telegram Bot] TELEGRAM_BOT_TOKEN is missing. Bot will not start."
  );
  return;
}

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, { polling: true });

console.log("Telegram bot is running...");

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const messageText = msg.text;

  if (!messageText) return;

  // Simple regex to check for instagram links
  const isInstagram = /instagram\.com\/(p|reel|reels|tv|stories|share)\//.test(
    messageText
  );

  if (isInstagram) {
    bot.sendMessage(chatId, "Processing your Instagram link... ⏳");

    try {
      const result = await instagramGetUrl(messageText);
      const media = result.media_details;

      if (!media || media.length === 0) {
        return bot.sendMessage(
          chatId,
          "Sorry, I couldn't find any media in that link."
        );
      }

      if (media.length === 1) {
        const item = media[0];
        if (item.type === "video") {
          await bot.sendVideo(chatId, item.url, {
            caption: "Here is your video!",
          });
        } else {
          await bot.sendPhoto(chatId, item.url, {
            caption: "Here is your image!",
          });
        }
      } else {
        // Handle carousels
        const mediaGroup = media.map((item) => ({
          type: item.type === "video" ? "video" : "photo",
          media: item.url,
        }));

        // Telegram allows up to 10 items in a group
        const chunks = [];
        for (let i = 0; i < mediaGroup.length; i += 10) {
          chunks.push(mediaGroup.slice(i, i + 10));
        }

        for (const chunk of chunks) {
          await bot.sendMediaGroup(chatId, chunk);
        }
      }
    } catch (err) {
      console.error("Bot Error:", err.message);
      bot.sendMessage(chatId, `❌ Error: ${err.message}`);
    }
  } else if (messageText === "/start") {
    bot.sendMessage(
      chatId,
      "Welcome! Send me an Instagram link (Post, Reel, or Story) and I will download it for you."
    );
  }
});

// Error handling to keep the bot alive
bot.on("polling_error", (error) => {
  console.error("Polling error:", error.code);
});
