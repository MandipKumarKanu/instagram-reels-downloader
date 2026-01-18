const TelegramBot = require("node-telegram-bot-api");
const path = require("path");
const axios = require("axios");
const {
  instagramGetUrl,
  getStoriesByUsername,
  getProfilePictureByUsername,
  getProfileByUsername,
  getHighlightsByUsername,
  getPostsByUsername,
  setErrorMonitor,
} = require("./lib/instagram");

// ============================================
// MULTI-PLATFORM SUPPORT (Cobalt API)
// ============================================

const COBALT_INSTANCES = [
  "https://co.eepy.today/",
  "https://api.cobalt.tools/",
];

// Detect platform from URL
function detectPlatform(url) {
  if (/instagram\.com/.test(url))
    return { platform: "instagram", emoji: "📸", name: "Instagram" };
  if (/tiktok\.com|vm\.tiktok/.test(url))
    return { platform: "tiktok", emoji: "🎵", name: "TikTok" };
  if (/twitter\.com|x\.com/.test(url))
    return { platform: "twitter", emoji: "🐦", name: "Twitter/X" };
  if (/facebook\.com|fb\.watch/.test(url))
    return { platform: "facebook", emoji: "👤", name: "Facebook" };
  if (/pinterest\.com|pin\.it/.test(url))
    return { platform: "pinterest", emoji: "📌", name: "Pinterest" };
  return null;
}

