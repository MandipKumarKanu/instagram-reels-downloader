const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const axios = require("axios");
const { instagramGetUrl, getStoriesByUsername } = require("./lib/instagram");

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminId = process.env.ADMIN_ID;
const jsonBinApiKey = process.env.JSONBIN_API_KEY_X_MASTER_KEY;
const jsonBinId = process.env.JSONBIN_BIN_ID;

if (!token) {
  console.warn(
    "[Telegram Bot] TELEGRAM_BOT_TOKEN is missing. Bot will not start."
  );
  return;
}

// Memory Cache for Stats
let cachedStats = { users: [], total_downloads: 0 };

async function initStats() {
  try {
    if (!jsonBinApiKey || !jsonBinId) {
      console.warn(
        "⚠️ JSONBin credentials missing. Stats will not be persisted."
      );
      return;
    }
    const response = await axios.get(
      `https://api.jsonbin.io/v3/b/${jsonBinId}/latest`,
      {
        headers: { "X-Master-Key": jsonBinApiKey },
      }
    );
    cachedStats = response.data.record;
    console.log("✅ Stats loaded from JsonBin");
  } catch (error) {
    console.error("❌ Failed to load stats from JsonBin:", error.message);
  }
}

// Save stats to JsonBin (Fire-and-forget style to not block bot)
async function saveStatsBackground() {
  try {
    if (!jsonBinApiKey || !jsonBinId) return;
    await axios.put(`https://api.jsonbin.io/v3/b/${jsonBinId}`, cachedStats, {
      headers: {
        "Content-Type": "application/json",
        "X-Master-Key": jsonBinApiKey,
      },
    });
  } catch (error) {
    console.error("❌ Error saving stats to JsonBin:", error.message);
  }
}

function updateStats(userId) {
  if (!cachedStats.users.includes(userId)) {
    cachedStats.users.push(userId);
  }
  cachedStats.total_downloads = (cachedStats.total_downloads || 0) + 1;
  saveStatsBackground(); // Run in background
}

// Create a bot
const bot = new TelegramBot(token, { polling: true });

// Initialize Stats on Start
initStats();

console.log("Telegram bot is running...");

