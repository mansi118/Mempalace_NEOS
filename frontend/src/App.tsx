import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import SearchPalette from "./components/SearchPalette";
import WingsGrid from "./components/WingsGrid";
import StatsPanel from "./components/StatsPanel";
import RoomView from "./components/RoomView";
import Footer from "./components/Footer";

export default function App() {
  const [activePalaceId, setActivePalaceId] = useState<string | null>(null);
  const [activeWingId, setActiveWingId] = useState<string | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const palaces = useQuery(api.palace.queries.listPalaces, { onlyReady: true });
  const palace = palaces?.[0];
  const palaceId = palace?._id ?? activePalaceId;

  const stats = useQuery(
    api.palace.queries.getStats,
    palaceId ? { palaceId: palaceId as any } : "skip",
  );

  const wings = useQuery(
    api.palace.queries.listWings,
    palaceId ? { palaceId: palaceId as any } : "skip",
  );

  return (
    <div className="min-h-screen bg-bg-primary">
      <Navbar onSearchClick={() => setSearchOpen(true)} palaceName={palace?.name} />

      {searchOpen && (
        <SearchPalette
          palaceId={palaceId as any}
          onClose={() => setSearchOpen(false)}
        />
      )}

      {activeRoomId && palaceId ? (
        <div className="pt-[70px]">
          <RoomView
            palaceId={palaceId as any}
            roomId={activeRoomId as any}
            onBack={() => setActiveRoomId(null)}
          />
        </div>
      ) : (
        <>
          <Hero
            palace={palace}
            stats={stats}
            onSearch={() => setSearchOpen(true)}
          />

          <main className="max-w-[1280px] mx-auto px-6">
            {stats && (
              <StatsPanel stats={stats} />
            )}

            {wings && palaceId && (
              <WingsGrid
                wings={wings}
                palaceId={palaceId as any}
                onRoomClick={(roomId) => setActiveRoomId(roomId)}
              />
            )}
          </main>

          <Footer />
        </>
      )}
    </div>
  );
}
