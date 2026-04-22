interface Props {
  onHomeClick: () => void;
  onSearchClick: () => void;
  onTestClick: () => void;
}

export default function Footer({ onHomeClick, onSearchClick, onTestClick }: Props) {
  const linkStyle: React.CSSProperties = {
    display: "inline-block",
    background: "transparent",
    border: "none",
    padding: 0,
    fontSize: 13,
    color: "#888",
    cursor: "pointer",
    textAlign: "left",
    transition: "color 0.15s",
  };

  const onHover = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.color = "#fff";
  };
  const onLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.color = "#888";
  };

  return (
    <footer style={{ borderTop: "1px solid #222", marginTop: 48 }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "40px 20px 32px" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 32,
          }}
        >
          <div>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Palace</h4>
            <ul
              style={{
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                margin: 0,
                padding: 0,
              }}
            >
              <li>
                <button style={linkStyle} onClick={onHomeClick} onMouseOver={onHover} onMouseOut={onLeave}>
                  Dashboard
                </button>
              </li>
              <li>
                <button style={linkStyle} onClick={onSearchClick} onMouseOver={onHover} onMouseOut={onLeave}>
                  Search
                </button>
              </li>
              <li>
                <button style={linkStyle} onClick={onTestClick} onMouseOver={onHover} onMouseOut={onLeave}>
                  Playground
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Stack</h4>
            <ul
              style={{
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                margin: 0,
                padding: 0,
                color: "#888",
                fontSize: 13,
              }}
            >
              <li>Convex — backend</li>
              <li>Bedrock Titan — embeddings</li>
              <li>FalkorDB — graph</li>
              <li>Groq Llama — extraction</li>
              <li>MCP Protocol — tool layer</li>
            </ul>
          </div>

          <div>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Source</h4>
            <ul
              style={{
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                margin: 0,
                padding: 0,
              }}
            >
              <li>
                <a
                  href="https://github.com/mansi118/Mempalace_NEOS"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: "#888", textDecoration: "none", fontSize: 13 }}
                  onMouseOver={(e) => (e.currentTarget.style.color = "#fff")}
                  onMouseOut={(e) => (e.currentTarget.style.color = "#888")}
                >
                  GitHub ↗
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>NeuralEDGE</h4>
            <ul
              style={{
                listStyle: "none",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                margin: 0,
                padding: 0,
                color: "#888",
                fontSize: 13,
              }}
            >
              <li>NEOS Platform</li>
              <li>NEop Agents</li>
              <li>Context Vault</li>
              <li>Synlex Technologies</li>
            </ul>
          </div>
        </div>

        <div
          style={{
            marginTop: 32,
            paddingTop: 20,
            borderTop: "1px solid #222",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
            color: "#555",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span>PALACE v1.0 — Context Vault for NEops</span>
          <span>Built by NeuralEDGE</span>
        </div>
      </div>
    </footer>
  );
}
