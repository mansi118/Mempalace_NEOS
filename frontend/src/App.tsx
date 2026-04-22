import { useState, useEffect, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import Navbar from "./components/Navbar";
import Hero from "./components/Hero";
import SearchPalette from "./components/SearchPalette";
import WingsGrid from "./components/WingsGrid";
import StatsPanel from "./components/StatsPanel";
import MonitoringPanel from "./components/MonitoringPanel";
import TunnelMap from "./components/TunnelMap";
import RoomView from "./components/RoomView";
import Footer from "./components/Footer";
import TestPlayground from "./components/TestPlayground";
import EntitiesView from "./components/EntitiesView";
import QueriesView from "./components/QueriesView";
import AdminView from "./components/AdminView";

// URL-hash router. Uses history so browser back/forward work naturally.
//   /            → home
//   /room/:id    → a specific room
//   /test        → search playground
//   /entities    → entity graph explorer
//   /queries     → query analytics
//   /admin       → moderation, audit, NEops, pipeline
type Route =
  | { name: "home" }
  | { name: "room"; roomId: string }
  | { name: "test" }
  | { name: "entities" }
  | { name: "queries" }
  | { name: "admin" };

function parseRoute(hash: string): Route {
  const clean = hash.replace(/^#/, "");
  if (clean.startsWith("/room/")) {
    const id = clean.slice(6);
    if (id) return { name: "room", roomId: id };
  }
  if (clean === "/test") return { name: "test" };
  if (clean === "/entities") return { name: "entities" };
  if (clean === "/queries") return { name: "queries" };
  if (clean === "/admin") return { name: "admin" };
  return { name: "home" };
}

function useRouter() {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(window.location.hash));
      // Scroll to top on navigation so users don't land mid-page.
      window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = useCallback((hash: string) => {
    if (window.location.hash === hash) return;
    window.location.hash = hash;
  }, []);

  const back = useCallback(() => {
    // If there's nothing to go back to in history, go home explicitly.
    if (window.history.length > 1) window.history.back();
    else window.location.hash = "";
  }, []);

  return { route, navigate, back };
}

export default function App() {
  const { route, navigate, back } = useRouter();
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

  // Keyboard: Ctrl+K opens search, "/" also opens search (unless typing).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "/" && !typing && !searchOpen) {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [searchOpen]);

  // Close search palette on route change.
  useEffect(() => setSearchOpen(false), [route]);

  const goHome = useCallback(() => navigate(""), [navigate]);
  const goTest = useCallback(() => navigate("#/test"), [navigate]);
  const goRoom = useCallback((id: string) => navigate(`#/room/${id}`), [navigate]);
  const goEntities = useCallback(() => navigate("#/entities"), [navigate]);
  const goQueries = useCallback(() => navigate("#/queries"), [navigate]);
  const goAdmin = useCallback(() => navigate("#/admin"), [navigate]);

  return (
    <div style={{ minHeight: "100vh", background: "#000", color: "#fff" }}>
      <Navbar
        onSearchClick={() => setSearchOpen(true)}
        onHomeClick={goHome}
        onTestClick={goTest}
        onEntitiesClick={goEntities}
        onQueriesClick={goQueries}
        onAdminClick={goAdmin}
        palaceName={palace?.name}
        route={route.name}
      />

      {searchOpen && palaceId && (
        <SearchPalette
          palaceId={palaceId as any}
          onClose={() => setSearchOpen(false)}
          onResultClick={(roomId) => {
            setSearchOpen(false);
            if (roomId) goRoom(roomId);
          }}
        />
      )}

      {/* Route: /test */}
      {route.name === "test" && palaceId && (
        <main style={{ paddingTop: 64 }}>
          <TestPlayground palaceId={palaceId as string} onBack={back} />
        </main>
      )}

      {/* Route: /entities */}
      {route.name === "entities" && palaceId && palace?.clientId && (
        <main style={{ paddingTop: 64 }}>
          <EntitiesView
            palaceId={palaceId as string}
            clientId={palace.clientId}
            onBack={back}
            onRoomClick={goRoom}
          />
        </main>
      )}

      {/* Route: /queries */}
      {route.name === "queries" && palaceId && (
        <main style={{ paddingTop: 64 }}>
          <QueriesView palaceId={palaceId as string} onBack={back} />
        </main>
      )}

      {/* Route: /admin */}
      {route.name === "admin" && palaceId && (
        <main style={{ paddingTop: 64 }}>
          <AdminView palaceId={palaceId as string} onBack={back} onRoomClick={goRoom} />
        </main>
      )}

      {/* Route: /room/:id */}
      {route.name === "room" && palaceId && (
        <main style={{ paddingTop: 64 }}>
          <RoomView palaceId={palaceId as any} roomId={route.roomId as any} onBack={back} />
        </main>
      )}

      {/* Route: / (home) */}
      {route.name === "home" && (
        <>
          <Hero
            palace={palace}
            stats={stats}
            onSearch={() => setSearchOpen(true)}
            onBrowse={() => {
              // Smooth scroll to the wings grid.
              document.getElementById("wings-grid")?.scrollIntoView({ behavior: "smooth" });
            }}
          />

          <main style={{ maxWidth: 1280, margin: "0 auto", padding: "0 24px" }}>
            {stats ? <StatsPanel stats={stats} /> : <SkeletonBlock label="Loading memory distribution…" />}

            {palaceId && <MonitoringPanel palaceId={palaceId as any} />}

            {wings && palaceId ? (
              <TunnelMap palaceId={palaceId as any} wings={wings} onRoomClick={goRoom} />
            ) : null}

            {wings && palaceId ? (
              <WingsGrid wings={wings} palaceId={palaceId as any} onRoomClick={goRoom} />
            ) : (
              <SkeletonBlock label="Loading wings…" />
            )}
          </main>
        </>
      )}

      <Footer onHomeClick={goHome} onSearchClick={() => setSearchOpen(true)} onTestClick={goTest} />
    </div>
  );
}

function SkeletonBlock({ label }: { label: string }) {
  return (
    <div
      className="anim-in"
      style={{
        margin: "32px 0",
        padding: 32,
        background: "#111",
        border: "1px solid #222",
        borderRadius: 16,
        textAlign: "center",
        color: "#666",
        fontSize: 13,
      }}
    >
      <div
        style={{
          display: "inline-block",
          width: 14,
          height: 14,
          border: "2px solid #333",
          borderTopColor: "#00D4AA",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
          marginRight: 10,
          verticalAlign: "middle",
        }}
      />
      {label}
    </div>
  );
}
