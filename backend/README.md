# 🔙 Reel Downloader Backend

The minimal Node.js server powering the Reel Downloader.

## ⚡ Setup

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Start Server**:
    ```bash
    npm start
    ```
    Runs on **Port 5000** by default.

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
