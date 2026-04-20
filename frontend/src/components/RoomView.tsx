import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

interface Props { palaceId: string; roomId: string; onBack: () => void; }

const CAT_BG: Record<string, string> = {
  fact: "rgba(74,158,255,0.15)", decision: "rgba(168,85,247,0.15)",
  conversation: "rgba(0,212,170,0.15)", task: "rgba(245,158,11,0.15)",
  lesson: "rgba(16,185,129,0.15)", preference: "rgba(236,72,153,0.15)",
  procedure: "rgba(34,211,238,0.15)", signal: "rgba(255,65,54,0.15)",
};
const CAT_FG: Record<string, string> = {
  fact: "#4A9EFF", decision: "#A855F7", conversation: "#00D4AA",
  task: "#F59E0B", lesson: "#10B981", preference: "#EC4899",
  procedure: "#22D3EE", signal: "#FF4136",
};

export default function RoomView({ palaceId, roomId, onBack }: Props) {
  const data = useQuery(api.serving.rooms.getRoomDeep, { palaceId: palaceId as any, roomId: roomId as any });

  if (!data) return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "48px 24px", color: "#888" }}>Loading room...</div>
  );

  const { room, closets, tunnels, pagination } = data;

  return (
    <div className="anim-in" style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px" }}>
      {/* Back */}
      <button onClick={onBack} style={{
        display: "flex", alignItems: "center", gap: 6, color: "#888",
        fontSize: 13, background: "transparent", border: "none", cursor: "pointer", marginBottom: 24,
      }}>
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        Back to palace
      </button>

      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 32 }}>
        <div>
          <div style={{ color: "#555", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{room.wing}</div>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>{room.name}</h1>
          <p style={{ color: "#888", marginTop: 6, maxWidth: 500 }}>{room.summary}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>{room.closetCount}</div>
          <div style={{ fontSize: 11, color: "#555" }}>memories</div>
        </div>
      </div>

      {/* Tunnels */}
      {tunnels.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 10 }}>Connections</h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {tunnels.map((t: any, i: number) => (
              <span key={i} style={{ padding: "4px 12px", borderRadius: 99, background: "#111", border: "1px solid #222", fontSize: 12 }}>
                <span style={{ color: "#555" }}>{t.direction}</span>{" "}
                <span style={{ fontWeight: 500 }}>{t.targetWing}/{t.targetRoom}</span>{" "}
                <span style={{ color: "#555" }}>({t.relationship})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Closets */}
      <h3 style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
        Memories ({closets.length}{pagination.hasMore ? "+" : ""})
      </h3>

      {closets.length === 0 ? (
        <div style={{ background: "#111", borderRadius: 16, border: "1px solid #222", padding: 40, textAlign: "center" }}>
          <p style={{ color: "#888" }}>No memories in this room yet</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {closets.map((c: any, i: number) => (
            <div key={c.id} className="anim-in" style={{
              background: "#111", borderRadius: 12, border: "1px solid #222", padding: 20,
              animationDelay: `${0.03 * i}s`, transition: "border-color 0.2s",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{
                  fontSize: 11, padding: "2px 8px", borderRadius: 99,
                  background: CAT_BG[c.category] ?? "#1C1C1C",
                  color: CAT_FG[c.category] ?? "#888",
                }}>{c.category}</span>
                <span style={{ color: "#555", fontSize: 11 }}>{new Date(c.createdAt).toLocaleDateString()}</span>
                <span style={{ marginLeft: "auto", color: "#555", fontSize: 11, fontFamily: "monospace" }}>{(c.confidence * 100).toFixed(0)}%</span>
              </div>
              {c.title && <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>{c.title}</h4>}
              <p style={{ color: "#B0B0B0", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {c.content.length > 500 ? c.content.slice(0, 500) + "..." : c.content}
              </p>
              {c.drawers.length > 0 && (
                <div style={{ marginTop: 10, paddingLeft: 12, borderLeft: "2px solid #222" }}>
                  {c.drawers.map((d: any, j: number) => (
                    <div key={j} style={{ fontSize: 12, color: "#888", paddingTop: 3, paddingBottom: 3, display: "flex", gap: 6 }}>
                      <span style={{ color: "#00D4AA", flexShrink: 0 }}>-</span>
                      <span>{d.fact}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
