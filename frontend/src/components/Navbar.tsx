interface Props {
  onSearchClick: () => void;
  onHomeClick: () => void;
  onTestClick: () => void;
  onEntitiesClick: () => void;
  onQueriesClick: () => void;
  onAdminClick: () => void;
  palaceName?: string;
  route: "home" | "room" | "test" | "entities" | "queries" | "admin";
}

const linkBase: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "#888",
  fontSize: 13,
  fontWeight: 500,
  padding: "6px 10px",
  borderRadius: 8,
  cursor: "pointer",
  transition: "color 0.15s, background 0.15s",
};

export default function Navbar({
  onSearchClick,
  onHomeClick,
  onTestClick,
  onEntitiesClick,
  onQueriesClick,
  onAdminClick,
  palaceName,
  route,
}: Props) {
  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 64,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        background: "rgba(0,0,0,0.85)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        borderBottom: "1px solid #222",
        zIndex: 100,
        gap: 12,
      }}
    >
      {/* Logo — click to go home */}
      <button
        onClick={onHomeClick}
        aria-label="Go to palace home"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: "4px 8px",
          borderRadius: 8,
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: "linear-gradient(135deg, #00D4AA, #00A888)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            fontWeight: 800,
            color: "#000",
            flexShrink: 0,
          }}
        >
          P
        </div>
        <span
          style={{
            fontSize: 17,
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: "#fff",
          }}
        >
          PALACE
        </span>
        {palaceName && (
          <span
            style={{
              color: "#666",
              fontSize: 13,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            / {palaceName}
          </span>
        )}
      </button>

      {/* Nav actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <NavLink label="Entities" active={route === "entities"} onClick={onEntitiesClick} />
        <NavLink label="Queries" active={route === "queries"} onClick={onQueriesClick} />
        <NavLink label="Admin" active={route === "admin"} onClick={onAdminClick} />
        <NavLink label="Test" active={route === "test"} onClick={onTestClick} />

        <button
          onClick={onSearchClick}
          aria-label="Search memories (Ctrl+K)"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 14px",
            borderRadius: 10,
            background: "#111",
            border: "1px solid #333",
            color: "#888",
            fontSize: 13,
            cursor: "pointer",
            transition: "border-color 0.15s, background 0.15s",
          }}
          onMouseOver={(e) => {
            e.currentTarget.style.borderColor = "#444";
            e.currentTarget.style.background = "#161616";
          }}
          onMouseOut={(e) => {
            e.currentTarget.style.borderColor = "#333";
            e.currentTarget.style.background = "#111";
          }}
        >
          <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <circle cx={11} cy={11} r={8} />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <span>Search</span>
          <kbd
            style={{
              marginLeft: 6,
              padding: "2px 6px",
              borderRadius: 4,
              background: "#1C1C1C",
              border: "1px solid #333",
              fontSize: 10,
              fontFamily: "monospace",
              color: "#666",
            }}
          >
            /
          </kbd>
        </button>
      </div>
    </nav>
  );
}

function NavLink({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...linkBase,
        color: active ? "#fff" : "#888",
        background: active ? "#1C1C1C" : "transparent",
        fontSize: 13,
        padding: "6px 10px",
      }}
      onMouseOver={(e) => (e.currentTarget.style.color = "#fff")}
      onMouseOut={(e) => {
        e.currentTarget.style.color = active ? "#fff" : "#888";
      }}
    >
      {label}
    </button>
  );
}
