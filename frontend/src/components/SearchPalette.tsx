import { useState, useEffect, useRef } from "react";

interface Props {
  palaceId: string;
  onClose: () => void;
}

export default function SearchPalette({ palaceId, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [confidence, setConfidence] = useState<string>("");
  const [error, setError] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    try {
      const siteUrl =
        import.meta.env.VITE_CONVEX_SITE_URL ??
        "https://small-dogfish-433.convex.site";
      const resp = await fetch(`${siteUrl}/mcp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool: "palace_search",
          params: { query, palaceId, limit: 8 },
          neopId: "_admin",
          palaceId,
        }),
      });
      const data = await resp.json();
      if (data.error) {
        setError(data.error.slice(0, 150));
        setResults([]);
      } else if (data.data?.results) {
        setResults(data.data.results);
        setConfidence(data.data.confidence ?? "");
      } else {
        setResults([]);
        setConfidence("low");
      }
    } catch (e: any) {
      setError(e.message || "Search failed — check network connection");
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Palette */}
      <div className="relative w-full max-w-2xl bg-[#1C1C1C] rounded-[14px] border border-[#333] shadow-[0_20px_60px_rgba(0,0,0,0.8)] overflow-hidden animate-fade-in">
        {/* Search input */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <svg
            width="18"
            height="18"
            fill="none"
            stroke="#888"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search palace memories..."
            className="flex-1 bg-transparent text-white text-sm outline-none placeholder:text-text-tertiary"
          />
          {loading && (
            <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          )}
          <kbd className="px-2 py-0.5 rounded bg-bg-elevated text-[10px] font-mono text-text-tertiary border border-border">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {error && (
            <div className="px-5 py-6 text-center">
              <div className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-accent-red/10 border border-accent-red/20">
                <span className="text-accent-red text-sm">Error: {error}</span>
              </div>
            </div>
          )}

          {results === null && !loading && !error && (
            <div className="px-5 py-8 text-center text-text-tertiary text-sm">
              Type a query and press Enter to search
            </div>
          )}

          {results && results.length === 0 && (
            <div className="px-5 py-8 text-center">
              <p className="text-text-secondary text-sm">No memories found</p>
              <p className="text-text-tertiary text-xs mt-1">
                Try a different query or ingest more data
              </p>
            </div>
          )}

          {results && results.length > 0 && (
            <>
              <div className="px-5 pt-3 pb-1 flex items-center justify-between">
                <span className="text-text-tertiary text-xs">
                  {results.length} results
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    confidence === "high"
                      ? "bg-accent-green/20 text-accent-green"
                      : confidence === "medium"
                        ? "bg-accent-amber/20 text-accent-amber"
                        : "bg-accent-red/20 text-accent-red"
                  }`}
                >
                  {confidence} confidence
                </span>
              </div>
              {results.map((r: any, i: number) => (
                <div
                  key={r.closetId ?? i}
                  className="px-5 py-3 hover:bg-bg-hover border-b border-border/50 last:border-0 cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs px-1.5 py-0.5 rounded bg-bg-elevated text-text-secondary capitalize">
                      {r.category}
                    </span>
                    <span className="text-text-tertiary text-xs">
                      {r.wingName}/{r.roomName}
                    </span>
                    <span className="ml-auto text-text-tertiary text-xs font-mono">
                      {(r.score * 100).toFixed(0)}%
                    </span>
                  </div>
                  <p className="text-sm text-text-primary line-clamp-2">
                    {r.title ?? r.content?.slice(0, 150)}
                  </p>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Bottom bar */}
        <div className="px-5 py-2.5 border-t border-border flex items-center justify-between text-[11px] text-text-tertiary">
          <span>Palace Search</span>
          <div className="flex items-center gap-3">
            <span>Enter to search</span>
            <span>Esc to close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
