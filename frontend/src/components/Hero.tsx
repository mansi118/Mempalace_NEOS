interface Props {
  palace: any;
  stats: any;
  onSearch: () => void;
}

export default function Hero({ palace, stats, onSearch }: Props) {
  return (
    <section className="relative pt-[70px] overflow-hidden">
      {/* Background gradient art */}
      <div className="absolute inset-0 bg-bg-primary">
        <div className="absolute top-0 right-0 w-[800px] h-[800px] bg-gradient-to-bl from-brand/10 via-transparent to-transparent rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-0 w-[600px] h-[600px] bg-gradient-to-tr from-accent-purple/8 via-transparent to-transparent rounded-full blur-[100px]" />
        <div className="absolute top-1/3 left-1/2 w-[400px] h-[400px] bg-gradient-to-b from-accent-blue/5 to-transparent rounded-full blur-[80px]" />
      </div>

      <div className="relative max-w-[1280px] mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-bg-card border border-border text-sm text-text-secondary mb-8 animate-fade-in">
          <span className="w-2 h-2 rounded-full bg-brand animate-pulse" />
          Context Vault
        </div>

        <h1
          className="text-[clamp(2.5rem,6vw,5rem)] font-extrabold leading-[1.05] tracking-tight mb-6 animate-fade-in"
          style={{ animationDelay: "0.1s" }}
        >
          Your palace of
          <br />
          <span className="bg-gradient-to-r from-brand via-accent-blue to-accent-purple bg-clip-text text-transparent">
            institutional memory
          </span>
        </h1>

        <p
          className="text-text-secondary text-lg max-w-2xl mx-auto mb-10 leading-relaxed animate-fade-in"
          style={{ animationDelay: "0.2s" }}
        >
          {palace?.l0_briefing || "A structured memory system for NEops. Search, store, and traverse your team's knowledge across wings, rooms, and closets."}
        </p>

        <div
          className="flex flex-wrap justify-center gap-4 mb-16 animate-fade-in"
          style={{ animationDelay: "0.3s" }}
        >
          <button
            onClick={onSearch}
            className="px-6 py-3 rounded-[10px] bg-white text-black font-semibold text-sm hover:bg-gray-100 transition-colors cursor-pointer"
          >
            Search Memories
          </button>
          <button className="px-6 py-3 rounded-[10px] bg-transparent border border-border-subtle text-white font-medium text-sm hover:bg-bg-card transition-colors cursor-pointer">
            Browse Palace
          </button>
        </div>

        {/* Stats bar */}
        {stats && (
          <div
            className="flex flex-wrap justify-center gap-8 animate-fade-in"
            style={{ animationDelay: "0.4s" }}
          >
            {[
              { label: "Wings", value: stats.wings },
              { label: "Memories", value: stats.closets?.visible ?? 0 },
              { label: "Facts", value: stats.drawers?.valid ?? 0 },
              { label: "Tunnels", value: stats.tunnels },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-2xl font-bold text-white">{s.value}</div>
                <div className="text-xs text-text-tertiary uppercase tracking-wider mt-1">
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
