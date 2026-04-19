import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

interface Props {
  palaceId: string;
  roomId: string;
  onBack: () => void;
}

const CATEGORY_BADGE: Record<string, string> = {
  fact: "bg-blue-500/20 text-blue-400",
  decision: "bg-purple-500/20 text-purple-400",
  conversation: "bg-teal-500/20 text-teal-400",
  task: "bg-amber-500/20 text-amber-400",
  lesson: "bg-green-500/20 text-green-400",
  preference: "bg-pink-500/20 text-pink-400",
  procedure: "bg-cyan-500/20 text-cyan-400",
  signal: "bg-red-500/20 text-red-400",
  identity: "bg-white/20 text-white",
};

export default function RoomView({ palaceId, roomId, onBack }: Props) {
  const data = useQuery(api.serving.rooms.getRoomDeep, {
    palaceId: palaceId as any,
    roomId: roomId as any,
  });

  if (!data) {
    return (
      <div className="max-w-[1280px] mx-auto px-6 py-12">
        <div className="flex items-center gap-2 text-text-secondary">
          <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          Loading room...
        </div>
      </div>
    );
  }

  const { room, closets, tunnels, pagination } = data;

  return (
    <div className="max-w-[1280px] mx-auto px-6 py-8 animate-fade-in">
      {/* Header */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-text-secondary text-sm hover:text-white mb-6 transition-colors cursor-pointer"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back to palace
      </button>

      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="text-text-tertiary text-xs uppercase tracking-wider mb-1">
            {room.wing}
          </div>
          <h1 className="text-3xl font-bold">{room.name}</h1>
          <p className="text-text-secondary mt-2 max-w-xl">{room.summary}</p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-bold">{room.closetCount}</div>
          <div className="text-xs text-text-tertiary">memories</div>
        </div>
      </div>

      {/* Tunnels */}
      {tunnels.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-3">
            Connections
          </h2>
          <div className="flex flex-wrap gap-2">
            {tunnels.map((t: any, i: number) => (
              <span
                key={i}
                className="px-3 py-1.5 rounded-full bg-bg-card border border-border text-xs"
              >
                <span className="text-text-tertiary">{t.direction}</span>{" "}
                <span className="text-white font-medium">
                  {t.targetWing}/{t.targetRoom}
                </span>{" "}
                <span className="text-text-tertiary">({t.relationship})</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Closets */}
      <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">
        Memories ({closets.length}{pagination.hasMore ? "+" : ""})
      </h2>

      {closets.length === 0 ? (
        <div className="bg-bg-card rounded-[20px] border border-border p-8 text-center">
          <p className="text-text-secondary">No memories in this room yet</p>
          <p className="text-text-tertiary text-xs mt-1">
            Ingest data or use palace_remember to add memories
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {closets.map((closet: any, i: number) => (
            <div
              key={closet.id}
              className="bg-bg-card rounded-[14px] border border-border p-5 hover:border-border-subtle transition-colors animate-fade-in"
              style={{ animationDelay: `${0.03 * i}s` }}
            >
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full ${CATEGORY_BADGE[closet.category] ?? "bg-bg-elevated text-text-secondary"}`}
                >
                  {closet.category}
                </span>
                <span className="text-text-tertiary text-[11px]">
                  {new Date(closet.createdAt).toLocaleDateString()}
                </span>
                <span className="ml-auto text-text-tertiary text-[11px] font-mono">
                  {(closet.confidence * 100).toFixed(0)}% conf
                </span>
              </div>

              {closet.title && (
                <h3 className="font-semibold text-sm mb-1">{closet.title}</h3>
              )}

              <p className="text-text-secondary text-sm leading-relaxed whitespace-pre-wrap">
                {closet.content.length > 500
                  ? closet.content.slice(0, 500) + "..."
                  : closet.content}
              </p>

              {/* Drawers (facts) */}
              {closet.drawers.length > 0 && (
                <div className="mt-3 pl-3 border-l-2 border-border">
                  {closet.drawers.map((d: any, j: number) => (
                    <div
                      key={j}
                      className="text-xs text-text-secondary py-0.5 flex items-start gap-2"
                    >
                      <span className="text-brand mt-0.5 shrink-0">-</span>
                      {d.fact}
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
