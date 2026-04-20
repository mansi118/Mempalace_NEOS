import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

interface Props { palaceId: string; wings: any[]; }

const REL_COLOR: Record<string, string> = {
  depends_on: "#4A9EFF", extends: "#10B981", references: "#888",
  caused_by: "#A855F7", clarifies: "#22D3EE", contradicts: "#FF4136",
};

export default function TunnelMap({ palaceId, wings }: Props) {
  const stats = useQuery(api.palace.queries.getStats, { palaceId: palaceId as any });
  if (!stats || stats.tunnels === 0) return null;

  const tunnels = [
    { from: "clients/zoo-media", to: "platform/neop-catalog", rel: "depends_on", str: 0.9 },
    { from: "rd/memory-systems", to: "platform/architecture", rel: "extends", str: 0.9 },
    { from: "platform/neop-catalog", to: "marketplace/neps", rel: "extends", str: 0.8 },
    { from: "rd/tools", to: "platform/architecture", rel: "depends_on", str: 0.8 },
    { from: "legal/contracts", to: "clients/zoo-media", rel: "references", str: 0.8 },
    { from: "gtm/icp", to: "gtm/outreach", rel: "depends_on", str: 0.8 },
    { from: "clients/zoo-media", to: "marketplace/neps", rel: "references", str: 0.7 },
    { from: "gtm/positioning", to: "clients/_shared", rel: "references", str: 0.7 },
    { from: "legal/entities", to: "team/org", rel: "depends_on", str: 0.7 },
    { from: "platform/architecture", to: "platform/neop-catalog", rel: "depends_on", str: 0.9 },
    { from: "platform/features", to: "platform/architecture", rel: "depends_on", str: 0.7 },
    { from: "clients/_shared", to: "gtm/pipeline", rel: "references", str: 0.6 },
    { from: "gtm/outreach", to: "clients/_shared", rel: "caused_by", str: 0.6 },
    { from: "team/org", to: "platform/neop-catalog", rel: "references", str: 0.6 },
  ];

  return (
    <section className="anim-in" style={{ marginBottom: 48, animationDelay: "0.7s" }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Knowledge Graph</h2>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 20 }}>{stats.tunnels} cross-wing connections</p>

      <div style={{ background: "#111", borderRadius: 16, border: "1px solid #222", padding: 24 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {tunnels.map((t, i) => {
            const color = REL_COLOR[t.rel] ?? "#666";
            return (
              <div key={i} style={{
                display: "flex", alignItems: "center", gap: 8, fontSize: 13,
                padding: "6px 0",
              }}>
                <span style={{ color: "#B0B0B0", minWidth: 160, textAlign: "right", fontFamily: "monospace", fontSize: 12 }}>{t.from}</span>
                <span style={{
                  color, fontWeight: 500, fontSize: 11,
                  padding: "2px 8px", borderRadius: 4,
                  background: `${color}15`, minWidth: 90, textAlign: "center",
                }}>{t.rel}</span>
                <span style={{ color: "#fff", fontFamily: "monospace", fontSize: 12 }}>{t.to}</span>
                <span style={{ color: "#444", fontSize: 11, marginLeft: "auto" }}>{(t.str * 100).toFixed(0)}%</span>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div style={{ display: "flex", gap: 16, marginTop: 16, paddingTop: 12, borderTop: "1px solid #222", flexWrap: "wrap" }}>
          {Object.entries(REL_COLOR).map(([rel, color]) => (
            <span key={rel} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "#555" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }}/>
              {rel}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
