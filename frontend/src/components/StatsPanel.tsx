interface Props { stats: any; }

const CAT_COLORS: Record<string, string> = {
  fact: "#4A9EFF", decision: "#A855F7", conversation: "#00D4AA",
  task: "#F59E0B", lesson: "#10B981", preference: "#EC4899",
  procedure: "#22D3EE", signal: "#FF4136", identity: "#fff",
};

export default function StatsPanel({ stats }: Props) {
  const cats = stats.closets?.byCategory ?? {};
  const total = stats.closets?.visible || 1;
  const pipeline = [
    { label: "Quarantine", val: stats.closets?.needsReview ?? 0, warn: true },
    { label: "Decayed", val: stats.closets?.decayed ?? 0 },
    { label: "Retracted", val: stats.closets?.retracted ?? 0, bad: true },
    { label: "Total stored", val: stats.closets?.total ?? 0, bold: true },
  ];

  return (
    <section className="anim-in" style={{ marginBottom: 48, animationDelay: "0.5s" }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Memory Distribution</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 16 }}>
        {/* Categories */}
        <div style={{ background: "#111", borderRadius: 16, border: "1px solid #222", padding: 24 }}>
          <h3 style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>By Category</h3>
          {Object.keys(cats).length === 0 ? (
            <p style={{ color: "#666", fontSize: 13 }}>No memories yet.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Object.entries(cats).sort(([,a],[,b]) => (b as number) - (a as number)).map(([cat, count]) => (
                <div key={cat}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
                    <span style={{ textTransform: "capitalize" }}>{cat}</span>
                    <span style={{ color: "#888" }}>{count as number}</span>
                  </div>
                  <div style={{ height: 5, background: "#1C1C1C", borderRadius: 3, overflow: "hidden" }}>
                    <div style={{
                      height: "100%", borderRadius: 3,
                      background: CAT_COLORS[cat] ?? "#666",
                      width: `${Math.max(3, ((count as number) / total) * 100)}%`,
                    }}/>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pipeline */}
        <div style={{ background: "#111", borderRadius: 16, border: "1px solid #222", padding: 24 }}>
          <h3 style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 16 }}>Pipeline Status</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {pipeline.map(item => (
              <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 13 }}>{item.label}</span>
                <span style={{
                  fontSize: 13, fontFamily: "monospace",
                  color: item.val > 0 && item.bad ? "#FF4136" : item.val > 0 && item.warn ? "#F59E0B" : item.bold ? "#fff" : "#888",
                }}>{item.val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
