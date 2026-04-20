import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import SearchPalette from "./components/SearchPalette";
import WingsGrid from "./components/WingsGrid";
import StatsPanel from "./components/StatsPanel";
import MonitoringPanel from "./components/MonitoringPanel";
import TunnelMap from "./components/TunnelMap";
import RoomView from "./components/RoomView";
import Footer from "./components/Footer";

export default function App() {
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const palaces = useQuery(api.palace.queries.listPalaces, { onlyReady: true });
  const palace = palaces?.[0];
  const palaceId = palace?._id;

  const stats = useQuery(
    api.palace.queries.getStats,
    palaceId ? { palaceId: palaceId as any } : "skip",
  );

  const wings = useQuery(
    api.palace.queries.listWings,
    palaceId ? { palaceId: palaceId as any } : "skip",
  );

  // Keyboard shortcut: Ctrl+K opens search.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div className="min-h-screen bg-bg-primary">
      <Navbar onSearchClick={() => setSearchOpen(true)} palaceName={palace?.name} />

      {searchOpen && palaceId && (
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
            {stats && <StatsPanel stats={stats} />}

            {palaceId && <MonitoringPanel palaceId={palaceId as any} />}

            {wings && palaceId && (
              <TunnelMap palaceId={palaceId as any} wings={wings} />
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
