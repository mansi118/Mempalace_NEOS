import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";

interface Props {
  palaceId: string;
  onBack: () => void;
  onRoomClick?: (roomId: string) => void;
}

type Tab = "quarantine" | "audit" | "neops" | "pipeline";

export default function AdminView({ palaceId, onBack, onRoomClick }: Props) {
  const [tab, setTab] = useState<Tab>("quarantine");

  return (
    <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 20px 48px" }}>
      <button
        onClick={onBack}
        style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          color: "#B0B0B0", fontSize: 13, fontWeight: 500,
          background: "#111", border: "1px solid #222", borderRadius: 8,
          padding: "8px 14px", cursor: "pointer", marginBottom: 20,
        }}
      >
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Back
      </button>

      <h1 style={{ fontSize: "clamp(22px, 3vw, 28px)", fontWeight: 700, marginBottom: 6 }}>
        Admin Console
      </h1>
      <p style={{ color: "#888", fontSize: 14, marginBottom: 24 }}>
        Moderation, audit trail, NEop access, and pipeline health.
      </p>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #222", marginBottom: 20, flexWrap: "wrap" }}>
        {([
          { id: "quarantine", label: "Quarantine" },
          { id: "audit", label: "Audit log" },
          { id: "neops", label: "NEops" },
          { id: "pipeline", label: "Pipeline" },
        ] as Array<{ id: Tab; label: string }>).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "10px 16px",
              background: "transparent",
              border: "none",
              borderBottom: tab === t.id ? "2px solid #00D4AA" : "2px solid transparent",
              color: tab === t.id ? "#fff" : "#888",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "quarantine" && <QuarantineTab palaceId={palaceId} onRoomClick={onRoomClick} />}
      {tab === "audit" && <AuditTab palaceId={palaceId} />}
      {tab === "neops" && <NeopsTab palaceId={palaceId} />}
      {tab === "pipeline" && <PipelineTab palaceId={palaceId} />}
    </div>
  );
}