// Helper to format caption
function formatCaption(result) {
  const info = result.post_info;
  if (!info) return "Here is your media!";

  const author = info.owner_username
    ? `@${info.owner_username}`
    : "Instagram User";
  const capt = info.caption
    ? info.caption
        .substring(0, 50)
        .replace(/\n/g, " ")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;") + "..."
    : "No caption";

  return `👤 <b>Author</b>: ${author}\n📝 <b>Capt</b>: ${capt}\n\nDownloaded via @ig_reels_posts_downloader_bot`;
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const messageText = msg.text;

  if (!messageText) return;

  // Admin Broadcast
  if (messageText.startsWith("/broadcast") && userId.toString() === adminId) {
    const broadcastMsg = messageText.replace("/broadcast", "").trim();
    if (!broadcastMsg)
      return bot.sendMessage(
        chatId,
        "Please provide a message: `/broadcast Text`",
        { parse_mode: "Markdown" }
      );

    const stats = cachedStats;
    bot.sendMessage(
      chatId,
      `Starting broadcast to ${stats.users.length} users...`
    );

    let success = 0;
    for (const uId of stats.users) {
      try {
        await bot.sendMessage(uId, `📢 **Broadcast**\n\n${broadcastMsg}`, {
          parse_mode: "HTML",
        });
        success++;
      } catch (e) {}
    }
    return bot.sendMessage(
      chatId,
      `Broadcast complete! Successfully sent to ${success} users.`
    );
  }

  // Stats command for admin
  if (messageText === "/stats" && userId.toString() === adminId) {
    // Use cached stats
    return bot.sendMessage(
      chatId,
      `📊 **Bot Statistics**\n\nTotal Users: ${cachedStats.users.length}\nTotal Downloads: ${cachedStats.total_downloads}`,
      { parse_mode: "Markdown" }
    );
  }

  // 1. Detection
  const isInstagramUrl =
    /instagram\.com\/(p|reel|reels|tv|stories|share)\//.test(messageText);
  const isUsername = /^@[a-zA-Z0-9._]+$/.test(messageText);
  const isStoryCommand = messageText.startsWith("/story");

  if (isInstagramUrl || isUsername || isStoryCommand) {
    bot.sendMessage(
      chatId,
      `Processing ${isUsername || isStoryCommand ? "stories" : "link"}... ⏳`
    );

    try {
      let result;
      if (isUsername || isStoryCommand) {
        const username = isUsername
          ? messageText.replace("@", "")
          : messageText.replace("/story", "").trim().replace("@", "");

        if (!username)
          return bot.sendMessage(
            chatId,
            "Please provide a username, e.g. `/story cristiano`",
            { parse_mode: "HTML" }
          );

        result = await getStoriesByUsername(username);
      } else {
        result = await instagramGetUrl(messageText);
      }

      const media = result.media_details;
      if (!media || media.length === 0) {
        return bot.sendMessage(chatId, "Sorry, I couldn't find any media.");
      }

      updateStats(userId);
      const caption = formatCaption(result);

      await sendMediaResult(chatId, media, caption, messageText);
    } catch (err) {
      console.error("Bot Error:", err.message);
      const msg = err.message.toLowerCase();
      if (
        msg.includes("does not exist") ||
        msg.includes("private") ||
        msg.includes("restricted")
      ) {
        bot.sendMessage(chatId, `❌ **Error:** ${err.message}`, {
          parse_mode: "Markdown",
        });
      } else {
        bot.sendMessage(
          chatId,
          "📉 **Could not fetch media.**\n\nSometimes things just don't work out.",
          { parse_mode: "Markdown" }
        );
      }
    }
  } else if (messageText === "/start" || messageText === "/help") {
    const welcomeMessage = `
👋 <b>Welcome to Instagram Downloader Bot!</b>

I can help you download content from Instagram effortlessly. 🚀

<b>What I can do:</b>
📸 <b>Posts & Reels</b>: Just send the link.
📖 <b>Stories</b>: Paste a specific story link, or use <code>/story username</code>.
📺 <b>IGTV</b>: Just send the link.

<b>How to use:</b>
1️⃣ Paste a link (e.g., <code>https://www.instagram.com/reel/...</code>)
2️⃣ Wait for a few seconds.
3️⃣ Get your media directly in the chat!

✨ <i>No login required. Fast & Free!</i>

👇 <b>Try it now by sending a link!</b>
    `;
    bot.sendMessage(chatId, welcomeMessage, { parse_mode: "HTML" });
  } else {
    try {
      const response = await axios.get("https://naas.isalman.dev/no");
      const excuse =
        response.data.reason ||
        "I'm part of a top-secret project called Project No.";
      bot.sendMessage(
        chatId,
        `🤖 **I can't do that.**\n\n${excuse}\n\n_(Send /start to see what I can actually do)_`,
        { parse_mode: "Markdown" }
      );
    } catch (e) {
      bot.sendMessage(
        chatId,
        "🧐 **Oops! I don't recognize that.**\n\nPlease send me a valid Instagram link (Reel, Post, or Story).",
        { parse_mode: "HTML" }
      );
    }
  }
});

async function sendMediaResult(chatId, media, caption, originalText) {
  const opts = {
    caption: caption,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "🖼️ HD Thumbnail",
            url: media[0].thumbnail || media[0].url,
          },
          {
            text: "🔗 Open Link",
            url: originalText.startsWith("@")
              ? `https://instagram.com/${originalText.replace("@", "")}`
              : originalText,
          },
        ],
      ],
    },
  };

  if (media.length === 1) {
    const item = media[0];
    if (item.type === "video") {
      await bot.sendVideo(chatId, item.url, opts);
    } else {
      await bot.sendPhoto(chatId, item.url, opts);
    }
  } else {
    // Handle carousels/story groups
    const mediaGroup = media.map((item, idx) => ({
      type: item.type === "video" ? "video" : "photo",
      media: item.url,
      caption: idx === 0 ? caption : "",
      parse_mode: "HTML",
    }));

    const chunks = [];
    for (let i = 0; i < mediaGroup.length; i += 10) {
      chunks.push(mediaGroup.slice(i, i + 10));
    }

    for (const chunk of chunks) {
      await bot.sendMediaGroup(chatId, chunk);
    }
  }
}

bot.on("polling_error", (error) => {
  console.error("Polling error:", error.code);
});
