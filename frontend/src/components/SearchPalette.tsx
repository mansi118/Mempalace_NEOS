import { useState, useEffect, useRef } from "react";

interface Props { palaceId: string; onClose: () => void; }

export default function SearchPalette({ palaceId, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confidence, setConfidence] = useState("");
  const [error, setError] = useState("");
  const [timeMs, setTimeMs] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const search = async () => {
    if (!query.trim()) return;
    setLoading(true); setError("");
    try {
      const siteUrl = import.meta.env.VITE_CONVEX_SITE_URL ?? "https://small-dogfish-433.convex.site";
      const resp = await fetch(`${siteUrl}/mcp`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "palace_search", params: { query, palaceId, limit: 8 }, neopId: "_admin", palaceId }),
      });
      const data = await resp.json();
      if (data.error) { setError(data.error.slice(0, 150)); setResults([]); }
      else if (data.data?.results) {
        setResults(data.data.results); setConfidence(data.data.confidence ?? "");
        setTimeMs(data.data.queryTimeMs ?? 0);
      } else { setResults([]); setConfidence("low"); }
    } catch (e: any) { setError(e.message || "Search failed"); setResults([]); }
    finally { setLoading(false); }
  };

  const confColor = confidence === "high" ? "#10B981" : confidence === "medium" ? "#F59E0B" : "#FF4136";

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "12vh" }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.75)", backdropFilter: "blur(4px)" }} onClick={onClose}/>

      <div className="anim-in" style={{
        position: "relative", width: "100%", maxWidth: 640,
        background: "#1C1C1C", borderRadius: 14, border: "1px solid #333",
        boxShadow: "0 20px 60px rgba(0,0,0,0.8)", overflow: "hidden", margin: "0 16px",
      }}>
        {/* Input */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 20px", borderBottom: "1px solid #222" }}>
          <svg width={16} height={16} fill="none" stroke="#666" strokeWidth={2} viewBox="0 0 24 24">
            <circle cx={11} cy={11} r={8}/><path d="M21 21l-4.35-4.35"/>
          </svg>
          <input ref={ref} value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && search()}
            placeholder="Search palace memories..."
            style={{ flex: 1, background: "transparent", border: "none", color: "#fff", fontSize: 14, outline: "none" }}
          />
          {loading && <div style={{ width: 14, height: 14, border: "2px solid #00D4AA", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }}/>}
          <kbd style={{ padding: "2px 8px", borderRadius: 4, background: "#111", border: "1px solid #333", fontSize: 10, fontFamily: "monospace", color: "#666" }}>ESC</kbd>
        </div>

        {/* Results */}
        <div style={{ maxHeight: "50vh", overflowY: "auto" }}>
          {error && (
            <div style={{ padding: "16px 20px", textAlign: "center" }}>
              <span style={{ color: "#FF4136", fontSize: 13, padding: "4px 12px", borderRadius: 6, background: "rgba(255,65,54,0.1)", border: "1px solid rgba(255,65,54,0.2)" }}>{error}</span>
            </div>
          )}

          {results === null && !loading && !error && (
            <div style={{ padding: "32px 20px", textAlign: "center", color: "#555", fontSize: 13 }}>Type a query and press Enter</div>
          )}

          {results && results.length === 0 && !error && (
            <div style={{ padding: "32px 20px", textAlign: "center" }}>
              <p style={{ color: "#888", fontSize: 13 }}>No memories found</p>
              <p style={{ color: "#555", fontSize: 12, marginTop: 4 }}>Try a different query</p>
            </div>
          )}

          {results && results.length > 0 && (
            <>
              <div style={{ padding: "10px 20px 4px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ color: "#555", fontSize: 11 }}>{results.length} results in {timeMs}ms</span>
                <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 99, background: `${confColor}20`, color: confColor }}>{confidence}</span>
              </div>
              {results.map((r: any, i: number) => (
                <div key={r.closetId ?? i} style={{
                  padding: "12px 20px", borderBottom: "1px solid rgba(255,255,255,0.04)",
                  cursor: "pointer", transition: "background 0.15s",
                }} onMouseOver={e => (e.currentTarget.style.background = "#1A1A1A")}
                   onMouseOut={e => (e.currentTarget.style.background = "transparent")}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <span style={{ fontSize: 11, padding: "1px 6px", borderRadius: 4, background: "#111", color: "#888", textTransform: "capitalize" }}>{r.category}</span>
                    <span style={{ color: "#555", fontSize: 11 }}>{r.wingName}/{r.roomName}</span>
                    <span style={{ marginLeft: "auto", color: "#555", fontSize: 11, fontFamily: "monospace" }}>{(r.score * 100).toFixed(0)}%</span>
                  </div>
                  <p style={{ fontSize: 13, color: "#ddd", overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                    {r.title || r.content?.slice(0, 150)}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Bottom */}
        <div style={{ padding: "8px 20px", borderTop: "1px solid #222", display: "flex", justifyContent: "space-between", fontSize: 11, color: "#555" }}>
          <span>Palace Search</span>
          <span>Enter to search | Esc to close</span>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
