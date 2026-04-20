export default function Footer() {
  const cols = [
    { title: "Palace", items: ["Dashboard", "Search", "Browse Wings", "Stats"] },
    { title: "Data", items: ["Ingest", "Export", "Quarantine", "Monitoring"] },
    { title: "Stack", items: ["Convex", "FalkorDB", "Qwen Embeddings", "MCP Protocol"] },
    { title: "NeuralEDGE", items: ["NEOS Platform", "NEop Agents", "Context Vault", "Synlex Technologies"] },
  ];

  return (
    <footer style={{ borderTop: "1px solid #222", marginTop: 64 }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "48px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 32 }}>
          {cols.map(col => (
            <div key={col.title}>
              <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>{col.title}</h4>
              <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
                {col.items.map(item => (
                  <li key={item} style={{ fontSize: 13, color: "#888" }}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 40, paddingTop: 24, borderTop: "1px solid #222",
          display: "flex", justifyContent: "space-between", fontSize: 12, color: "#555",
        }}>
          <span>PALACE v1.0 — Context Vault for NEops</span>
          <span>Built by NeuralEDGE</span>
        </div>
      </div>
    </footer>
  );
}
