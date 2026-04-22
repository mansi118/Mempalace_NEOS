import { useState, useEffect, useRef } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";

interface Props {
  palaceId: string;
  onClose: () => void;
  onResultClick?: (roomId: string) => void;
}

export default function SearchPalette({ palaceId, onClose, onResultClick }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confidence, setConfidence] = useState("");
  const [error, setError] = useState("");
  const [timeMs, setTimeMs] = useState(0);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const search = useAction(api.serving.search.searchPalace);

  useEffect(() => {
    ref.current?.focus();
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown" && results) {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, results.length - 1));
      }
      if (e.key === "ArrowUp" && results) {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      }
      if (e.key === "Enter" && results && results[selectedIdx] && document.activeElement !== ref.current) {
        const r = results[selectedIdx];
        if (r.roomId && onResultClick) {
          onResultClick(r.roomId);
        }
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose, results, selectedIdx, onResultClick]);

  const runSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    setSelectedIdx(0);
    try {
      const r = await search({ palaceId: palaceId as any, query, limit: 8 });
      setResults(r.results);
      setConfidence(r.confidence);
      setTimeMs(r.queryTimeMs);
    } catch (e: any) {
      setError(e.message?.slice(0, 200) || "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  const confColor =
    confidence === "high" ? "#10B981" : confidence === "medium" ? "#F59E0B" : "#FF4136";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "10vh",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0,0,0,0.75)",
          backdropFilter: "blur(6px)",
          WebkitBackdropFilter: "blur(6px)",
        }}
        onClick={onClose}
      />

      <div
        className="anim-in"
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 680,
          background: "#1C1C1C",
          borderRadius: 14,
          border: "1px solid #333",
          boxShadow: "0 20px 60px rgba(0,0,0,0.8)",
          overflow: "hidden",
          margin: "0 16px",
          maxHeight: "calc(100vh - 20vh)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Input */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "14px 20px",
            borderBottom: "1px solid #222",
            flexShrink: 0,
          }}
        >
          <svg
            width={16}
            height={16}
            fill="none"
            stroke="#666"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <circle cx={11} cy={11} r={8} />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={ref}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch()}
            placeholder="Search palace memories…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              color: "#fff",
              fontSize: 14,
              outline: "none",
              minWidth: 0,
            }}
          />
          {loading && (
            <div
              style={{
                width: 14,
                height: 14,
                border: "2px solid #00D4AA",
                borderTopColor: "transparent",
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
              }}
            />
          )}
          <kbd
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              background: "#111",
              border: "1px solid #333",
              fontSize: 10,
              fontFamily: "monospace",
              color: "#666",
            }}
          >
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {error && (
            <div style={{ padding: "16px 20px", textAlign: "center" }}>
              <span
                style={{
                  color: "#FF4136",
                  fontSize: 13,
                  padding: "4px 12px",
                  borderRadius: 6,
                  background: "rgba(255,65,54,0.1)",
                  border: "1px solid rgba(255,65,54,0.2)",
                }}
              >
                {error}
              </span>
            </div>
          )}

          {results === null && !loading && !error && (
            <div
              style={{
                padding: "32px 20px",
                textAlign: "center",
                color: "#555",
                fontSize: 13,
              }}
            >
              Type a query and press Enter. Try "Zoo Media retainer" or "OpenClaw runtime".
            </div>
          )}

          {results && results.length === 0 && !error && (
            <div style={{ padding: "32px 20px", textAlign: "center" }}>
              <p style={{ color: "#888", fontSize: 13 }}>No memories found</p>
              <p style={{ color: "#555", fontSize: 12, marginTop: 4 }}>
                The system correctly refuses to hallucinate when nothing matches.
              </p>
            </div>
          )}

          {results && results.length > 0 && (
            <>
              <div
                style={{
                  padding: "10px 20px 4px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                }}
              >
                <span style={{ color: "#555", fontSize: 11 }}>
                  {results.length} results in {timeMs}ms · ↑↓ to navigate
                </span>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 99,
                    background: `${confColor}20`,
                    color: confColor,
                  }}
                >
                  {confidence}
                </span>
              </div>
              {results.map((r: any, i: number) => {
                const selected = i === selectedIdx;
                return (
                  <button
                    key={r.closetId ?? i}
                    onClick={() => {
                      if (r.roomId && onResultClick) onResultClick(r.roomId);
                    }}
                    onMouseEnter={() => setSelectedIdx(i)}
                    style={{
                      display: "block",
                      width: "100%",
                      padding: "12px 20px",
                      borderBottom: "1px solid rgba(255,255,255,0.04)",
                      textAlign: "left",
                      background: selected ? "#1A1A1A" : "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "#fff",
                      transition: "background 0.1s",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        marginBottom: 4,
                      }}
                    >
                      <span
                        style={{
                          fontSize: 11,
                          padding: "1px 6px",
                          borderRadius: 4,
                          background: "#111",
                          color: "#888",
                          textTransform: "capitalize",
                        }}
                      >
                        {r.category}
                      </span>
                      <span style={{ color: "#555", fontSize: 11 }}>
                        {r.wingName}/{r.roomName}
                      </span>
                      <span
                        style={{
                          marginLeft: "auto",
                          color: "#555",
                          fontSize: 11,
                          fontFamily: "monospace",
                        }}
                      >
                        {(r.score * 100).toFixed(0)}%
                      </span>
                    </div>
                    <p
                      style={{
                        fontSize: 13,
                        color: "#ddd",
                        overflow: "hidden",
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                      }}
                    >
                      {r.title || r.content?.slice(0, 180)}
                    </p>
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* Bottom */}
        <div
          style={{
            padding: "8px 20px",
            borderTop: "1px solid #222",
            display: "flex",
            justifyContent: "space-between",
            fontSize: 11,
            color: "#555",
            flexShrink: 0,
          }}
        >
          <span>Palace Search</span>
          <span>↑↓ navigate · Enter to open · Esc to close</span>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
