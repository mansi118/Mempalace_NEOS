interface Props {
  palace: any;
  stats: any;
  onSearch: () => void;
  onBrowse: () => void;
}

export default function Hero({ palace, stats, onSearch, onBrowse }: Props) {
  const statItems = [
    { label: "WINGS", value: stats?.wings ?? 0 },
    { label: "MEMORIES", value: stats?.closets?.visible ?? 0 },
    { label: "FACTS", value: stats?.drawers?.valid ?? 0 },
    { label: "TUNNELS", value: stats?.tunnels ?? 0 },
  ];

  return (
    <section style={{ position: "relative", paddingTop: 64, overflow: "hidden" }}>
      {/* Gradient blobs */}
      <div style={{ position: "absolute", inset: 0, background: "#000", pointerEvents: "none" }}>
        <div
          style={{
            position: "absolute",
            top: -100,
            right: -100,
            width: 700,
            height: 700,
            background: "radial-gradient(circle, rgba(0,212,170,0.08) 0%, transparent 70%)",
            borderRadius: "50%",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: -200,
            left: -100,
            width: 600,
            height: 600,
            background: "radial-gradient(circle, rgba(168,85,247,0.06) 0%, transparent 70%)",
            borderRadius: "50%",
          }}
        />
      </div>

      <div
        style={{
          position: "relative",
          maxWidth: 1280,
          margin: "0 auto",
          padding: "64px 20px 56px",
          textAlign: "center",
        }}
      >
        {/* Badge */}
        <div
          className="anim-in"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 16px",
            borderRadius: 999,
            background: "#111",
            border: "1px solid #222",
            fontSize: 13,
            color: "#888",
            marginBottom: 28,
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#00D4AA",
              boxShadow: "0 0 10px rgba(0,212,170,0.6)",
            }}
          />
          Context Vault — Live
        </div>

        {/* Heading */}
        <h1
          className="anim-in"
          style={{
            fontSize: "clamp(1.8rem, 5vw, 4rem)",
            fontWeight: 800,
            lineHeight: 1.08,
            letterSpacing: "-0.03em",
            marginBottom: 20,
            animationDelay: "0.1s",
          }}
        >
          Your palace of
          <br />
          <span
            style={{
              background: "linear-gradient(90deg, #00D4AA, #4A9EFF, #A855F7)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            institutional memory
          </span>
        </h1>

        {/* Sub */}
        <p
          className="anim-in"
          style={{
            color: "#888",
            fontSize: "clamp(14px, 2vw, 17px)",
            maxWidth: 560,
            margin: "0 auto 40px",
            lineHeight: 1.6,
            animationDelay: "0.2s",
            padding: "0 8px",
          }}
        >
          {palace?.l0_briefing ||
            "Search, store, and traverse your team's knowledge across wings, rooms, and closets."}
        </p>

        {/* CTAs */}
        <div
          className="anim-in"
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 10,
            marginBottom: 52,
            animationDelay: "0.3s",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={onSearch}
            style={{
              padding: "12px 28px",
              borderRadius: 10,
              background: "#fff",
              color: "#000",
              border: "none",
              fontWeight: 600,
              fontSize: 14,
              cursor: "pointer",
              transition: "transform 0.12s, opacity 0.12s",
            }}
            onMouseOver={(e) => (e.currentTarget.style.opacity = "0.9")}
            onMouseOut={(e) => (e.currentTarget.style.opacity = "1")}
          >
            Search Memories
          </button>
          <button
            onClick={onBrowse}
            style={{
              padding: "12px 28px",
              borderRadius: 10,
              background: "transparent",
              color: "#fff",
              border: "1px solid #333",
              fontWeight: 500,
              fontSize: 14,
              cursor: "pointer",
              transition: "border-color 0.12s, background 0.12s",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.borderColor = "#555";
              e.currentTarget.style.background = "#111";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.borderColor = "#333";
              e.currentTarget.style.background = "transparent";
            }}
          >
            Browse Palace
          </button>
        </div>

        {/* Stats row */}
        <div
          className="anim-in"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(100px, max-content))",
            justifyContent: "center",
            gap: "32px 48px",
            animationDelay: "0.4s",
          }}
        >
          {statItems.map((s) => (
            <div key={s.label} style={{ textAlign: "center" }}>
              <div style={{ fontSize: "clamp(20px, 3vw, 28px)", fontWeight: 700 }}>{s.value}</div>
              <div
                style={{
                  fontSize: 11,
                  color: "#666",
                  letterSpacing: "0.08em",
                  marginTop: 4,
                }}
              >
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