function QuarantineTab({ palaceId, onRoomClick }: { palaceId: string; onRoomClick?: (id: string) => void }) {
  const items = useQuery(api.palace.queries.listQuarantined, { palaceId: palaceId as any });

  if (!items) return <div style={{ color: "#666", fontSize: 13 }}>Loading…</div>;
  if (items.length === 0) {
    return (
      <div style={{ background: "#111", border: "1px solid #222", borderRadius: 12, padding: 32, textAlign: "center" }}>
        <p style={{ color: "#10B981", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>✓ Queue is empty</p>
        <p style={{ color: "#666", fontSize: 13 }}>No closets flagged for review.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <p style={{ color: "#888", fontSize: 13, marginBottom: 4 }}>
        {items.length} memor{items.length === 1 ? "y" : "ies"} need review (low confidence, PII-flagged, or extraction fallback)
      </p>
      {items.map((c: any) => (
        <div
          key={c._id}
          style={{ background: "#111", border: "1px solid #222", borderRadius: 10, padding: 14 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: "rgba(245,158,11,0.2)", color: "#F59E0B" }}>
              {c.category}
            </span>
            <span style={{ fontSize: 11, color: "#555" }}>conf {(c.confidence * 100).toFixed(0)}%</span>
            {c.piiTags?.length > 0 && (
              <span style={{ fontSize: 11, color: "#FF4136", padding: "2px 8px", borderRadius: 4, background: "rgba(255,65,54,0.1)" }}>
                PII: {c.piiTags.join(", ")}
              </span>
            )}
            <span style={{ color: "#555", fontSize: 11, marginLeft: "auto" }}>
              {new Date(c.createdAt).toLocaleString()}
            </span>
          </div>
          {c.title && <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{c.title}</div>}
          <p style={{ color: "#B0B0B0", fontSize: 13, lineHeight: 1.5 }}>
            {c.content.slice(0, 240)}{c.content.length > 240 ? "…" : ""}
          </p>
          {onRoomClick && c.roomId && (
            <button
              onClick={() => onRoomClick(c.roomId)}
              style={{
                marginTop: 8, background: "transparent", border: "none", color: "#00D4AA",
                fontSize: 12, fontWeight: 500, cursor: "pointer", padding: 0,
              }}
            >
              View in room →
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function AuditTab({ palaceId }: { palaceId: string }) {
  const events = useQuery(api.access.queries.recentAuditEvents, { palaceId: palaceId as any, limit: 50 });
  if (!events) return <div style={{ color: "#666", fontSize: 13 }}>Loading…</div>;
  if (events.length === 0) {
    return <p style={{ color: "#666", fontSize: 13 }}>No audit events yet.</p>;
  }

  const statusColor: Record<string, string> = {
    ok: "#10B981",
    denied: "#F59E0B",
    error: "#FF4136",
  };

  return (
    <div style={{ background: "#111", border: "1px solid #222", borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {events.map((e: any) => {
          const color = statusColor[e.status] ?? "#888";
          return (
            <div
              key={e._id}
              style={{
                display: "grid",
                gridTemplateColumns: "auto auto minmax(0, 1fr) auto auto",
                gap: 12,
                alignItems: "center",
                padding: "8px 10px",
                borderRadius: 6,
                background: "#161616",
                fontSize: 13,
              }}
            >
              <span style={{ color, fontSize: 11, fontWeight: 600, textTransform: "uppercase", width: 50 }}>
                {e.status}
              </span>
              <span style={{ color: "#B0B0B0", fontFamily: "monospace", fontSize: 12 }}>{e.op}</span>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
                <span style={{ color: "#888" }}>{e.neopId}</span>
                {e.wing && <span style={{ color: "#555" }}> · {e.wing}{e.room ? `/${e.room}` : ""}</span>}
              </span>
              <span style={{ color: "#888", fontSize: 12, fontFamily: "monospace", textAlign: "right" }}>
                {e.latencyMs}ms
              </span>
              <span style={{ color: "#555", fontSize: 11, textAlign: "right" }}>
                {new Date(e.timestamp).toLocaleTimeString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NeopsTab({ palaceId }: { palaceId: string }) {
  const neops = useQuery(api.access.queries.listNeops, { palaceId: palaceId as any });
  if (!neops) return <div style={{ color: "#666", fontSize: 13 }}>Loading…</div>;
  if (neops.length === 0) return <p style={{ color: "#666", fontSize: 13 }}>No NEops registered.</p>;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
        gap: 10,
      }}
    >
      {neops.map((n: any) => (
        <div
          key={n.neopId}
          style={{ background: "#111", border: "1px solid #222", borderRadius: 10, padding: 14 }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{n.neopId}</span>
            {n.parentNeopId && (
              <span style={{ fontSize: 11, color: "#666" }}>← {n.parentNeopId}</span>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
            {n.runtimeOps.map((op: string) => (
              <span
                key={op}
                style={{
                  fontSize: 10,
                  padding: "2px 6px",
                  borderRadius: 4,
                  background: "#1C1C1C",
                  color: "#00D4AA",
                  fontFamily: "monospace",
                }}
              >
                {op}
              </span>
            ))}
          </div>
          {(n.scopeWing || n.scopeRoom) && (
            <div style={{ fontSize: 12, color: "#666" }}>
              scope: <span style={{ color: "#B0B0B0", fontFamily: "monospace" }}>
                {n.scopeWing ?? "*"}{n.scopeRoom ? `/${n.scopeRoom}` : ""}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function PipelineTab({ palaceId }: { palaceId: string }) {
  const pipeline = useQuery(api.serving.monitoring.pipelineHealth, { palaceId: palaceId as any });
  const ingestion = useQuery(api.serving.monitoring.ingestionActivity, { palaceId: palaceId as any, lastHours: 168 });
  const errors = useQuery(api.serving.monitoring.errorRate, { palaceId: palaceId as any, lastHours: 24 });

  if (!pipeline) return <div style={{ color: "#666", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
      <Card title="Embedding pipeline">
        <Row k="Generated" v={pipeline.embedding.generated} color="#10B981" />
        <Row k="Pending" v={pipeline.embedding.pending} />
        <Row k="Failed" v={pipeline.embedding.failed} color={pipeline.embedding.failed > 0 ? "#FF4136" : undefined} />
        <Row k="Coverage" v={`${pipeline.embedding.rate}%`} color={pipeline.embedding.rate === 100 ? "#10B981" : "#F59E0B"} />
      </Card>
      <Card title="Graph ingestion">
        <Row k="Ingested" v={pipeline.graphiti.ingested} color="#10B981" />
        <Row k="Pending" v={pipeline.graphiti.pending} />
        <Row k="Failed" v={pipeline.graphiti.failed} color={pipeline.graphiti.failed > 0 ? "#FF4136" : undefined} />
      </Card>
      <Card title="Quarantine & audit">
        <Row k="Quarantined" v={pipeline.quarantined} color={pipeline.quarantined > 0 ? "#F59E0B" : undefined} />
        {errors && <Row k="Errors (24h)" v={errors.errors} color={errors.errors > 0 ? "#FF4136" : undefined} />}
        {errors && <Row k="Denied (24h)" v={errors.denied} />}
        {errors && <Row k="Total ops (24h)" v={errors.total} />}
      </Card>
      {ingestion && (
        <Card title="Ingestion (7d)">
          <Row k="Total" v={ingestion.total} />
          <Row k="Succeeded" v={ingestion.ok} color="#10B981" />
          <Row k="Errors" v={ingestion.error} color={ingestion.error > 0 ? "#FF4136" : undefined} />
          {ingestion.lastIngest && (
            <Row k="Last ingest" v={new Date(ingestion.lastIngest).toLocaleDateString()} />
          )}
        </Card>
      )}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ background: "#111", border: "1px solid #222", borderRadius: 12, padding: 16 }}>
      <h4 style={{ fontSize: 11, fontWeight: 600, color: "#888", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 12 }}>
        {title}
      </h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </div>
  );
}

function Row({ k, v, color }: { k: string; v: any; color?: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
      <span style={{ color: "#666" }}>{k}</span>
      <span style={{ fontFamily: "monospace", color: color ?? "#fff" }}>{v}</span>
    </div>
  );
}
