import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";

interface Props {
  palaceId: string;
}

export default function MonitoringPanel({ palaceId }: Props) {
  const latency = useQuery(api.serving.monitoring.searchLatencyStats, {
    palaceId: palaceId as any,
    lastHours: 24,
  });
  const errors = useQuery(api.serving.monitoring.errorRate, {
    palaceId: palaceId as any,
    lastHours: 24,
  });
  const pipeline = useQuery(api.serving.monitoring.pipelineHealth, {
    palaceId: palaceId as any,
  });
  const ingestion = useQuery(api.serving.monitoring.ingestionActivity, {
    palaceId: palaceId as any,
    lastHours: 24,
  });

  return (
    <section className="mb-16 animate-fade-in" style={{ animationDelay: "0.6s" }}>
      <h2 className="text-xl font-bold mb-2">System Health</h2>
      <p className="text-text-secondary text-sm mb-6">Real-time monitoring (last 24h)</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Search latency */}
        <MetricCard
          title="Search Latency"
          loading={!latency}
          items={latency ? [
            { label: "p50", value: `${latency.p50}ms`, color: latency.p50 < 1000 ? "text-accent-green" : "text-accent-amber" },
            { label: "p95", value: `${latency.p95}ms`, color: latency.p95 < 2000 ? "text-accent-green" : "text-accent-amber" },
            { label: "Queries", value: `${latency.count}` },
          ] : []}
          status={!latency ? "loading" : latency.count === 0 ? "idle" : latency.p95 < 2000 ? "healthy" : "degraded"}
        />

        {/* Error rate */}
        <MetricCard
          title="Reliability"
          loading={!errors}
          items={errors ? [
            { label: "Total ops", value: `${errors.total}` },
            { label: "Errors", value: `${errors.errors}`, color: errors.errors > 0 ? "text-accent-red" : "text-accent-green" },
            { label: "Denied", value: `${errors.denied}`, color: errors.denied > 0 ? "text-accent-amber" : "text-text-secondary" },
          ] : []}
          status={!errors ? "loading" : errors.total === 0 ? "idle" : errors.errorRate < 0.05 ? "healthy" : "degraded"}
        />

        {/* Embedding pipeline */}
        <MetricCard
          title="Embeddings"
          loading={!pipeline}
          items={pipeline ? [
            { label: "Generated", value: `${pipeline.embedding.generated}`, color: "text-accent-green" },
            { label: "Failed", value: `${pipeline.embedding.failed}`, color: pipeline.embedding.failed > 0 ? "text-accent-red" : "text-text-secondary" },
            { label: "Coverage", value: `${pipeline.embedding.rate}%`, color: pipeline.embedding.rate === 100 ? "text-accent-green" : "text-accent-amber" },
          ] : []}
          status={!pipeline ? "loading" : pipeline.embedding.rate === 100 ? "healthy" : pipeline.embedding.failed > 0 ? "degraded" : "pending"}
        />

        {/* Ingestion */}
        <MetricCard
          title="Ingestion"
          loading={!ingestion}
          items={ingestion ? [
            { label: "Processed", value: `${ingestion.total}` },
            { label: "Closets", value: `${ingestion.closetsCreated}`, color: "text-accent-green" },
            { label: "Success", value: `${ingestion.successRate}%`, color: ingestion.successRate > 90 ? "text-accent-green" : "text-accent-amber" },
          ] : []}
          status={!ingestion ? "loading" : ingestion.total === 0 ? "idle" : ingestion.successRate > 90 ? "healthy" : "degraded"}
        />
      </div>

      {/* Quarantine + Graph status */}
      {pipeline && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div className="bg-bg-card rounded-[14px] border border-border p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Quarantine Queue</div>
              <div className={`text-2xl font-bold ${pipeline.quarantined > 0 ? "text-accent-amber" : "text-accent-green"}`}>
                {pipeline.quarantined}
              </div>
            </div>
            <div className={`w-3 h-3 rounded-full ${pipeline.quarantined > 0 ? "bg-accent-amber animate-pulse" : "bg-accent-green"}`} />
          </div>

          <div className="bg-bg-card rounded-[14px] border border-border p-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-text-tertiary uppercase tracking-wider mb-1">Graph Status</div>
              <div className="text-sm">
                <span className="text-accent-green">{pipeline.graphiti.ingested} ingested</span>
                {pipeline.graphiti.pending > 0 && (
                  <span className="text-text-tertiary ml-2">{pipeline.graphiti.pending} pending</span>
                )}
                {pipeline.graphiti.failed > 0 && (
                  <span className="text-accent-red ml-2">{pipeline.graphiti.failed} failed</span>
                )}
              </div>
            </div>
            <div className={`w-3 h-3 rounded-full ${
              pipeline.graphiti.failed > 0 ? "bg-accent-red" :
              pipeline.graphiti.pending > 0 ? "bg-accent-amber animate-pulse" :
              "bg-accent-green"
            }`} />
          </div>
        </div>
      )}
    </section>
  );
}

function MetricCard({ title, items, status, loading }: {
  title: string;
  items: Array<{ label: string; value: string; color?: string }>;
  status: "healthy" | "degraded" | "idle" | "loading" | "pending";
  loading: boolean;
}) {
  const statusColor = {
    healthy: "bg-accent-green",
    degraded: "bg-accent-amber",
    idle: "bg-text-tertiary",
    loading: "bg-text-tertiary animate-pulse",
    pending: "bg-accent-blue animate-pulse",
  }[status];

  return (
    <div className="bg-bg-card rounded-[14px] border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-text-secondary uppercase tracking-wider">{title}</h3>
        <div className={`w-2.5 h-2.5 rounded-full ${statusColor}`} />
      </div>
      {loading ? (
        <div className="h-16 flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.label} className="flex justify-between text-sm">
              <span className="text-text-tertiary">{item.label}</span>
              <span className={`font-mono ${item.color ?? "text-white"}`}>{item.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
