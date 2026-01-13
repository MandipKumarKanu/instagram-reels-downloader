const express = require("express");
const cors = require("cors");
const axios = require("axios");
const qs = require("qs");

const app = express();
app.use(
  cors({
    origin: [
      "https://reel-downloader.mandipkk.com.np",
      "http://localhost:5173",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

function extractShortcode(url) {
  const splitUrl = url.split("/");
  const postTags = ["p", "reel", "tv", "reels"];
  const indexShortcode =
    splitUrl.findIndex((item) => postTags.includes(item)) + 1;
  return splitUrl[indexShortcode]?.split("?")[0];
}

// Method 1: Direct GraphQL approach
async function fetchViaGraphQL(shortcode) {
  const browserHeaders = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    Origin: "https://www.instagram.com",
    Referer: "https://www.instagram.com/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
  };

  const tokenResponse = await axios.get("https://www.instagram.com/", {
    headers: browserHeaders,
    timeout: 10000,
  });

  const cookies = tokenResponse.headers["set-cookie"];
  if (!cookies) throw new Error("No cookies");

  const csrfCookie = cookies.find((c) => c.startsWith("csrftoken="));
  const csrfToken = csrfCookie
    ? csrfCookie.split(";")[0].replace("csrftoken=", "")
    : "";
  const cookieString = cookies.map((c) => c.split(";")[0]).join("; ");

  const dataBody = qs.stringify({
    variables: JSON.stringify({
      shortcode: shortcode,
      fetch_tagged_user_count: null,
      hoisted_comment_id: null,
      hoisted_reply_id: null,
    }),
    doc_id: "9510064595728286",
  });

  const { data } = await axios.post(
    "https://www.instagram.com/graphql/query",
    dataBody,
    {
      headers: {
        ...browserHeaders,
        "X-CSRFToken": csrfToken,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieString,
      },
      timeout: 15000,
    }
  );

  if (!data.data?.xdt_shortcode_media) throw new Error("No media data");
  return parseMediaData(data.data.xdt_shortcode_media);
}

// Method 2: Using saveig.app API (free public service)
async function fetchViaSaveIG(url) {
  const { data } = await axios.post(
    "https://saveig.app/api/ajaxSearch",
    `q=${encodeURIComponent(url)}&t=media&lang=en`,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Origin: "https://saveig.app",
        Referer: "https://saveig.app/en",
      },
      timeout: 15000,
    }
  );

  if (data.status !== "ok" || !data.data) throw new Error("SaveIG failed");

  // Parse HTML response to extract video URLs
  const videoMatches = data.data.match(/href="([^"]+)"/g) || [];
  const urls = videoMatches
    .map((m) => m.replace('href="', "").replace('"', ""))
    .filter((u) => u.includes(".mp4") || u.includes("fbcdn.net"));

  if (urls.length === 0) throw new Error("No video URLs found");

  return {
    results_number: urls.length,
    url_list: urls,
    media_details: urls.map((url) => ({ type: "video", url })),
  };
}

// Method 3: Using snapinsta.app API
async function fetchViaSnapInsta(url) {
  // First get the token
  const pageResp = await axios.get("https://snapinsta.app/", {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    },
    timeout: 10000,
  });

  const tokenMatch = pageResp.data.match(/name="token" value="([^"]+)"/);
  const token = tokenMatch ? tokenMatch[1] : "";

  const { data } = await axios.post(
    "https://snapinsta.app/action.php",
    `url=${encodeURIComponent(url)}&action=post&token=${token}`,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Origin: "https://snapinsta.app",
        Referer: "https://snapinsta.app/",
      },
      timeout: 15000,
    }
  );

  // Parse response for download links
  const urlMatches =
    data.match(/https:\/\/[^"'\s]+(?:\.mp4|scontent[^"'\s]+)/g) || [];
  const videoUrls = [...new Set(urlMatches)].filter(
    (u) => !u.includes("_n.jpg")
  );

  if (videoUrls.length === 0) throw new Error("SnapInsta: No URLs");

  return {
    results_number: videoUrls.length,
    url_list: videoUrls,
    media_details: videoUrls.map((url) => ({ type: "video", url })),
  };
}

// Method 4: Using igdownloader.app
async function fetchViaIGDownloader(url) {
  const { data } = await axios.post(
    "https://igdownloader.app/api/ajaxSearch",
    `recaptchaToken=&q=${encodeURIComponent(url)}&t=media&lang=en`,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Origin: "https://igdownloader.app",
        Referer: "https://igdownloader.app/",
      },
      timeout: 15000,
    }
  );

  if (data.status !== "ok" || !data.data)
    throw new Error("IGDownloader failed");

  const videoMatches = data.data.match(/href="([^"]+)"/g) || [];
  const urls = videoMatches
    .map((m) => m.replace('href="', "").replace('"', ""))
    .filter(
      (u) =>
        u.includes(".mp4") ||
        u.includes("fbcdn.net") ||
        u.includes("cdninstagram")
    );

  if (urls.length === 0) throw new Error("No URLs found");

  return {
    results_number: urls.length,
    url_list: urls,
    media_details: urls.map((url) => ({ type: "video", url })),
  };
}

