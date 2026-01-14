const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const axios = require("axios");
const {
  instagramGetUrl,
  getStoriesByUsername,
  getProfilePictureByUsername,
} = require("./lib/instagram");

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

let cachedStats = { users: {}, total_downloads: 0 };

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
    // Defensive coding to handle old data format or empty bin
    if (!cachedStats.users || Array.isArray(cachedStats.users)) {
      cachedStats.users = {};
    }
    if (!cachedStats.total_downloads) {
      cachedStats.total_downloads = 0;
    }
    console.log("✅ Stats loaded from JsonBin");
  } catch (error) {
    console.error("❌ Failed to load stats from JsonBin:", error.message);
    // Set default stats if loading fails
    cachedStats = { users: {}, total_downloads: 0 };
  }
}

// Save stats to JsonBin
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

function updateStats(userId, downloadLink) {
  const user = userId.toString();
  if (!cachedStats.users[user]) {
    cachedStats.users[user] = {
      history: [],
    };
  }

  // Add to history and keep it at 5 items
  cachedStats.users[user].history.unshift(downloadLink);
  cachedStats.users[user].history = cachedStats.users[user].history.slice(0, 5);

  cachedStats.total_downloads = (cachedStats.total_downloads || 0) + 1;
  saveStatsBackground();
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

    const userIds = Object.keys(cachedStats.users);
    bot.sendMessage(
      chatId,
      `Starting broadcast to ${userIds.length} users...`
    );

    let success = 0;
    for (const uId of userIds) {
      try {
        await bot.sendMessage(uId, `📢 <b>Broadcast</b>\n\n${broadcastMsg}`, {
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
    const userCount = Object.keys(cachedStats.users).length;
    return bot.sendMessage(
      chatId,
      `📊 **Bot Statistics**\n\nTotal Users: ${userCount}\nTotal Downloads: ${cachedStats.total_downloads}`,
      { parse_mode: "Markdown" }
    );
  }

  // 1. Detection
  const isInstagramUrl =
    /instagram\.com\/(p|reel|reels|tv|stories|share)\//.test(messageText);
  const isStoryCommand = messageText.startsWith("/story");
  const isPfpCommand = messageText.startsWith("/pfp");
  const isUsername = /^@[a-zA-Z0-9._]+$/.test(messageText);

  if (isInstagramUrl || isStoryCommand) {
    bot.sendMessage(chatId, `Processing ${isStoryCommand ? "stories" : "link"}... ⏳`);

    try {
      let result;
      if (isStoryCommand) {
        const username = messageText.replace("/story", "").trim().replace("@", "");

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

      updateStats(userId, messageText);
      const caption = formatCaption(result);

      await sendMediaResult(chatId, media, caption, messageText);
    } catch (err) {
      console.error("Bot Error:", err.message);
      const msg = err.message.toLowerCase();

      let userMessage = "I ran into an unexpected problem and couldn't fetch the media. Please try again later."; // Default message

      if (msg.includes("private") || msg.includes("restricted")) {
        userMessage = "This content is from a private account and I can't access it.";
      } else if (msg.includes("does not exist") || msg.includes("not found") || msg.includes("parse shortcode") || msg.includes("invalid story link")) {
        userMessage = "The link you sent seems to be invalid or the content has been deleted. Please check the link and try again.";
      } else if (msg.includes("story expired")) {
        userMessage = "This story is no longer available.";
      } else if (msg.includes("no active stories")) {
        userMessage = "This user doesn't have any active stories right now.";
      } else if (msg.includes("cookies missing") || msg.includes("unauthorized") || msg.includes("failed instagram request")) {
        userMessage = "I'm having some technical difficulties connecting to Instagram at the moment. Please try again in a little while.";
      }

      bot.sendMessage(chatId, `❌ **Request Failed**\n\n${userMessage}`, {
        parse_mode: "Markdown",
      });
    }
  } else if (isPfpCommand || isUsername) {
    bot.sendMessage(chatId, `Fetching profile picture... ⏳`);
    try {
      const username = messageText.replace("/pfp", "").trim().replace("@", "");
      if (!username) {
        return bot.sendMessage(chatId, "Please provide a username, e.g. `/pfp cristiano` or `@cristiano`", {
          parse_mode: "HTML",
        });
      }

      const pfpData = await getProfilePictureByUsername(username);

      const caption = `👤 <b>${pfpData.fullname}</b> (@${pfpData.username})${pfpData.is_private ? " (Private)" : ""}`;

      bot.sendPhoto(chatId, pfpData.url, {
        caption: caption,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "⬇️ Download HD", url: pfpData.url }],
          ],
        },
      });
    } catch (err) {
      console.error("PFP Error:", err.message);
      const msg = err.message.toLowerCase();
      let userMessage = "I couldn't fetch the profile picture. Please try again later.";

      if (msg.includes("does not exist") || msg.includes("not found")) {
        userMessage = "I couldn't find a user with that username. Please check it and try again.";
      } else if (msg.includes("restricted")) {
        userMessage = "I am unable to access this user's profile.";
      }

      bot.sendMessage(chatId, `❌ **Request Failed**\n\n${userMessage}`, { parse_mode: "Markdown" });
    }
  } else if (messageText === "/history") {
    const user = userId.toString();
    const userHistory = cachedStats.users[user] ? cachedStats.users[user].history : [];

    if (userHistory.length === 0) {
      return bot.sendMessage(chatId, "You have no download history yet.");
    }

    const historyLinks = userHistory.map((link, index) => `${index + 1}. ${link}`).join("\n");
    bot.sendMessage(chatId, `📜 <b>Your Last 5 Downloads:</b>\n\n${historyLinks}`, { parse_mode: "HTML" });
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
    opts.reply_markup.inline_keyboard[0].push({
      text: "⬇️ Download",
      url: media[0].url,
    });

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

    const downloadButtons = media.map((item, idx) => ({
      text: `⬇️ Download Item ${idx + 1}`,
      url: item.url,
    }));

    const buttonRows = [];
    for (let i = 0; i < downloadButtons.length; i += 2) {
      buttonRows.push(downloadButtons.slice(i, i + 2));
    }

    if (buttonRows.length > 0) {
      await bot.sendMessage(chatId, "<b>Click to download:</b>", {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: buttonRows,
        },
      });
    }
  }
}

bot.on("polling_error", (error) => {
  console.error("Polling error:", error.code);
});
