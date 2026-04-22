import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

interface Props { palaceId: string; onBack: () => void; }

export default function QueriesView({ palaceId, onBack }: Props) {
  const recent = useQuery(api.palace.queries.recentQueries, { palaceId: palaceId as any, limit: 50 });
  const stats = useQuery(api.palace.queries.queryLogStats, { palaceId: palaceId as any, limit: 500 });
  const latency = useQuery(api.serving.monitoring.searchLatencyStats, { palaceId: palaceId as any, lastHours: 24 });

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 20px 48px" }}>
      <button
        onClick={onBack}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          color: "#B0B0B0", fontSize: 13, fontWeight: 500,
          background: "#111", border: "1px solid #222", borderRadius: 8,
          padding: "8px 14px", cursor: "pointer", marginBottom: 20,
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "clamp(22px, 3vw, 28px)", fontWeight: 700, marginBottom: 6 }}>
          Query Analytics
        </h1>
        <p style={{ color: "#888", fontSize: 14 }}>
          What's being searched, how it's performing, and which queries return nothing.
        </p>
      </div>

      {/* Top cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
        <StatCard label="Queries (window)" value={stats?.total ?? "…"} color="#00D4AA" />
        <StatCard label="Avg latency" value={stats ? `${stats.avgLatency}ms` : "…"} color="#4A9EFF" />
        <StatCard label="p95 latency" value={stats ? `${stats.p95Latency}ms` : "…"} color="#A855F7" sub={latency ? `${latency.count} in 24h` : undefined} />
        <StatCard label="Zero-result" value={stats?.zeroResultCount ?? "…"} color="#F59E0B" sub={stats && stats.total > 0 ? `${((stats.zeroResultCount / stats.total) * 100).toFixed(0)}%` : undefined} />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16, marginBottom: 24 }}>
        {/* Confidence distribution */}
        <div style={{ background: "#111", border: "1px solid #222", borderRadius: 12, padding: 20 }}>
          <h3 style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>
            Confidence distribution
          </h3>
          {!stats ? <p style={{ color: "#666", fontSize: 13 }}>Loading…</p> : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {[
                { k: "high", c: "#10B981" },
                { k: "medium", c: "#F59E0B" },
                { k: "low", c: "#FF4136" },
              ].map((r) => {
                const count = (stats.byConfidence as any)[r.k] ?? 0;
                const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
                return (
                  <div key={r.k}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                      <span style={{ textTransform: "capitalize" }}>{r.k}</span>
                      <span style={{ color: "#888" }}>{count} · {pct.toFixed(0)}%</span>
                    </div>
                    <div style={{ height: 5, background: "#1C1C1C", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.max(pct, 1)}%`, background: r.c, borderRadius: 3 }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Top queries */}
        <div style={{ background: "#111", border: "1px solid #222", borderRadius: 12, padding: 20 }}>
          <h3 style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>
            Most frequent queries
          </h3>
          {!stats || stats.topQueries.length === 0 ? (
            <p style={{ color: "#666", fontSize: 13 }}>No repeated queries yet</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {stats.topQueries.map((q: any) => (
                <div
                  key={q.query}
                  style={{
                    display: "flex", justifyContent: "space-between",
                    fontSize: 13, padding: "6px 8px", borderRadius: 6, background: "#161616",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, marginRight: 8 }}>
                    {q.query}
                  </span>
                  <span style={{ color: "#666", fontSize: 12, fontFamily: "monospace" }}>×{q.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent queries log */}
      <div style={{ background: "#111", border: "1px solid #222", borderRadius: 12, padding: 20 }}>
        <h3 style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 14 }}>
          Recent searches ({recent?.length ?? 0})
        </h3>
        {!recent ? (
          <p style={{ color: "#666", fontSize: 13 }}>Loading…</p>
        ) : recent.length === 0 ? (
          <p style={{ color: "#666", fontSize: 13 }}>No searches yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {recent.map((q: any) => {
              const confColor =
                q.confidence === "high" ? "#10B981" : q.confidence === "medium" ? "#F59E0B" : "#FF4136";
              return (
                <div
                  key={q._id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 2fr) auto auto auto auto",
                    gap: 10,
                    alignItems: "center",
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: "#161616",
                    fontSize: 13,
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {q.query}
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
                    {q.confidence}
                  </span>
                  <span style={{ color: "#888", fontSize: 12, fontFamily: "monospace", textAlign: "right" }}>
                    {q.resultCount} hits
                  </span>
                  <span style={{ color: "#888", fontSize: 12, fontFamily: "monospace", textAlign: "right" }}>
                    {q.latencyMs}ms
                  </span>
                  <span style={{ color: "#555", fontSize: 11, textAlign: "right" }}>
                    {new Date(q.createdAt).toLocaleTimeString()}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color, sub }: { label: string; value: string | number; color: string; sub?: string }) {
  return (
    <div style={{ background: "#111", border: "1px solid #222", borderRadius: 12, padding: "14px 16px" }}>
      <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color, lineHeight: 1.2 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
