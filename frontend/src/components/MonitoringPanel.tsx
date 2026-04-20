import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

interface Props { palaceId: string; }

export default function MonitoringPanel({ palaceId }: Props) {
  const latency = useQuery(api.serving.monitoring.searchLatencyStats, { palaceId: palaceId as any, lastHours: 24 });
  const errors = useQuery(api.serving.monitoring.errorRate, { palaceId: palaceId as any, lastHours: 24 });
  const pipeline = useQuery(api.serving.monitoring.pipelineHealth, { palaceId: palaceId as any });

  const cards = [
    {
      title: "Search Latency", ok: latency ? latency.p95 < 2000 : true,
      items: latency ? [
        { k: "p50", v: `${latency.p50}ms` },
        { k: "p95", v: `${latency.p95}ms` },
        { k: "Queries", v: `${latency.count}` },
      ] : null,
    },
    {
      title: "Reliability", ok: errors ? errors.errorRate < 0.05 : true,
      items: errors ? [
        { k: "Total ops", v: `${errors.total}` },
        { k: "Errors", v: `${errors.errors}`, bad: errors.errors > 0 },
        { k: "Denied", v: `${errors.denied}` },
      ] : null,
    },
    {
      title: "Embeddings", ok: pipeline ? pipeline.embedding.rate === 100 : true,
      items: pipeline ? [
        { k: "Generated", v: `${pipeline.embedding.generated}`, good: true },
        { k: "Failed", v: `${pipeline.embedding.failed}`, bad: pipeline.embedding.failed > 0 },
        { k: "Coverage", v: `${pipeline.embedding.rate}%`, good: pipeline.embedding.rate === 100 },
      ] : null,
    },
    {
      title: "Graph", ok: pipeline ? pipeline.graphiti.failed === 0 : true,
      items: pipeline ? [
        { k: "Ingested", v: `${pipeline.graphiti.ingested}` },
        { k: "Pending", v: `${pipeline.graphiti.pending}` },
        { k: "Quarantine", v: `${pipeline.quarantined}`, bad: pipeline.quarantined > 0 },
      ] : null,
    },
  ];

  return (
    <section className="anim-in" style={{ marginBottom: 48, animationDelay: "0.6s" }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>System Health</h2>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 20 }}>Real-time monitoring (last 24h)</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
        {cards.map(card => (
          <div key={card.title} style={{ background: "#111", borderRadius: 12, border: "1px solid #222", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em" }}>{card.title}</span>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: !card.items ? "#666" : card.ok ? "#10B981" : "#F59E0B" }}/>
            </div>
            {!card.items ? (
              <p style={{ color: "#666", fontSize: 13, textAlign: "center", padding: 12 }}>Loading...</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {card.items.map(item => (
                  <div key={item.k} style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                    <span style={{ color: "#666" }}>{item.k}</span>
                    <span style={{ fontFamily: "monospace", color: (item as any).bad ? "#FF4136" : (item as any).good ? "#10B981" : "#fff" }}>{item.v}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
