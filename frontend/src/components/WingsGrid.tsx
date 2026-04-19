import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

const WING_ICONS: Record<string, string> = {
  platform: "P",
  clients: "C",
  team: "T",
  gtm: "G",
  legal: "L",
  rd: "R",
  marketplace: "M",
  infra: "I",
  partners: "V",
  brand: "B",
  audit: "A",
  _quarantine: "Q",
};

const WING_COLORS: Record<string, string> = {
  platform: "from-blue-500 to-blue-700",
  clients: "from-green-500 to-green-700",
  team: "from-purple-500 to-purple-700",
  gtm: "from-amber-500 to-amber-700",
  legal: "from-gray-400 to-gray-600",
  rd: "from-cyan-500 to-cyan-700",
  marketplace: "from-pink-500 to-pink-700",
  infra: "from-orange-500 to-orange-700",
  partners: "from-teal-500 to-teal-700",
  brand: "from-indigo-500 to-indigo-700",
  audit: "from-gray-500 to-gray-700",
  _quarantine: "from-red-500 to-red-700",
};

interface Props {
  wings: any[];
  palaceId: string;
  onRoomClick: (roomId: string) => void;
}

export default function WingsGrid({ wings, palaceId, onRoomClick }: Props) {
  const [expandedWing, setExpandedWing] = useState<string | null>(null);

  return (
    <section className="mb-20">
      <h2 className="text-xl font-bold mb-2">Wings</h2>
      <p className="text-text-secondary text-sm mb-6">
        {wings.length} wings organizing your institutional memory
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {wings.map((wing, i) => (
          <WingCard
            key={wing._id}
            wing={wing}
            index={i}
            expanded={expandedWing === wing._id}
            onToggle={() =>
              setExpandedWing(expandedWing === wing._id ? null : wing._id)
            }
            onRoomClick={onRoomClick}
          />
        ))}
      </div>
    </section>
  );
}

function WingCard({
  wing,
  index,
  expanded,
  onToggle,
  onRoomClick,
}: {
  wing: any;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  onRoomClick: (id: string) => void;
}) {
  const rooms = useQuery(
    api.palace.queries.listRoomsByWing,
    expanded ? { wingId: wing._id } : "skip",
  );

  const gradient = WING_COLORS[wing.name] ?? "from-gray-500 to-gray-700";
  const icon = WING_ICONS[wing.name] ?? wing.name[0]?.toUpperCase();

  return (
    <div
      className="bg-bg-card rounded-[20px] border border-border hover:border-border-subtle transition-all duration-200 overflow-hidden card-glow animate-fade-in"
      style={{ animationDelay: `${0.05 * index}s` }}
    >
      <button
        onClick={onToggle}
        className="w-full p-5 flex items-start gap-4 text-left cursor-pointer"
      >
        <div
          className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-sm font-bold text-white shrink-0`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-sm">{wing.name}</h3>
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className={`text-text-tertiary transition-transform ${expanded ? "rotate-180" : ""}`}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </div>
          <p className="text-text-tertiary text-xs mt-1 line-clamp-1">
            {wing.description}
          </p>
          <div className="flex gap-3 mt-2 text-[11px] text-text-tertiary">
            <span>{wing.roomCount} rooms</span>
            {wing.archived && (
              <span className="text-accent-amber">archived</span>
            )}
          </div>
        </div>
      </button>

      {expanded && rooms && (
        <div className="border-t border-border px-5 pb-4 pt-3">
          <div className="space-y-1">
            {rooms.map((room: any) => (
              <button
                key={room._id}
                onClick={() => onRoomClick(room._id)}
                className="w-full flex items-center justify-between py-2 px-3 rounded-lg hover:bg-bg-elevated text-sm transition-colors text-left cursor-pointer"
              >
                <div className="min-w-0">
                  <span className="font-medium">{room.name}</span>
                  <p className="text-text-tertiary text-xs truncate">
                    {room.summary}
                  </p>
                </div>
                <span className="text-text-tertiary text-xs shrink-0 ml-2">
                  {room.closetCount}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