// Fetch media using Cobalt API (works for all platforms)
async function fetchViaCobalt(url) {
  let lastError;

  for (const instance of COBALT_INSTANCES) {
    try {
      console.log(`[Cobalt] Trying instance: ${instance}`);
      const response = await axios.post(
        instance,
        {
          url: url,
          downloadMode: "auto",
          videoQuality: "1080",
        },
        {
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          timeout: 30000,
        },
      );

      const data = response.data;

      if (data.status === "error") {
        lastError = new Error(data.text || "Cobalt failed");
        continue;
      }

      if (
        data.status === "redirect" ||
        data.status === "tunnel" ||
        data.status === "stream"
      ) {
        return {
          url_list: [data.url],
          media_details: [
            {
              type: "video",
              url: data.url,
              isTunnel: data.status === "tunnel", // Mark tunnel URLs
              filename: data.filename || "video.mp4",
            },
          ],
        };
      }

      if (data.status === "picker" && data.picker) {
        const urls = data.picker.map((p) => p.url);
        return {
          url_list: urls,
          media_details: data.picker.map((p) => ({
            type: p.type === "photo" ? "image" : "video",
            url: p.url,
            thumbnail: p.thumb,
            isTunnel: false,
          })),
        };
      }
    } catch (err) {
      console.log(`[Cobalt] Instance ${instance} failed:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error("All Cobalt instances failed");
}

// Max file size for buffer download (40MB - safe for Render free tier)
const MAX_BUFFER_SIZE = 40 * 1024 * 1024;

// Progress bar generator
function generateProgressBar(percent) {
  const filled = Math.round(percent / 10);
  const empty = 10 - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return bar;
}

// Download media as buffer for tunnel URLs with progress callback
async function downloadAsBuffer(url, onProgress) {
  let totalSize = 0;

  // First, check file size with HEAD request
  try {
    const headResponse = await axios.head(url, {
      timeout: 10000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    totalSize = parseInt(headResponse.headers["content-length"] || "0");
    if (totalSize > MAX_BUFFER_SIZE) {
      throw new Error(
        `Video too large (${(totalSize / 1024 / 1024).toFixed(1)}MB). Max: 40MB`,
      );
    }
  } catch (err) {
    // If HEAD fails, continue anyway (some servers don't support HEAD)
    if (err.message.includes("too large")) throw err;
    console.log("[Tunnel] HEAD request failed, proceeding with download...");
  }

  const response = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 120000, // 2 min timeout for larger files
    maxContentLength: MAX_BUFFER_SIZE,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    onDownloadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const percent = Math.round(
          (progressEvent.loaded / progressEvent.total) * 100,
        );
        onProgress(percent, progressEvent.loaded, progressEvent.total);
      } else if (onProgress && totalSize > 0) {
        const percent = Math.round((progressEvent.loaded / totalSize) * 100);
        onProgress(percent, progressEvent.loaded, totalSize);
      }
    },
  });

  const buffer = Buffer.from(response.data);
  console.log(
    `[Tunnel] Downloaded ${(buffer.length / 1024 / 1024).toFixed(2)} MB`,
  );

  return buffer;
}

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminId = process.env.ADMIN_ID;
const jsonBinApiKey = process.env.JSONBIN_API_KEY_X_MASTER_KEY;
const jsonBinId = process.env.JSONBIN_BIN_ID;

if (!token) {
  console.warn(
    "[Telegram Bot] TELEGRAM_BOT_TOKEN is missing. Bot will not start.",
  );
  return;
}

let cachedStats = { users: {}, total_downloads: 0 };

async function initStats() {
  try {
    if (!jsonBinApiKey || !jsonBinId) {
      console.warn(
        "⚠️ JSONBin credentials missing. Stats will not be persisted.",
      );
      return;
    }
    const response = await axios.get(
      `https://api.jsonbin.io/v3/b/${jsonBinId}/latest`,
      {
        headers: { "X-Master-Key": jsonBinApiKey },
      },
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
      total_downloads: 0,
    };
  }

  cachedStats.users[user].history.unshift(downloadLink);
  cachedStats.users[user].history = cachedStats.users[user].history.slice(0, 5);
  cachedStats.users[user].total_downloads =
    (cachedStats.users[user].total_downloads || 0) + 1;

  cachedStats.total_downloads = (cachedStats.total_downloads || 0) + 1;
  saveStatsBackground();
}

// Create a bot
const bot = new TelegramBot(token, { polling: true });
let botId;
bot.getMe().then((me) => {
  botId = me.id;
  console.log(`Bot authorized as @${me.username}`);
});

// Initialize Stats on Start
initStats();

console.log("Telegram bot is initialized...");

// Monitoring System: Alert admin on critical errors
const errorLog = [];
const MAX_ERROR_LOG = 50;

function logError(errorInfo) {
  errorLog.unshift({
    timestamp: new Date().toISOString(),
    ...errorInfo,
  });

  if (errorLog.length > MAX_ERROR_LOG) {
    errorLog.pop();
  }

  // Alert admin for critical errors
  if (adminId && errorInfo.type === "instagram_api_failure") {
    bot
      .sendMessage(
        adminId,
        `🚨 <b>Critical Error Alert</b>\n\n` +
          `<b>Type:</b> ${errorInfo.type}\n` +
          `<b>Error:</b> ${errorInfo.error}\n` +
          `<b>Attempts:</b> ${errorInfo.attempts}\n` +
          `<b>Time:</b> ${new Date().toLocaleString()}`,
        { parse_mode: "HTML" },
      )
      .catch(() => {}); // Silently fail if admin unreachable
  }
}

// Connect monitoring to Instagram module
setErrorMonitor(logError);

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

  const saveInstruction =
    "\n\n<i>To save: open the media, tap the 3 dots (top right), and select 'Save to gallery'.</i>";

  return `👤 <b>Author</b>: ${author}\n📝 <b>Capt</b>: ${capt}\n\nDownloaded via @media_downloader_savify_bot${saveInstruction}`;
}

// Rate Limiter: Prevent spam/abuse
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 3;

function checkRateLimit(userId) {
  const now = Date.now();
  const userKey = userId.toString();

  if (!rateLimitMap.has(userKey)) {
    rateLimitMap.set(userKey, []);
  }

  const userRequests = rateLimitMap.get(userKey);

  // Remove old requests outside the time window
  const recentRequests = userRequests.filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW,
  );

  if (recentRequests.length >= MAX_REQUESTS_PER_WINDOW) {
    return false; // Rate limit exceeded
  }

  // Add current request
  recentRequests.push(now);
  rateLimitMap.set(userKey, recentRequests);

  return true; // Allowed
}

