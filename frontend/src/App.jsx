import { useState } from "react";
import "./App.css";
import { FaDownload, FaBolt } from "react-icons/fa";

function App() {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const handleDownload = async () => {
    if (!url) return;
    if (!url.includes("instagram.com")) {
      setError("ERROR: INVALID LINK. INSTAGRAM ONLY.");
      return;
    }

    setLoading(true);
    setError("");
    setData(null);

    try {
      const backendUrl =
        import.meta.env.VITE_BACKEND_URL || "http://localhost:5000";
      const response = await fetch(
        `${backendUrl}/api/download?url=${encodeURIComponent(url)}`
      );
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "FETCH FAILED");
      }

      setData(result);
    } catch (err) {
      console.error(err);
      setError(err.message.toUpperCase() || "SYSTEM MALFUNCTION");
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
            <p className="eyebrow">Instagram reel saver</p>
            <h1>
              Reel Downloader
              <span className="dot" />
            </h1>
            <p className="lede">
              Paste a reel link, process in seconds, and download without
              watermarks or ads.
            </p>
            <div className="chips">
              <span>Fast</span>
              <span>HD quality</span>
              <span>No watermark</span>
            </div>
          </div>

          <label className="field-label" htmlFor="reel-url">
            Reel URL
          </label>
          <div className="field-row">
            <input
              id="reel-url"
              type="text"
              placeholder="https://www.instagram.com/reel/..."
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="text-input"
            />
            <button
              onClick={() => setUrl("")}
              className="ghost-btn"
              title="Clear"
              type="button"
            >
              Clear
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

          {data && data.url_list ? (
            <div className="output-body">
              <div className="preview-frame">
                <video
                  src={data.url_list[0]}
                  controls
                  className="preview-video"
                />
              </div>
              <a
                href={data.url_list[0]}
                download
                target="_blank"
                rel="noreferrer"
                className="primary-btn download-btn"
              >
                <FaDownload /> Download MP4
              </a>
            </div>
          ) : (
            <div className="placeholder">
              <div className="placeholder-icon">⇣</div>
              <h2>Feed me a reel URL</h2>
              <p>
                Drop any Instagram reel link to render a preview and download
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
