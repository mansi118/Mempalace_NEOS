import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

const WING_COLORS: Record<string, string> = {
  platform: "#4A9EFF", clients: "#10B981", team: "#A855F7",
  gtm: "#F59E0B", legal: "#9CA3AF", rd: "#22D3EE",
  marketplace: "#EC4899", infra: "#F97316", partners: "#14B8A6",
  brand: "#6366F1", audit: "#6B7280", _quarantine: "#FF4136",
};

interface Props {
  wings: any[];
  palaceId: string;
  onRoomClick: (roomId: string) => void;
}

export default function WingsGrid({ wings, palaceId, onRoomClick }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <section id="wings-grid" style={{ marginBottom: 64, scrollMarginTop: 80 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Wings</h2>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 20 }}>{wings.length} wings organizing your institutional memory</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(340px, 100%), 1fr))", gap: 12 }}>
        {wings.map((wing, i) => (
          <WingCard key={wing._id} wing={wing} index={i}
            expanded={expanded === wing._id}
            onToggle={() => setExpanded(expanded === wing._id ? null : wing._id)}
            onRoomClick={onRoomClick} />
        ))}
      </div>
    </section>
  );
}

function WingCard({ wing, index, expanded, onToggle, onRoomClick }: any) {
  const rooms = useQuery(api.palace.queries.listRoomsByWing, expanded ? { wingId: wing._id } : "skip");
  const color = WING_COLORS[wing.name] ?? "#6B7280";

  return (
    <div className="anim-in glow" style={{
      background: "#111", borderRadius: 16, border: "1px solid #222",
      overflow: "hidden", animationDelay: `${0.04 * index}s`,
      transition: "border-color 0.2s",
    }}>
      <button onClick={onToggle} style={{
        width: "100%", padding: 20, display: "flex", alignItems: "flex-start", gap: 14,
        textAlign: "left", cursor: "pointer", background: "transparent", border: "none", color: "#fff",
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: color, opacity: 0.9,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 700, color: "#000",
        }}>{wing.name[0]?.toUpperCase()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 14, fontWeight: 600 }}>{wing.name}</span>
            <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="#666" strokeWidth={2}
              style={{ transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </div>
          <p style={{ color: "#666", fontSize: 12, marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {wing.description}
          </p>
          <span style={{ fontSize: 11, color: "#555", marginTop: 6, display: "inline-block" }}>{wing.roomCount} rooms</span>
        </div>
      </button>

      {expanded && rooms && (
        <div style={{ borderTop: "1px solid #222", padding: "8px 20px 16px" }}>
          {rooms.map((room: any) => (
            <button key={room._id} onClick={() => onRoomClick(room._id)} style={{
              width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
              padding: "8px 10px", borderRadius: 8, textAlign: "left",
              background: "transparent", border: "none", color: "#fff", cursor: "pointer",
              fontSize: 13, transition: "background 0.15s",
            }}
              onMouseOver={e => (e.currentTarget.style.background = "#1C1C1C")}
              onMouseOut={e => (e.currentTarget.style.background = "transparent")}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500 }}>{room.name}</div>
                <div style={{ color: "#555", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{room.summary}</div>
              </div>
              <span style={{ color: "#555", fontSize: 11, flexShrink: 0, marginLeft: 8, fontFamily: "monospace" }}>{room.closetCount}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