const userPrompts = {};
const userLastDownload = new Map(); // Store last download for "download again"

// ============================================
// ENHANCED CALLBACK HANDLER (Buttons)
// ============================================
bot.on("callback_query", async (callbackQuery) => {
  const { data, message } = callbackQuery;
  const chatId = message.chat.id;
  const userId = callbackQuery.from.id;
  const messageId = message.message_id;

  // Answer callback to remove loading state
  bot.answerCallbackQuery(callbackQuery.id);

  // Instagram username prompts
  const prompts = {
    prompt_story: { cmd: "story", emoji: "📖", label: "Stories" },
    prompt_highlights: { cmd: "highlights", emoji: "✨", label: "Highlights" },
    prompt_posts: { cmd: "posts", emoji: "📂", label: "Posts" },
    prompt_pfp: { cmd: "pfp", emoji: "🖼️", label: "Profile Picture" },
  };

  if (prompts[data]) {
    const { emoji, label } = prompts[data];
    userPrompts[chatId] = prompts[data].cmd;

    await bot.sendMessage(
      chatId,
      `${emoji} <b>Download ${label}</b>\n\nSend me the Instagram username (without @):`,
      {
        parse_mode: "HTML",
        reply_markup: {
          force_reply: true,
          input_field_placeholder: "e.g. cristiano",
        },
      },
    );
    return;
  }

  // Main menu button
  if (data === "main_menu") {
    await showMainMenu(chatId);
    return;
  }

  // Download again
  if (data === "download_again") {
    const lastUrl = userLastDownload.get(userId);
    if (lastUrl) {
      await bot.sendMessage(chatId, "🔄 Re-downloading...");
      // Trigger the download again by simulating the message
      bot.emit("message", {
        chat: { id: chatId },
        from: { id: userId },
        text: lastUrl,
      });
    } else {
      await bot.sendMessage(
        chatId,
        "No previous download found. Send me a link!",
      );
    }
    return;
  }

  // Help sections
  if (data === "help_instagram") {
    await bot.sendMessage(
      chatId,
      `📸 <b>Instagram</b>\n\n` +
        `<b>Posts & Reels:</b> Just paste the link\n` +
        `<code>https://instagram.com/reel/ABC123</code>\n\n` +
        `<b>Commands:</b>\n` +
        `• /profile username - Profile info\n` +
        `• /story username - Download stories\n` +
        `• /highlights username - Get highlights\n` +
        `• /posts username - Latest posts\n` +
        `• /pfp username - Profile picture\n\n` +
        `💡 <i>Private accounts are not supported</i>`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "« Back to Menu", callback_data: "main_menu" }],
          ],
        },
      },
    );
    return;
  }

  if (data === "help_tiktok") {
    await bot.sendMessage(
      chatId,
      `🎵 <b>TikTok</b>\n\n` +
        `Download videos <b>without watermark!</b>\n\n` +
        `<b>Just paste the link:</b>\n` +
        `<code>https://tiktok.com/@user/video/123</code>\n` +
        `<code>https://vm.tiktok.com/abc123</code>\n\n` +
        `💡 <i>Supports short links too!</i>`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "« Back to Menu", callback_data: "main_menu" }],
          ],
        },
      },
    );
    return;
  }

  if (data === "help_twitter") {
    await bot.sendMessage(
      chatId,
      `🐦 <b>Twitter / X</b>\n\n` +
        `Download videos & GIFs\n\n` +
        `<b>Just paste the link:</b>\n` +
        `<code>https://twitter.com/user/status/123</code>\n` +
        `<code>https://x.com/user/status/123</code>\n\n` +
        `💡 <i>Works with both twitter.com and x.com</i>`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "« Back to Menu", callback_data: "main_menu" }],
          ],
        },
      },
    );
    return;
  }

  if (data === "help_facebook") {
    await bot.sendMessage(
      chatId,
      `👤 <b>Facebook</b>\n\n` +
        `Download reels & videos\n\n` +
        `<b>Just paste the link:</b>\n` +
        `<code>https://facebook.com/reel/123</code>\n` +
        `<code>https://fb.watch/abc123</code>\n\n` +
        `💡 <i>Public videos only</i>`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "« Back to Menu", callback_data: "main_menu" }],
          ],
        },
      },
    );
    return;
  }

  if (data === "help_pinterest") {
    await bot.sendMessage(
      chatId,
      `📌 <b>Pinterest</b>\n\n` +
        `Download videos & images\n\n` +
        `<b>Just paste the link:</b>\n` +
        `<code>https://pinterest.com/pin/123</code>\n` +
        `<code>https://pin.it/abc123</code>\n\n` +
        `💡 <i>Supports short links too!</i>`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "« Back to Menu", callback_data: "main_menu" }],
          ],
        },
      },
    );
    return;
  }

  if (data === "my_stats") {
    const user = userId.toString();
    const userData = cachedStats.users[user];
    const downloads = userData?.total_downloads || 0;
    const history = userData?.history || [];

    let statsMsg =
      `📊 <b>Your Statistics</b>\n\n` +
      `📥 <b>Total Downloads:</b> ${downloads}\n`;

    if (history.length > 0) {
      statsMsg += `\n📜 <b>Recent:</b>\n`;
      history.slice(0, 3).forEach((link, i) => {
        const platform = detectPlatform(link);
        statsMsg += `${i + 1}. ${platform?.emoji || "🔗"} ${link.substring(0, 40)}...\n`;
      });
    }

    await bot.sendMessage(chatId, statsMsg, {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "« Back to Menu", callback_data: "main_menu" }],
        ],
      },
    });
    return;
  }

  // Quick profile picture from profile view
  if (data.startsWith("quick_pfp_")) {
    const username = data.replace("quick_pfp_", "");
    try {
      const pfpData = await getProfilePictureByUsername(username);
      bot.sendPhoto(chatId, pfpData.url, {
        caption: `🖼️ Full profile picture of @${username}`,
        reply_markup: {
          inline_keyboard: [[{ text: "🔗 View Full Size", url: pfpData.url }]],
        },
      });
    } catch (err) {
      bot.sendMessage(chatId, `❌ Couldn't fetch profile picture.`);
    }
    return;
  }
});

