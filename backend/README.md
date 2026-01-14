# 🔙 Reel Downloader Backend

The minimal Node.js server powering the Reel Downloader.

## ⚡ Setup

1.  **Install Dependencies**:
    ```bash
    npm install
    ```
2.  **Environment Variables**
    Create a `.env` file by copying `.env.example` and fill in the required values. `PUBLIC_URL` should be the public URL of your Vercel deployment.

3.  **Start Server**:
    ```bash
    npm start
    ```
    Runs on **Port 5000** by default. The server will automatically set up the Telegram bot webhook on startup.

## 🔌 API Endpoints

### `GET /`
Health check. Returns `API is running...`.

### `GET /api/download`
Extracts the video URL from an Instagram link.

**Query Params:**
*   `url`: The Instagram Reel URL (e.g., `https://www.instagram.com/reel/xyz...`)

**Response:**
```json
{
  "url_list": ["https://cdn.instagram.com/...", ...]
}
```

## 📦 Deployment
Includes `vercel.json` for easy deployment on Vercel.
