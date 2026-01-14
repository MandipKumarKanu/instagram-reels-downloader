import { useState } from "react";
import "./App.css";
import { FaDownload, FaBolt } from "react-icons/fa";

// Direct browser-based fetching using Cobalt API
async function fetchViaCobalt(url) {
  const response = await fetch("https://co.eepy.today/", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url: url,
      downloadMode: "auto",
    }),
  });

  const data = await response.json();
  if (data.status === "error") throw new Error(data.text || "Cobalt failed");
  if (
    data.status === "redirect" ||
    data.status === "tunnel" ||
    data.status === "stream"
  ) {
    return {
      url_list: [data.url],
      media_details: [{ type: "video", url: data.url }],
    };
  }
  if (data.status === "picker" && data.picker) {
    const urls = data.picker.map((p) => p.url);
    return {
      url_list: urls,
      media_details: urls.map((u) => ({ type: "video", url: u })),
    };
  }
  throw new Error("Unexpected response");
}

// Fallback using backend
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
  const [error, setError] = useState("");

  const handleDownload = async () => {
    if (!url) return;
    const isInstagram = url.includes("instagram.com");
    const isFacebook = url.includes("facebook.com") || url.includes("fb.watch");
    if (!isInstagram && !isFacebook) {
      setError("Invalid link. Instagram or Facebook only.");
      return;
    }

    setLoading(true);
    setError("");
    setData(null);

    // Try Cobalt first (direct from browser), then fallback to backend
    const methods = [
      // { name: "Cobalt", fn: () => fetchViaCobalt(url) },
      { name: "Backend", fn: () => fetchViaBackend(url) },
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

    setError(lastError?.message || "Failed to fetch video");
    setLoading(false);
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
            <p className="eyebrow">Instagram & Facebook reel saver</p>
            <h1>
              Reel Downloader
              <span className="dot" />
            </h1>
            <p className="lede">
              Paste an Instagram or Facebook reel link, process in seconds, and
              download without watermarks or ads.
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
              placeholder="Paste Instagram or Facebook reel link..."
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