// Show main menu
async function showMainMenu(chatId) {
  const menuMessage = `
🎬 <b>Media Downloader Bot</b>

<i>Download videos & images from your favorite platforms!</i>

━━━━━━━━━━━━━━━━━━━━━

<b>Quick Start:</b> Just paste any link!

<i>Or tap a platform below for help</i>
  `;

  await bot.sendMessage(chatId, menuMessage, {
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📸 Instagram", callback_data: "help_instagram" },
          { text: "🎵 TikTok", callback_data: "help_tiktok" },
        ],
        [
          { text: "🐦 Twitter/X", callback_data: "help_twitter" },
          { text: "👤 Facebook", callback_data: "help_facebook" },
        ],
        [
          { text: "📌 Pinterest", callback_data: "help_pinterest" },
        ],
        [{ text: "📊 My Stats", callback_data: "my_stats" }],
      ],
    },
  });
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  let messageText = msg.text;

  if (!messageText) return;

  // Check if this is a reply to a prompt
  if (
    msg.reply_to_message &&
    msg.reply_to_message.from.id === botId &&
    userPrompts[chatId]
  ) {
    const command = userPrompts[chatId];
    const username = messageText.trim().replace("@", "");
    messageText = `/${command} ${username}`;
    delete userPrompts[chatId]; // Clear the prompt state
  }

  // Admin Broadcast
  if (messageText.startsWith("/broadcast") && userId.toString() === adminId) {
    const broadcastMsg = messageText.replace("/broadcast", "").trim();
    if (!broadcastMsg)
      return bot.sendMessage(
        chatId,
        "Please provide a message: `/broadcast Text`",
        { parse_mode: "Markdown" },
      );

    const userIds = Object.keys(cachedStats.users);
    bot.sendMessage(chatId, `Starting broadcast to ${userIds.length} users...`);

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
      `Broadcast complete! Successfully sent to ${success} users.`,
    );
  }

  // Stats command for admin
  if (messageText === "/stats" && userId.toString() === adminId) {
    const userCount = Object.keys(cachedStats.users).length;
    return bot.sendMessage(
      chatId,
      `📊 **Bot Statistics**\n\nTotal Users: ${userCount}\nTotal Downloads: ${cachedStats.total_downloads}`,
      { parse_mode: "Markdown" },
    );
  }

  // 1. Platform Detection (Multi-platform support)
  const detectedPlatform = detectPlatform(messageText);
  const isInstagramUrl =
    detectedPlatform?.platform === "instagram" &&
    /instagram\.com\/(p|reel|reels|tv|stories|share)\//.test(messageText);
  const isOtherPlatformUrl =
    detectedPlatform && detectedPlatform.platform !== "instagram";

  const isStoryCommand = messageText.startsWith("/story");
  const isHighlightCommand = messageText.startsWith("/highlights");
  const isPostsCommand = messageText.startsWith("/posts");
  const isPfpCommand = messageText.startsWith("/pfp");
  const isProfileCommand = messageText.startsWith("/profile");
  const isUsername = /^@[a-zA-Z0-9._]+$/.test(messageText);

  // Check rate limit for download requests
  if (
    isInstagramUrl ||
    isOtherPlatformUrl ||
    isStoryCommand ||
    isPfpCommand ||
    isProfileCommand ||
    isHighlightCommand ||
    isPostsCommand
  ) {
    if (!checkRateLimit(userId)) {
      return bot.sendMessage(
        chatId,
        "☕ **Whoa there!**\n\nYou've been downloading quite a lot. Please have a cup of tea and try again in a minute. 🍵\n\n_This helps keep the bot running smoothly for everyone._",
        { parse_mode: "Markdown" },
      );
    }
  }

  // 2. Handle other platforms (TikTok, YouTube, Twitter, Facebook, Pinterest)
  if (isOtherPlatformUrl) {
    const { emoji, name, platform } = detectedPlatform;
    bot.sendMessage(chatId, `${emoji} Downloading from ${name}... ⏳`);

    try {
      const result = await fetchViaCobalt(messageText);
      const media = result.media_details;

      if (!media || media.length === 0) {
        return bot.sendMessage(chatId, "Sorry, I couldn't find any media.");
      }

      updateStats(userId, messageText);

      const saveInstruction =
        "\n\n<i>To save: open the media, tap the 3 dots (top right), and select 'Save to gallery'.</i>";
      const caption = `${emoji} <b>${name}</b>\n\nDownloaded via @media_downloader_savify_bot${saveInstruction}`;

      // Only use buffer download for TikTok (their tunnel URLs don't work with Telegram)
      const useBuffer = platform === "tiktok";
      await sendMediaResult(chatId, media, caption, messageText, useBuffer);
    } catch (err) {
      console.error(`${detectedPlatform.name} Error:`, err.message);
      bot.sendMessage(
        chatId,
        `❌ **Download Failed**\n\nCouldn't download from ${name}. The content might be private, deleted, or the service is temporarily unavailable.\n\n_Please try again later._`,
        { parse_mode: "Markdown" },
      );
    }
    return;
  }

  // 3. Handle Instagram URLs and commands
  if (
    isInstagramUrl ||
    isStoryCommand ||
    isHighlightCommand ||
    isPostsCommand
  ) {
    const commandType = isStoryCommand
      ? "stories"
      : isHighlightCommand
        ? "highlights"
        : isPostsCommand
          ? "posts"
          : "link";
    bot.sendMessage(chatId, `Processing ${commandType}... ⏳`);

    try {
      let result;
      if (isStoryCommand || isHighlightCommand || isPostsCommand) {
        const command = isStoryCommand
          ? "/story"
          : isHighlightCommand
            ? "/highlights"
            : "/posts";
        const username = messageText
          .replace(command, "")
          .trim()
          .replace("@", "");

        if (!username)
          return bot.sendMessage(
            chatId,
            `Please provide a username, e.g. \`${command} cristiano\``,
            { parse_mode: "Markdown" },
          );

        if (isStoryCommand) {
          result = await getStoriesByUsername(username);
        } else if (isHighlightCommand) {
          result = await getHighlightsByUsername(username);
        } else {
          result = await getPostsByUsername(username);
        }
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

      let userMessage =
        "I ran into an unexpected problem and couldn't fetch the media. Please try again later."; // Default message

      if (msg.includes("private") || msg.includes("restricted")) {
        userMessage =
          "This content is from a private account and I can't access it.";
      } else if (
        msg.includes("does not exist") ||
        msg.includes("not found") ||
        msg.includes("parse shortcode") ||
        msg.includes("invalid story link")
      ) {
        userMessage =
          "The link you sent seems to be invalid or the content has been deleted. Please check the link and try again.";
      } else if (msg.includes("story expired")) {
        userMessage = "This story is no longer available.";
      } else if (msg.includes("no active stories")) {
        userMessage = "This user doesn't have any active stories right now.";
      } else if (msg.includes("no highlights found")) {
        userMessage = "This user doesn't have any highlights.";
      } else if (msg.includes("no posts found")) {
        userMessage =
          "This user doesn't have any posts, or their account is private.";
      } else if (
        msg.includes("cookies missing") ||
        msg.includes("unauthorized") ||
        msg.includes("failed instagram request")
      ) {
        userMessage =
          "I'm having some technical difficulties connecting to Instagram at the moment. Please try again in a little while.";
      }

      bot.sendMessage(chatId, `❌ **Request Failed**\n\n${userMessage}`, {
        parse_mode: "Markdown",
      });
    }
  } else if (isPfpCommand) {
    bot.sendMessage(chatId, `Fetching profile picture... ⏳`);
    try {
      const username = messageText.replace("/pfp", "").trim().replace("@", "");
      if (!username) {
        return bot.sendMessage(
          chatId,
          "Please provide a username, e.g. `/pfp cristiano`",
          {
            parse_mode: "HTML",
          },
        );
      }

      const pfpData = await getProfilePictureByUsername(username);

      const saveInstruction =
        "\n\n<i>To save: open the media, tap the 3 dots (top right), and select 'Save to gallery'.</i>";
      const caption = `👤 <b>${pfpData.fullname}</b> (@${pfpData.username})${
        pfpData.is_private ? " (Private)" : ""
      }${saveInstruction}`;

      bot.sendPhoto(chatId, pfpData.url, {
        caption: caption,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [[{ text: "🔗 View Full Size", url: pfpData.url }]],
        },
      });
    } catch (err) {
      console.error("PFP Error:", err.message);
      const msg = err.message.toLowerCase();
      let userMessage =
        "I couldn't fetch the profile picture. Please try again later.";

      if (msg.includes("does not exist") || msg.includes("not found")) {
        userMessage =
          "I couldn't find a user with that username. Please check it and try again.";
      } else if (msg.includes("restricted")) {
        userMessage = "I am unable to access this user's profile.";
      }

      bot.sendMessage(chatId, `❌ **Request Failed**\n\n${userMessage}`, {
        parse_mode: "Markdown",
      });
    }
  } else if (isProfileCommand) {
    bot.sendMessage(chatId, `📊 Fetching profile info... ⏳`);
    try {
      const username = messageText.replace("/profile", "").trim().replace("@", "");
      if (!username) {
        return bot.sendMessage(
          chatId,
          "Please provide a username, e.g. `/profile cristiano`",
          {
            parse_mode: "Markdown",
          },
        );
      }

      const profile = await getProfileByUsername(username);

      // Format numbers nicely
      const formatNum = (num) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
        if (num >= 1000) return (num / 1000).toFixed(1) + "K";
        return num.toString();
      };

      let caption = `📸 <b>Instagram Profile</b>\n\n`;
      caption += `👤 <b>${profile.fullname || profile.username}</b>`;
      if (profile.is_verified) caption += ` ✓`;
      caption += `\n📛 @${profile.username}`;
      caption += profile.is_private ? `  🔒 <i>Private</i>` : `  🌐 <i>Public</i>`;
      caption += `\n\n`;
      
      caption += `👥 <b>${formatNum(profile.followers)}</b> followers\n`;
      caption += `➡️ <b>${formatNum(profile.following)}</b> following\n`;
      caption += `📷 <b>${formatNum(profile.posts_count)}</b> posts\n`;
      
      if (profile.category) {
        caption += `\n🏷️ ${profile.category}`;
      }
      
      if (profile.biography) {
        caption += `\n\n📝 <i>${profile.biography.substring(0, 200)}${profile.biography.length > 200 ? '...' : ''}</i>`;
      }
      
      if (profile.external_url) {
        caption += `\n\n🔗 ${profile.external_url}`;
      }

      const keyboard = [
        [{ text: "🖼️ Profile Pic", callback_data: `quick_pfp_${username}` }],
        [{ text: "🔗 Open on Instagram", url: `https://instagram.com/${username}` }],
      ];

      bot.sendPhoto(chatId, profile.profile_pic_url, {
        caption: caption,
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: keyboard,
        },
      });
    } catch (err) {
      console.error("Profile Error:", err.message);
      const msg = err.message.toLowerCase();
      let userMessage =
        "I couldn't fetch the profile. Please try again later.";

      if (msg.includes("does not exist") || msg.includes("not found")) {
        userMessage =
          "I couldn't find a user with that username. Please check it and try again.";
      } else if (msg.includes("restricted")) {
        userMessage = "I am unable to access this user's profile.";
      }

      bot.sendMessage(chatId, `❌ **Request Failed**\n\n${userMessage}`, {
        parse_mode: "Markdown",
      });
    }
  } else if (messageText === "/history") {
    const user = userId.toString();
    const userData = cachedStats.users[user];

    if (!userData || !userData.history || userData.history.length === 0) {
      return bot.sendMessage(chatId, "You have no download history yet.");
    }

    const historyLinks = userData.history
      .map((link, index) => `${index + 1}. ${link}`)
      .join("\n");

    const totalUserDownloads = userData.total_downloads || 0;

    bot.sendMessage(
      chatId,
      `📜 <b>Your Last 5 Downloads:</b>\n\n${historyLinks}\n\n📈 <b>Total Downloads:</b> ${totalUserDownloads}`,
      { parse_mode: "HTML" },
    );
  } else if (
    messageText === "/start" ||
    messageText === "/help" ||
    messageText === "/menu"
  ) {
    // Show the interactive main menu
    await showMainMenu(chatId);
  } else {
    // Unknown input - show helpful message with buttons
    await bot.sendMessage(
      chatId,
      `🤔 <b>I don't recognize that</b>\n\n` +
        `Send me a link from:\n` +
        `📸 Instagram • 🎵 TikTok • 🐦 Twitter\n` +
        `👤 Facebook • 📌 Pinterest\n\n` +
        `<i>Or use the menu below:</i>`,
      {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: [
            [{ text: "📋 Open Menu", callback_data: "main_menu" }],
          ],
        },
      },
    );
  }
});