// Parse Instagram media data from GraphQL response
function parseMediaData(mediaData) {
  const urlList = [];
  const mediaDetails = [];

  if (mediaData.__typename === "XDTGraphSidecar") {
    mediaData.edge_sidecar_to_children.edges.forEach((media) => {
      const node = media.node;
      if (node.is_video) {
        urlList.push(node.video_url);
        mediaDetails.push({
          type: "video",
          dimensions: node.dimensions,
          url: node.video_url,
          thumbnail: node.display_url,
        });
      } else {
        urlList.push(node.display_url);
        mediaDetails.push({
          type: "image",
          dimensions: node.dimensions,
          url: node.display_url,
        });
      }
    });
  } else {
    if (mediaData.is_video) {
      urlList.push(mediaData.video_url);
      mediaDetails.push({
        type: "video",
        dimensions: mediaData.dimensions,
        url: mediaData.video_url,
        thumbnail: mediaData.display_url,
      });
    } else {
      urlList.push(mediaData.display_url);
      mediaDetails.push({
        type: "image",
        dimensions: mediaData.dimensions,
        url: mediaData.display_url,
      });
    }
  }

  return {
    results_number: urlList.length,
    url_list: urlList,
    media_details: mediaDetails,
  };
}

// Main fetch function with multiple fallbacks
async function fetchInstagramMedia(url) {
  const shortcode = extractShortcode(url);
  if (!shortcode) throw new Error("Could not extract shortcode from URL");

  const methods = [
    { name: "GraphQL", fn: () => fetchViaGraphQL(shortcode) },
    { name: "SaveIG", fn: () => fetchViaSaveIG(url) },
    { name: "IGDownloader", fn: () => fetchViaIGDownloader(url) },
    { name: "SnapInsta", fn: () => fetchViaSnapInsta(url) },
  ];

  let lastError;
  for (const method of methods) {
    try {
      console.log(`Trying ${method.name}...`);
      const result = await method.fn();
      if (result && result.url_list && result.url_list.length > 0) {
        console.log(`${method.name} succeeded!`);
        return result;
      }
    } catch (err) {
      console.log(`${method.name} failed: ${err.message}`);
      lastError = err;
    }
  }

  throw lastError || new Error("All methods failed");
}

app.get("/", (req, res) => {
  res.send("API is running...");
});

app.get("/api/download", async (req, res) => {
  const { url } = req.query;
  if (!url) {
    console.warn("Request missing URL");
    return res.status(400).json({ error: "URL is required" });
  }

  console.log(`Processing download for: ${url}`);

  try {
    if (!url.includes("instagram.com")) {
      return res
        .status(400)
        .json({ error: "Only Instagram links are supported!" });
    }

    const result = await fetchInstagramMedia(url);
    console.log("Download successful, sending result.");
    res.json(result);
  } catch (error) {
    console.error("Error fetching video:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch video", details: error.message });
  }
});

const PORT = 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("--- System Checks ---");
  console.log("Instagram Module: Loaded");
  console.log("Mode: Instagram Only");
});

module.exports = app;
