import { useState, useEffect } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "@convex/_generated/api";

interface Props {
  palaceId: string;
  clientId: string;
  onBack: () => void;
  onRoomClick?: (roomId: string) => void;
}

interface Entity {
  "e.name": string;
  "e.type": string;
  "e.occurrences": number;
  closets: string;
}

interface Connected {
  "connected.name": string | null;
  "connected.type": string | null;
  "connected.occurrences": number | null;
}

const TYPE_COLOR: Record<string, string> = {
  company: "#10B981",
  product: "#4A9EFF",
  person: "#A855F7",
  technology: "#22D3EE",
  concept: "#888",
  location: "#F59E0B",
  event: "#EC4899",
  neop: "#00D4AA",
  sector: "#FF4136",
};

export default function EntitiesView({ palaceId, clientId, onBack }: Props) {
  const stats = useQuery(api.palace.queries.getStats, { palaceId: palaceId as any });
  const graphStatsAction = useAction(api.serving.graph.graphStats);
  const searchAction = useAction(api.serving.graph.graphSearch);
  const traverseAction = useAction(api.serving.graph.graphTraverse);

  const [graphStats, setGraphStats] = useState<any>(null);
  const [query, setQuery] = useState("");
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [neighbors, setNeighbors] = useState<Connected[]>([]);
  const [loading, setLoading] = useState(false);
  const [neighborsLoading, setNeighborsLoading] = useState(false);

  // Load stats + top entities on mount.
  useEffect(() => {
    (async () => {
      const s = await graphStatsAction({ palaceId: clientId });
      setGraphStats(s);
      // Seed with generic query to get a population sample.
      const results = (await searchAction({ palaceId: clientId, query: "a", limit: 30 })) as Entity[];
      setEntities(results);
    })();
  }, [clientId, graphStatsAction, searchAction]);

  async function runSearch(q: string) {
    if (!q.trim()) return;
    setLoading(true);
    setQuery(q);
    try {
      const results = (await searchAction({ palaceId: clientId, query: q, limit: 30 })) as Entity[];
      setEntities(results);
      setSelected(null);
      setNeighbors([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadNeighbors(e: Entity) {
    setSelected(e);
    setNeighborsLoading(true);
    try {
      const result = await traverseAction({
        palaceId: clientId,
        entityName: e["e.name"],
        maxDepth: 2,
      });
      setNeighbors((result?.connected ?? []).filter((n: Connected) => n["connected.name"] && n["connected.name"] !== e["e.name"]));
    } finally {
      setNeighborsLoading(false);
    }
  }

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 20px 48px" }}>
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
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: "clamp(22px, 3vw, 28px)", fontWeight: 700, marginBottom: 6 }}>
          Entity Graph
        </h1>
        <p style={{ color: "#888", fontSize: 14 }}>
          Explore extracted entities and their relationships across all memories.
        </p>
      </div>

      {/* Stats strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 12,
          marginBottom: 24,
        }}
      >
        {[
          { label: "Entities", value: graphStats?.entities ?? "—", color: "#10B981" },
          { label: "Relationships", value: graphStats?.relationships ?? "—", color: "#4A9EFF" },
          { label: "Closets in graph", value: graphStats?.closets ?? "—", color: "#A855F7" },
          { label: "Memories total", value: stats?.closets?.visible ?? "—", color: "#00D4AA" },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: "#111",
              border: "1px solid #222",
              borderRadius: 12,
              padding: "14px 16px",
            }}
          >
            <div style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              {s.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <input
          type="text"
          placeholder="Filter entities by substring (e.g. Zoo, NEop, convex)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && runSearch(query)}
          style={{
            flex: 1,
            padding: "10px 14px",
            background: "#111",
            border: "1px solid #333",
            borderRadius: 8,
            color: "#fff",
            fontSize: 14,
            outline: "none",
          }}
        />
        <button
          onClick={() => runSearch(query)}
          disabled={loading}
          style={{
            padding: "10px 20px",
            background: "#fff",
            color: "#000",
            border: "none",
            borderRadius: 8,
            fontWeight: 600,
            fontSize: 14,
            cursor: loading ? "wait" : "pointer",
          }}
        >
          {loading ? "…" : "Filter"}
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)", gap: 16 }}>
        {/* Entity list */}
        <div
          style={{
            background: "#111",
            border: "1px solid #222",
            borderRadius: 12,
            padding: 16,
            maxHeight: 600,
            overflowY: "auto",
          }}
        >
          <h3 style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
            {entities.length} entities {query ? `matching "${query}"` : "· top by occurrence"}
          </h3>
          {entities.length === 0 && !loading && (
            <p style={{ color: "#666", fontSize: 13, padding: 16 }}>No entities found</p>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {entities.map((e, i) => {
              const isSelected = selected?.["e.name"] === e["e.name"];
              const color = TYPE_COLOR[e["e.type"]] ?? "#666";
              return (
                <button
                  key={`${e["e.name"]}-${i}`}
                  onClick={() => loadNeighbors(e)}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 12px",
                    borderRadius: 8,
                    background: isSelected ? "#1C1C1C" : "transparent",
                    border: `1px solid ${isSelected ? "#333" : "transparent"}`,
                    color: "#fff",
                    textAlign: "left",
                    cursor: "pointer",
                    fontSize: 13,
                    transition: "background 0.1s",
                  }}
                  onMouseOver={(ev) => {
                    if (!isSelected) ev.currentTarget.style.background = "#171717";
                  }}
                  onMouseOut={(ev) => {
                    if (!isSelected) ev.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      minWidth: 0,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {e["e.name"]}
                    </span>
                    <span style={{ color: "#666", fontSize: 11 }}>{e["e.type"]}</span>
                  </span>
                  <span style={{ color: "#888", fontSize: 12, fontFamily: "monospace", flexShrink: 0, marginLeft: 8 }}>
                    ×{e["e.occurrences"]}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Neighbor panel */}
        <div
          style={{
            background: "#111",
            border: "1px solid #222",
            borderRadius: 12,
            padding: 16,
            maxHeight: 600,
            overflowY: "auto",
          }}
        >
          {!selected ? (
            <div style={{ padding: 24, textAlign: "center", color: "#666", fontSize: 13 }}>
              Click an entity to see its graph neighbors (up to 2 hops).
            </div>
          ) : (
            <>
              <h3
                style={{
                  fontSize: 15,
                  fontWeight: 700,
                  marginBottom: 4,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: TYPE_COLOR[selected["e.type"]] ?? "#666",
                  }}
                />
                {selected["e.name"]}
              </h3>
              <p style={{ color: "#666", fontSize: 12, marginBottom: 14 }}>
                {selected["e.type"]} · mentioned in {selected["e.occurrences"]} memories
              </p>
              <h4
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#888",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 10,
                }}
              >
                Neighbors ({neighbors.length})
              </h4>
              {neighborsLoading ? (
                <p style={{ color: "#666", fontSize: 13 }}>Loading neighbors…</p>
              ) : neighbors.length === 0 ? (
                <p style={{ color: "#666", fontSize: 13 }}>No neighbors within 2 hops.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {neighbors.map((n, i) => {
                    const name = n["connected.name"]!;
                    const type = n["connected.type"] ?? "concept";
                    const color = TYPE_COLOR[type] ?? "#666";
                    return (
                      <div
                        key={`${name}-${i}`}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          background: "#161616",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          fontSize: 13,
                        }}
                      >
                        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: "50%",
                              background: color,
                            }}
                          />
                          {name}
                        </span>
                        <span style={{ color: "#666", fontSize: 11 }}>{type}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
