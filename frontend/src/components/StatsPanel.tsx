interface Props {
  stats: any;
}

const CATEGORY_COLORS: Record<string, string> = {
  fact: "bg-accent-blue",
  decision: "bg-accent-purple",
  conversation: "bg-brand",
  task: "bg-accent-amber",
  lesson: "bg-accent-green",
  preference: "bg-pink-500",
  procedure: "bg-cyan-500",
  signal: "bg-accent-red",
  identity: "bg-white",
};

export default function StatsPanel({ stats }: Props) {
  const categories = stats.closets?.byCategory ?? {};
  const total = stats.closets?.visible ?? 1;

  return (
    <section className="mb-16 animate-fade-in" style={{ animationDelay: "0.5s" }}>
      <h2 className="text-xl font-bold mb-6">Memory Distribution</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Category breakdown */}
        <div className="bg-bg-card rounded-[20px] border border-border p-6">
          <h3 className="text-sm font-semibold text-text-secondary mb-4 uppercase tracking-wider">
            By Category
          </h3>
          {Object.keys(categories).length === 0 ? (
            <p className="text-text-tertiary text-sm">No memories yet. Ingest data to see distribution.</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(categories)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([cat, count]) => (
                  <div key={cat}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="capitalize">{cat}</span>
                      <span className="text-text-secondary">{count as number}</span>
                    </div>
                    <div className="h-1.5 bg-bg-elevated rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${CATEGORY_COLORS[cat] ?? "bg-text-tertiary"}`}
                        style={{ width: `${Math.max(2, ((count as number) / total) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Pipeline health */}
        <div className="bg-bg-card rounded-[20px] border border-border p-6">
          <h3 className="text-sm font-semibold text-text-secondary mb-4 uppercase tracking-wider">
            Pipeline Status
          </h3>
          <div className="space-y-4">
            {[
              {
                label: "Quarantine",
                value: stats.closets?.needsReview ?? 0,
                color: stats.closets?.needsReview > 0 ? "text-accent-amber" : "text-accent-green",
                icon: stats.closets?.needsReview > 0 ? "!" : "ok",
              },
              {
                label: "Decayed",
                value: stats.closets?.decayed ?? 0,
                color: "text-text-secondary",
                icon: "-",
              },
              {
                label: "Retracted",
                value: stats.closets?.retracted ?? 0,
                color: stats.closets?.retracted > 0 ? "text-accent-red" : "text-text-secondary",
                icon: "x",
              },
              {
                label: "Total stored",
                value: stats.closets?.total ?? 0,
                color: "text-white",
                icon: "#",
              },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-md bg-bg-elevated flex items-center justify-center text-xs font-mono ${item.color}`}>
                    {item.icon}
                  </div>
                  <span className="text-sm">{item.label}</span>
                </div>
                <span className={`text-sm font-mono ${item.color}`}>{item.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
