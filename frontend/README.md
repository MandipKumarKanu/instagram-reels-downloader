# 🎨 Reel Downloader Frontend

The **Neo-Brutalist** React interface for the Reel Downloader.

## 🖌 Design System
*   **Style**: Neo-Brutalism
*   **Colors**: Vivid Purple (`#8c52ff`), Yellow (`#ffde00`), Pink (`#ff69b4`), Cyan (`#00ffff`), Black/White.
*   **Typography**: Monospace / Courier New.
*   **Elements**: Hard shadows (`box-shadow: 4px 4px 0px 0px black`), thick borders (`2px - 4px`), high contrast.

## 🛠 Setup

1.  **Install Dependencies**:
    ```bash
    npm install
    ```

2.  **Configure Environment**:
    Copy the example file:
    ```bash
    cp .env.example .env
    ```
    Ensure `VITE_BACKEND_URL` points to your backend (default: `http://localhost:5000`).

3.  **Run Development Server**:
    ```bash
    npm run dev
    ```

## 🏗 Structure
*   `src/App.jsx`: Main UI logic, layout, and state management.
*   `src/App.css`: Tailwind configuration and custom Neo-Brutalist utility classes.
*   `src/main.jsx`: Entry point.
