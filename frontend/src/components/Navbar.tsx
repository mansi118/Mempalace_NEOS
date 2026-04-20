interface Props {
  onSearchClick: () => void;
  palaceName?: string;
}

export default function Navbar({ onSearchClick, palaceName }: Props) {
  return (
    <nav style={{
      position: "fixed", top: 0, left: 0, right: 0, height: 64,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      padding: "0 24px",
      background: "rgba(0,0,0,0.85)", backdropFilter: "blur(20px)",
      borderBottom: "1px solid #222", zIndex: 100,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8,
          background: "linear-gradient(135deg, #00D4AA, #00A888)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, fontWeight: 800, color: "#000",
        }}>P</div>
        <span style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em" }}>PALACE</span>
        {palaceName && (
          <span style={{ color: "#666", fontSize: 13 }}>/ {palaceName}</span>
        )}
      </div>

      <button onClick={onSearchClick} style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 16px", borderRadius: 10,
        background: "#111", border: "1px solid #333",
        color: "#888", fontSize: 13, cursor: "pointer",
      }}>
        <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <circle cx={11} cy={11} r={8}/><path d="M21 21l-4.35-4.35"/>
        </svg>
        Search memories
        <kbd style={{
          marginLeft: 8, padding: "2px 6px", borderRadius: 4,
          background: "#1C1C1C", border: "1px solid #333",
          fontSize: 10, fontFamily: "monospace", color: "#666",
        }}>Ctrl+K</kbd>
      </button>
    </nav>
  );
}
