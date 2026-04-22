import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

interface Props {
  palaceId: string;
  wings: any[];
  onRoomClick?: (roomId: string) => void;
}

const REL_COLOR: Record<string, string> = {
  depends_on: "#4A9EFF",
  extends: "#10B981",
  references: "#888",
  caused_by: "#A855F7",
  clarifies: "#22D3EE",
  contradicts: "#FF4136",
};

export default function TunnelMap({ palaceId, onRoomClick }: Props) {
  const tunnels = useQuery(api.palace.queries.listAllTunnels, { palaceId: palaceId as any });

  if (!tunnels || tunnels.length === 0) return null;

  return (
    <section className="anim-in" style={{ marginBottom: 48, animationDelay: "0.7s" }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Knowledge Graph</h2>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 20 }}>
        {tunnels.length} cross-wing connection{tunnels.length === 1 ? "" : "s"}
      </p>

      <div
        style={{
          background: "#111",
          borderRadius: 16,
          border: "1px solid #222",
          padding: 24,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {tunnels.map((t: any) => {
            const color = REL_COLOR[t.relationship] ?? "#666";
            const fromLabel = `${t.from.wingName}/${t.from.roomName}`;
            const toLabel = `${t.to.wingName}/${t.to.roomName}`;
            return (
              <div
                key={t._id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr) auto",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 0",
                  fontSize: 13,
                }}
              >
                <button
                  onClick={() => onRoomClick?.(t.from.roomId)}
                  title={`Go to ${fromLabel}`}
                  style={{
                    color: "#B0B0B0",
                    textAlign: "right",
                    fontFamily: "monospace",
                    fontSize: 12,
                    background: "transparent",
                    border: "none",
                    cursor: onRoomClick ? "pointer" : "default",
                    padding: "2px 4px",
                    borderRadius: 4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                  onMouseOver={(e) => {
                    if (onRoomClick) e.currentTarget.style.color = "#fff";
                  }}
                  onMouseOut={(e) => (e.currentTarget.style.color = "#B0B0B0")}
                >
                  {fromLabel}
                </button>

                <span
                  style={{
                    color,
                    fontWeight: 500,
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: `${color}15`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {t.relationship}
                </span>

                <button
                  onClick={() => onRoomClick?.(t.to.roomId)}
                  title={`Go to ${toLabel}`}
                  style={{
                    color: "#fff",
                    textAlign: "left",
                    fontFamily: "monospace",
                    fontSize: 12,
                    background: "transparent",
                    border: "none",
                    cursor: onRoomClick ? "pointer" : "default",
                    padding: "2px 4px",
                    borderRadius: 4,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                  onMouseOver={(e) => {
                    if (onRoomClick) e.currentTarget.style.color = "#00D4AA";
                  }}
                  onMouseOut={(e) => (e.currentTarget.style.color = "#fff")}
                >
                  {toLabel}
                </button>

                <span style={{ color: "#444", fontSize: 11 }}>{(t.strength * 100).toFixed(0)}%</span>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div
          style={{
            display: "flex",
            gap: 16,
            marginTop: 16,
            paddingTop: 12,
            borderTop: "1px solid #222",
            flexWrap: "wrap",
          }}
        >
          {Object.entries(REL_COLOR).map(([rel, color]) => (
            <span
              key={rel}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                fontSize: 11,
                color: "#555",
              }}
            >
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} />
              {rel}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
