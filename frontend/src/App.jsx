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

// Cobalt API instances for fallback
const COBALT_INSTANCES = [
  "https://co.eepy.today/",
  "https://cobalt.api.timelessnesses.me/",
  "https://api.cobalt.tools/",
];

// Detect platform from URL
function detectPlatform(url) {
  if (/instagram\.com/.test(url)) return { platform: 'instagram', emoji: '📸', name: 'Instagram' };
  if (/tiktok\.com|vm\.tiktok/.test(url)) return { platform: 'tiktok', emoji: '🎵', name: 'TikTok' };
  if (/twitter\.com|x\.com/.test(url)) return { platform: 'twitter', emoji: '🐦', name: 'Twitter/X' };
  if (/facebook\.com|fb\.watch/.test(url)) return { platform: 'facebook', emoji: '👤', name: 'Facebook' };
  if (/pinterest\.com|pin\.it/.test(url)) return { platform: 'pinterest', emoji: '📌', name: 'Pinterest' };
  return null;
}

// Fetch via Cobalt API with multiple instance fallbacks
async function fetchViaCobalt(url) {
  let lastError;

  for (const instance of COBALT_INSTANCES) {
    try {
      console.log(`[Cobalt] Trying: ${instance}`);
      const response = await fetch(instance, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          url: url,
          downloadMode: "auto",
          videoQuality: "1080",
        }),
      });

      const data = await response.json();

      if (data.status === "error") {
        lastError = new Error(data.text || "Cobalt failed");
        continue;
      }

      if (data.status === "redirect" || data.status === "tunnel" || data.status === "stream") {
        return {
          url_list: [data.url],
          media_details: [{ type: "video", url: data.url }],
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
          })),
        };
      }
    } catch (err) {
      console.log(`[Cobalt] ${instance} failed:`, err.message);
      lastError = err;
    }
  }

  throw lastError || new Error("All Cobalt instances failed");
}

// Fetch via backend (for Instagram with special features)
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
    
    const platform = detectPlatform(url);
    if (!platform) {
      setError("Unsupported link. Try Instagram, TikTok, YouTube, Twitter, Facebook, or Pinterest.");
      return;
    }

    setLoading(true);
    setError("");
    setData(null);
    setCurrentMediaIndex(0);

    // For Instagram: try Cobalt first, then backend
    // For other platforms: use Cobalt only
    const methods = platform.platform === 'instagram'
      ? [
          { name: "Cobalt", fn: () => fetchViaCobalt(url) },
          { name: "Backend", fn: () => fetchViaBackend(url) },
        ]
      : [
          { name: "Cobalt", fn: () => fetchViaCobalt(url) },
        ];

    let lastError;
    for (const method of methods) {
      try {
        console.log(`Trying ${method.name}...`);
        const result = await method.fn();
        if (result && result.url_list && result.url_list.length > 0) {
          console.log(`${method.name} succeeded!`);
          setData(result);
          setLoading(false);
          return;
        }
      } catch (err) {
        console.log(`${method.name} failed:`, err.message);
        lastError = err;
      }
    }

    setError(lastError?.message || "Failed to fetch content");
    setLoading(false);
  };

  return (
    <div className="page-shell">
      <div className="page-grid">
        <section className="panel panel-input">
          <div className="panel-header">
            <div className="brand-mark">
              <span className="brand-dot" /> Media Saver
            </div>
            <div className="status-chip">
              <span className="status-light online" /> Secure Download
            </div>
          </div>

          <div className="hero">
            <p className="eyebrow">Multi-Platform Downloader</p>
            <h1>
              Media Saver
              <span className="dot" />
            </h1>
            <p className="lede">
              Download from Instagram, TikTok, Twitter, Facebook & Pinterest.
            </p>
            <div className="chips">
              <span>📸 Instagram</span>
              <span>🎵 TikTok</span>
              <span>🐦 Twitter</span>
              <span>👤 Facebook</span>
              <span>📌 Pinterest</span>
            </div>
          </div>

          <label className="field-label" htmlFor="reel-url">
            Video/Post URL
          </label>
          <div className="field-row">
            <input
              id="reel-url"
              type="text"
              placeholder="Paste any supported link..."
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
                Paste a link from Instagram, TikTok, YouTube, Twitter, Facebook or Pinterest.
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