// Send media result with progress for tunnel downloads (useBuffer = true for TikTok only)
async function sendMediaResult(
  chatId,
  media,
  caption,
  originalText,
  useBuffer = false,
) {
  const opts = {
    caption: caption,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [
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

    // Only use buffer download for TikTok (useBuffer=true), other platforms use direct URL
    if (useBuffer && item.isTunnel) {
      let progressMsg = null;
      let lastPercent = 0;

      try {
        // Send initial progress message
        progressMsg = await bot.sendMessage(
          chatId,
          `⬇️ <b>Downloading...</b>\n\n${generateProgressBar(0)} 0%`,
          { parse_mode: "HTML" },
        );

        console.log("[Tunnel] Downloading video buffer...");

        const buffer = await downloadAsBuffer(
          item.url,
          async (percent, loaded, total) => {
            // Update message every 10% to avoid rate limits
            if (percent >= lastPercent + 10 || percent === 100) {
              lastPercent = percent;
              const loadedMB = (loaded / 1024 / 1024).toFixed(1);
              const totalMB = (total / 1024 / 1024).toFixed(1);

              try {
                await bot.editMessageText(
                  `⬇️ <b>Downloading...</b>\n\n${generateProgressBar(percent)} ${percent}%\n\n` +
                    `<code>${loadedMB} MB / ${totalMB} MB</code>`,
                  {
                    chat_id: chatId,
                    message_id: progressMsg.message_id,
                    parse_mode: "HTML",
                  },
                );
              } catch (e) {
                // Ignore rate limit errors
              }
            }
          },
        );

        // Update to "Uploading to Telegram"
        try {
          await bot.editMessageText(
            `📤 <b>Uploading to Telegram...</b>\n\n${generateProgressBar(100)} 100%`,
            {
              chat_id: chatId,
              message_id: progressMsg.message_id,
              parse_mode: "HTML",
            },
          );
        } catch (e) {}

        if (item.type === "video") {
          await bot.sendVideo(chatId, buffer, opts, {
            filename: item.filename || "video.mp4",
            contentType: "video/mp4",
          });
        } else {
          await bot.sendPhoto(chatId, buffer, opts, {
            filename: "image.jpg",
            contentType: "image/jpeg",
          });
        }

        // Delete progress message after success
        try {
          await bot.deleteMessage(chatId, progressMsg.message_id);
        } catch (e) {}
      } catch (err) {
        console.error("[Tunnel] Download failed:", err.message);
        if (progressMsg) {
          try {
            await bot.editMessageText(
              `❌ <b>Download Failed</b>\n\n${err.message}`,
              {
                chat_id: chatId,
                message_id: progressMsg.message_id,
                parse_mode: "HTML",
              },
            );
          } catch (e) {}
        }
        throw new Error("Failed to download video from tunnel");
      }
    } else {
      // Direct URL - Telegram can fetch it
      if (item.type === "video") {
        await bot.sendVideo(chatId, item.url, opts);
      } else {
        await bot.sendPhoto(chatId, item.url, opts);
      }
    }
  } else {
    // Handle carousels/story groups
    const processedMedia = [];

    for (const item of media) {
      if (item.isTunnel) {
        try {
          const buffer = await downloadAsBuffer(item.url);
          processedMedia.push({
            type: item.type === "video" ? "video" : "photo",
            media: buffer,
          });
        } catch (err) {
          console.error("[Tunnel] Failed to download item:", err.message);
        }
      } else {
        processedMedia.push({
          type: item.type === "video" ? "video" : "photo",
          media: item.url,
        });
      }
    }

    if (processedMedia.length === 0) {
      throw new Error("No media could be processed");
    }

    // Add caption to first item
    processedMedia[0].caption = caption;
    processedMedia[0].parse_mode = "HTML";

    const chunks = [];
    for (let i = 0; i < processedMedia.length; i += 10) {
      chunks.push(processedMedia.slice(i, i + 10));
    }

    for (const chunk of chunks) {
      await bot.sendMediaGroup(chatId, chunk);
    }
  }
}

module.exports = bot;
