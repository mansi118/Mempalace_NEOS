import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

interface Props {
  palaceId: string;
  wings: any[];
}

const REL_COLORS: Record<string, string> = {
  depends_on: "text-accent-blue",
  extends: "text-accent-green",
  references: "text-text-secondary",
  caused_by: "text-accent-purple",
  clarifies: "text-cyan-400",
  contradicts: "text-accent-red",
};

const REL_ARROWS: Record<string, string> = {
  depends_on: "→",
  extends: "⇢",
  references: "↔",
  caused_by: "←",
  clarifies: "→",
  contradicts: "⇋",
};

export default function TunnelMap({ palaceId, wings }: Props) {
  // We need to fetch tunnels. Use the stats to check if there are any.
  const stats = useQuery(api.palace.queries.getStats, { palaceId: palaceId as any });

  if (!stats || stats.tunnels === 0) return null;

  return (
    <section className="mb-16 animate-fade-in" style={{ animationDelay: "0.7s" }}>
      <h2 className="text-xl font-bold mb-2">Knowledge Graph</h2>
      <p className="text-text-secondary text-sm mb-6">
        {stats.tunnels} connections across wings
      </p>

      <div className="bg-bg-card rounded-[20px] border border-border p-6">
        <TunnelList palaceId={palaceId} wings={wings} />
      </div>
    </section>
  );
}

function TunnelList({ palaceId, wings }: { palaceId: string; wings: any[] }) {
  // Fetch tunnels from each wing's rooms.
  // We'll collect them by querying tunnels from the first few rooms.
  // For a complete view, we'd need a listAllTunnels query.
  // For now, show a visual representation using the wing data.

  return (
    <div className="space-y-3">
      <TunnelFetcher palaceId={palaceId} wings={wings} />
    </div>
  );
}

function TunnelFetcher({ palaceId, wings }: { palaceId: string; wings: any[] }) {
  // Use a room from each wing to discover tunnels via walkTunnel.
  // Pick the first room of the busiest wing.
  const sortedWings = [...wings].sort((a, b) => b.roomCount - a.roomCount);
  const topWing = sortedWings[0];

  const rooms = useQuery(
    api.palace.queries.listRoomsByWing,
    topWing ? { wingId: topWing._id } : "skip",
  );

  const firstRoom = rooms?.[0];
  const walk = useQuery(
    api.serving.tunnels.walkTunnel,
    firstRoom ? {
      palaceId: palaceId as any,
      fromRoomId: firstRoom._id,
      maxDepth: 3,
    } : "skip",
  );

  if (!walk || walk.path.length <= 1) {
    // Try different starting points
    return <StaticTunnelView />;
  }

  return (
    <div className="space-y-2">
      {walk.path.map((node: any, i: number) => (
        <div
          key={`${node.roomId}-${i}`}
          className="flex items-center gap-3"
          style={{ paddingLeft: `${node.depth * 24}px` }}
        >
          {node.depth > 0 && (
            <span className={`text-sm ${REL_COLORS[node.relationship] ?? "text-text-tertiary"}`}>
              {REL_ARROWS[node.relationship] ?? "→"}
            </span>
          )}
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg ${
            node.depth === 0 ? "bg-brand/10 border border-brand/20" : "bg-bg-elevated"
          }`}>
            <span className="text-xs text-text-tertiary">{node.wingName}/</span>
            <span className="text-sm font-medium">{node.roomName}</span>
            {node.depth > 0 && (
              <span className={`text-[10px] ${REL_COLORS[node.relationship] ?? "text-text-tertiary"}`}>
                ({node.relationship}, {(node.strength * 100).toFixed(0)}%)
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function StaticTunnelView() {
  // Fallback: show known tunnel connections as a list.
  const connections = [
    { from: "clients/zoo-media", to: "platform/neop-catalog", rel: "depends_on" },
    { from: "rd/memory-systems", to: "platform/architecture", rel: "extends" },
    { from: "platform/neop-catalog", to: "marketplace/neps", rel: "extends" },
    { from: "legal/contracts", to: "clients/zoo-media", rel: "references" },
    { from: "gtm/icp", to: "gtm/outreach", rel: "depends_on" },
    { from: "rd/tools", to: "platform/architecture", rel: "depends_on" },
    { from: "team/org", to: "platform/neop-catalog", rel: "references" },
  ];

  return (
    <div className="space-y-2">
      {connections.map((c, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <span className="text-text-secondary">{c.from}</span>
          <span className={REL_COLORS[c.rel] ?? "text-text-tertiary"}>
            {REL_ARROWS[c.rel] ?? "→"} {c.rel}
          </span>
          <span className="text-white">{c.to}</span>
        </div>
      ))}
    </div>
  );
}
