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

async function fetchInstagramMedia(url, retries = 3, delay = 1000) {
  const splitUrl = url.split("/");
  const postTags = ["p", "reel", "tv", "reels"];
  const indexShortcode =
    splitUrl.findIndex((item) => postTags.includes(item)) + 1;
  const shortcode = splitUrl[indexShortcode];

  if (!shortcode) {
    throw new Error("Could not extract shortcode from URL");
  }

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
    "Sec-Ch-Ua":
      '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    "Sec-Ch-Ua-Mobile": "?0",
    "Sec-Ch-Ua-Platform": '"Windows"',
  };

  const tokenResponse = await axios.get("https://www.instagram.com/", {
    headers: browserHeaders,
  });

  const cookies = tokenResponse.headers["set-cookie"];
  if (!cookies) {
    throw new Error("Could not get CSRF token");
  }

  const csrfCookie = cookies.find((c) => c.startsWith("csrftoken="));
  const csrfToken = csrfCookie
    ? csrfCookie.split(";")[0].replace("csrftoken=", "")
    : "";

  const BASE_URL = "https://www.instagram.com/graphql/query";
  const INSTAGRAM_DOCUMENT_ID = "9510064595728286";

  const dataBody = qs.stringify({
    variables: JSON.stringify({
      shortcode: shortcode,
      fetch_tagged_user_count: null,
      hoisted_comment_id: null,
      hoisted_reply_id: null,
    }),
    doc_id: INSTAGRAM_DOCUMENT_ID,
  });

  const cookieString = cookies.map((c) => c.split(";")[0]).join("; ");

  try {
    const { data } = await axios.post(BASE_URL, dataBody, {
      headers: {
        ...browserHeaders,
        "X-CSRFToken": csrfToken,
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieString,
        "X-Instagram-AJAX": "1",
        "X-Requested-With": "XMLHttpRequest",
      },
    });

    if (!data.data?.xdt_shortcode_media) {
      throw new Error(
        "Only posts/reels supported, check if your link is valid."
      );
    }

    const mediaData = data.data.xdt_shortcode_media;
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
      // Single media
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
  } catch (err) {
    if (
      err.response &&
      [429, 403, 401].includes(err.response.status) &&
      retries > 0
    ) {
      const waitTime = delay;
      await new Promise((res) => setTimeout(res, waitTime));
      return fetchInstagramMedia(url, retries - 1, delay * 2);
    }
    throw err;
  }
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
