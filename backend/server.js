const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { instagramGetUrl } = require("./lib/instagram");

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

    const result = await instagramGetUrl(url);
    console.log("Download successful, sending result.");
    res.json(result);
  } catch (error) {
    console.error("Error fetching video:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch video", details: error.message });
  }
});

app.get("/api/proxy", async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).send("URL is required");
  }

  try {
    const response = await axios({
      url,
      method: "GET",
      responseType: "stream",
    });

    res.set("Content-Type", response.headers["content-type"]);
    res.set("Access-Control-Allow-Origin", "*");
    response.data.pipe(res);
  } catch (error) {
    console.error("Proxy error:", error.message);
    res.status(500).send("Failed to proxy image");
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
