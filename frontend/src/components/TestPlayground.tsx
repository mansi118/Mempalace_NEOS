import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@convex/_generated/api";

interface Result {
  closetId: string;
  score: number;
  title?: string;
  content: string;
  wingName: string;
  roomName: string;
  category: string;
  confidence: number;
}

interface SearchResponse {
  results: Result[];
  confidence: "high" | "medium" | "low";
  reason: string;
  tokenEstimate: number;
  queryTimeMs: number;
}

const PRESET_QUERIES = [
  { label: "Easy entity", query: "Zoo Media client details" },
  { label: "Easy product", query: "OpenClaw runtime" },
  { label: "Medium fact", query: "Convex vs Supabase" },
  { label: "Medium legal", query: "NDA MSA SOW legal templates" },
  { label: "Hard reasoning", query: "How does NeuralEDGE make money?" },
  { label: "Hard flow", query: "Explain the deal flow from lead to contract" },
  { label: "Off-domain", query: "Recipe for butter chicken" },
];

export default function TestPlayground({ palaceId, onBack }: { palaceId: string; onBack?: () => void }) {
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const search = useAction(api.serving.search.searchPalace);

  async function runSearch(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setQuery(q);
    try {
      const r = await search({ palaceId: palaceId as any, query: q, limit: 5 });
      setResponse(r as SearchResponse);
    } catch (e: any) {
      setResponse({
        results: [],
        confidence: "low",
        reason: `error: ${e.message?.slice(0, 200) ?? "unknown"}`,
        tokenEstimate: 0,
        queryTimeMs: 0,
      });
    } finally {
      setLoading(false);
    }
  }

  const confColor =
    response?.confidence === "high"
      ? "#10b981"
      : response?.confidence === "medium"
        ? "#f59e0b"
        : "#ef4444";

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 20px 48px", color: "#e5e7eb" }}>
      {onBack && (
        <button
          onClick={onBack}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "#B0B0B0",
            fontSize: 13,
            fontWeight: 500,
            background: "#111",
            border: "1px solid #222",
            borderRadius: 8,
            padding: "8px 14px",
            cursor: "pointer",
            marginBottom: 20,
            transition: "background 0.15s, color 0.15s, border-color 0.15s",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.background = "#1C1C1C";
            e.currentTarget.style.color = "#fff";
            e.currentTarget.style.borderColor = "#333";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.background = "#111";
            e.currentTarget.style.color = "#B0B0B0";
            e.currentTarget.style.borderColor = "#222";
          }}
        >
          <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
          Back
        </button>
      )}
      <h1 style={{ fontSize: "clamp(22px, 3vw, 28px)", fontWeight: 700, marginBottom: 8 }}>
        PALACE Search Playground
      </h1>
      <p style={{ color: "#9ca3af", marginBottom: 24, fontSize: 14, lineHeight: 1.55 }}>
        Probe retrieval live. Type a query or click a preset. Scoring combines vector + graph-boost +
        confidence + recency, then MMR-lite diversifies top-5.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch(query)}
          placeholder="What's the Zoo Media retainer?"
          style={{
            flex: 1,
            padding: "12px 16px",
            background: "#1f2937",
            border: "1px solid #374151",
            borderRadius: 8,
            color: "#e5e7eb",
            fontSize: 16,
          }}
        />
        <button
          onClick={() => runSearch(query)}
          disabled={loading || !query.trim()}
          style={{
            padding: "12px 24px",
            background: loading ? "#6b7280" : "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 8,
            fontSize: 16,
            fontWeight: 600,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "Searching…" : "Search"}
        </button>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 6 }}>Preset queries:</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {PRESET_QUERIES.map((p) => (
            <button
              key={p.query}
              onClick={() => runSearch(p.query)}
              style={{
                padding: "6px 12px",
                background: "#1f2937",
                border: "1px solid #374151",
                borderRadius: 6,
                color: "#d1d5db",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {response && (
        <>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "12px 16px",
              background: "#111827",
              borderRadius: 8,
              marginBottom: 16,
              fontSize: 14,
            }}
          >
            <div>
              Confidence: <strong style={{ color: confColor }}>{response.confidence.toUpperCase()}</strong>
              <span style={{ color: "#6b7280", marginLeft: 16 }}>{response.reason}</span>
            </div>
            <div style={{ color: "#9ca3af" }}>
              {response.results.length} results · {response.queryTimeMs}ms · ~{response.tokenEstimate} tokens
            </div>
          </div>

          {response.results.length === 0 && (
            <div style={{ padding: 32, textAlign: "center", color: "#9ca3af", background: "#111827", borderRadius: 8 }}>
              No results above the similarity floor. This is usually correct — the system refuses to
              hallucinate when no memory matches.
            </div>
          )}

          {response.results.map((r, i) => (
            <div
              key={r.closetId}
              style={{
                padding: 16,
                background: "#111827",
                border: "1px solid #1f2937",
                borderRadius: 8,
                marginBottom: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <div>
                  <span style={{ fontSize: 12, color: "#6b7280", marginRight: 8 }}>#{i + 1}</span>
                  <span style={{ fontWeight: 600 }}>{r.title ?? "(untitled)"}</span>
                </div>
                <div style={{ fontSize: 13, fontFamily: "monospace", color: "#10b981" }}>
                  {r.score.toFixed(3)}
                </div>
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af", marginBottom: 8 }}>
                {r.wingName}/{r.roomName} · {r.category} · extraction conf {r.confidence.toFixed(2)}
              </div>
              <div style={{ fontSize: 13, color: "#d1d5db", whiteSpace: "pre-wrap" }}>
                {r.content.slice(0, 300)}
                {r.content.length > 300 && "…"}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
