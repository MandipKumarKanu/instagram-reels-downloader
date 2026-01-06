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
    // Simple frontend validation
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
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
        <div className="neo-box p-8 relative h-full min-h-[500px] flex flex-col">
          <div className="absolute -top-4 -left-4 neo-tag -rotate-6 z-10">
            INSTA-SAVER v2.0
          </div>

          <div className="mb-8 border-b-4 border-black pb-4">
            <h1 className="text-6xl font-black uppercase tracking-tighter leading-none break-words">
              Reel
              <br />
              Downloader
            </h1>
            <p className="font-bold mt-4 bg-black text-white inline-block px-2 text-xl">
              NO BLURS. NO BS.
            </p>
          </div>

          <div className="mt-auto space-y-6">
            <div className="space-y-2">
              <label className="font-black text-xl block uppercase">
                Target URL:
              </label>
              <input
                type="text"
                placeholder="PASTE INSTAGRAM LINK"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className="neo-input w-full p-4 text-xl"
              />
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setUrl("")}
                className="neo-btn w-16 flex items-center justify-center bg-white hover:bg-gray-200"
                title="Clear"
              >
                X
              </button>
              <button
                onClick={handleDownload}
                disabled={loading || !url}
                className="neo-btn flex-1 py-4 text-2xl flex items-center justify-center gap-3"
              >
                {loading ? (
                  "PROCESSING..."
                ) : (
                  <>
                    PROCESS <FaBolt />
                  </>
                )}
              </button>
            </div>
          </div>
          {error && (
            <div className="mt-6 bg-red-500 border-4 border-black p-4 font-bold text-white shadow-[4px_4px_0px_0px_rgba(0,0,0,1)]">
              ⚠ {error}
            </div>
          )}
        </div>

        <div className="neo-box p-8 h-full min-h-[500px] flex flex-col relative bg-yellow-300">
          <div className="absolute -top-4 -right-4 neo-tag rotate-3 z-10 bg-white">
            OUTPUT ZONE
          </div>

          {data && data.url_list ? (
            <div className="flex-1 flex flex-col animate-slide-up">
              <p className="font-black mb-4 uppercase text-2xl border-b-4 border-black inline-block self-start">
                Ready for Extraction
              </p>

              <div className="bg-black border-4 border-black flex-1 w-full relative group min-h-[300px] mb-6 shadow-[6px_6px_0px_0px_rgba(255,255,255,1)]">
                <video
                  src={data.url_list[0]}
                  controls
                  className="w-full h-full object-contain absolute inset-0"
                />
              </div>

              <a
                href={data.url_list[0]}
                download
                target="_blank"
                rel="noreferrer"
                className="neo-btn block w-full py-5 text-center text-2xl bg-cyan-400 hover:bg-cyan-300"
              >
                <FaDownload className="inline mr-3" /> DOWNLOAD MP4
              </a>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40 border-4 border-dashed border-black m-4">
              <div className="text-8xl mb-4">⬇</div>
              <h2 className="text-3xl font-black uppercase">
                Waiting for Input
              </h2>
              <p className="font-bold mt-2">
                Paste a link on the left to activate extraction.
              </p>
            </div>
          )}
        </div>
      </div>

      <footer className="fixed bottom-4 right-4 font-bold bg-white border-4 border-black px-4 py-2 shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] z-50 text-xs md:text-sm">
        &copy; {new Date().getFullYear()}{" "}
        <a href="https://github.com/mandipkumarkanu">Mandy</a>
      </footer>
    </div>
  );
}

export default App;
