import { useState } from "react";
import "./App.css";
import {
  FaDownload,
  FaBolt,
  FaChevronLeft,
  FaChevronRight,
  FaPaste,
  FaTimes,
} from "react-icons/fa";

async function fetchViaBackend(url) {
  const backendUrl =
    import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";
  const response = await fetch(
    `${backendUrl}/api/download?url=${encodeURIComponent(url)}`
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Backend failed");
  return result;
}

function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [currentMediaIndex, setCurrentMediaIndex] = useState(0);
  const [error, setError] = useState("");

  const handleDownload = async () => {
    if (!url) return;
    const isInstagram = url.includes("instagram.com");
    if (!isInstagram) {
      setError("Invalid link. Instagram only.");
      return;
    }

    setLoading(true);
    setError("");
    setData(null);
    setCurrentMediaIndex(0);

    try {
      console.log("Fetching from backend...");
      const result = await fetchViaBackend(url);
      if (result) {
        console.log("Backend succeeded!");
        setData(result);
      }
    } catch (err) {
      console.log("Backend failed:", err.message);
      setError(err.message || "Failed to fetch content");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-grid">
        <section className="panel panel-input">
          <div className="panel-header">
            <div className="brand-mark">
              <span className="brand-dot" /> Reel Saver
            </div>
            <div className="status-chip">
              <span className="status-light online" /> Secure Download
            </div>
          </div>

          <div className="hero">
            <p className="eyebrow">Instagram Downloader</p>
            <h1>
              Reel & Post Saver
              <span className="dot" />
            </h1>
            <p className="lede">
              Paste an Instagram link to download reels, videos, or photos
              instantly.
            </p>
            <div className="chips">
              <span>Fast</span>
              <span>HD quality</span>
              <span>No watermark</span>
            </div>
          </div>

          <label className="field-label" htmlFor="reel-url">
            Post/Reel URL
          </label>
          <div className="field-row">
            <input
              id="reel-url"
              type="text"
              placeholder="Paste Instagram link..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="text-input"
            />
            <button
              onClick={async () => {
                if (url) {
                  setUrl("");
                } else {
                  try {
                    const text = await navigator.clipboard.readText();
                    setUrl(text);
                  } catch (err) {
                    console.error("Failed to read clipboard", err);
                  }
                }
              }}
              className="ghost-btn"
              title={url ? "Clear" : "Paste"}
              type="button"
            >
              {url ? (
                <>
                  Clear <FaTimes />
                </>
              ) : (
                <>
                  Paste <FaPaste />
                </>
              )}
            </button>
          </div>

          <div className="action-row">
            <button
              onClick={handleDownload}
              disabled={loading || !url}
              className="primary-btn"
            >
              {loading ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Processing...
                </>
              ) : (
                <>
                  Process <FaBolt />
                </>
              )}
            </button>
            <p className="hint">
              Direct, disposable requests. Nothing is logged.
            </p>
          </div>

          {error && <div className="alert alert-error">{error}</div>}
        </section>

        <section className="panel panel-output">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Preview</p>
              <p className="mini-title">Ready to download</p>
            </div>
            <div className="status-chip soft">
              <span className="status-light safe" /> Safe link
            </div>
          </div>

          {data && data.media_details ? (
            <div className="output-body">
              <div className="carousel-container">
                {data.media_details.length > 1 && (
                  <button
                    className="carousel-btn prev"
                    onClick={() =>
                      setCurrentMediaIndex((prev) =>
                        prev === 0 ? data.media_details.length - 1 : prev - 1
                      )
                    }
                  >
                    <FaChevronLeft />
                  </button>
                )}

                <div className="media-item">
                  <div className="preview-frame">
                    {data.media_details[currentMediaIndex].type === "video" ? (
                      <video
                        src={data.media_details[currentMediaIndex].url}
                        controls
                        referrerPolicy="no-referrer"
                        className="preview-content"
                      />
                    ) : (
                      <img
                        src={`${
                          import.meta.env.VITE_BACKEND_URL ||
                          "http://localhost:5000"
                        }/api/proxy?url=${encodeURIComponent(
                          data.media_details[currentMediaIndex].url
                        )}`}
                        alt={`Download ${currentMediaIndex + 1}`}
                        className="preview-content"
                      />
                    )}
                  </div>
                  <div className="download-controls">
                    {data.media_details.length > 1 && (
                      <div className="carousel-dots">
                        {data.media_details.map((_, idx) => (
                          <span
                            key={idx}
                            className={`dot ${
                              idx === currentMediaIndex ? "active" : ""
                            }`}
                            onClick={() => setCurrentMediaIndex(idx)}
                          />
                        ))}
                      </div>
                    )}
                    <a
                      href={data.media_details[currentMediaIndex].url}
                      download
                      target="_blank"
                      rel="noreferrer"
                      className="primary-btn download-btn"
                    >
                      <FaDownload /> Download{" "}
                      {data.media_details[currentMediaIndex].type === "video"
                        ? "MP4"
                        : "Image"}
                    </a>
                  </div>
                </div>

                {data.media_details.length > 1 && (
                  <button
                    className="carousel-btn next"
                    onClick={() =>
                      setCurrentMediaIndex((prev) =>
                        prev === data.media_details.length - 1 ? 0 : prev + 1
                      )
                    }
                  >
                    <FaChevronRight />
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="placeholder">
              <div className="placeholder-icon">⇣</div>
              <h2>Feed me a link</h2>
              <p>
                Drop an Instagram link to render a preview and download
                instantly.
              </p>
            </div>
          )}
        </section>
      </div>

      <footer className="page-footer">
        Made with ❤️ by{" "}
        <a
          href="https://github.com/mandipkumarkanu"
          target="_blank"
          rel="noreferrer"
        >
          Mandy
        </a>
      </footer>
    </div>
  );
}

export default App;
