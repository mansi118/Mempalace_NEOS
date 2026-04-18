// Keyword-based routing — FALLBACK when Gemini extraction fails.
//
// Primary routing is done by Gemini (extract.ts) which sees the full
// palace structure and picks (wing, room, category) in one call.
// This module is the safety net: if Gemini returns an error, we still
// route the exchange to the best-guess wing/room/category via keywords.

// ─── Wing routing ───────────────────────────────────────────────

const WING_KEYWORDS: Record<string, string[]> = {
  platform: [
    "convex", "neos platform", "context vault", "cortex", "neop", "nep ",
    "openclaw", "graphiti", "falkordb", "soul.md", "skill.md", "mempalace",
    "tanstack", "fastapi", "architecture", "schema", "frontend",
  ],
  clients: [
    "zoo media", "akhilesh", "icd ", "image content director",
    "unborred", "client engagement", "deliverables",
  ],
  gtm: [
    "icp", "go to market", "gtm", "recon sdr", "sales pipeline",
    "outreach", "cold email", "pitch deck", "retainer",
    "lead generation", "conversion", "prospect",
  ],
  team: [
    "rahul", "mansi", "shivam", "naveen", "ankit",
    "teampulse", "standup", "hiring", "org chart",
  ],
  legal: [
    "nda", "sow", "msa", "invoice", "synlex",
    "intelligence ventures", "compliance", "patent",
  ],
  rd: [
    "research", "quantization", "turboquant", "a-mem",
    "strands sdk", "agentcore", "letta", "memoria", "mem0",
    "langchain", "crewai", "langgraph", "experiment",
  ],
  marketplace: [
    "nep marketplace", "nep pricing", "self-improvement protocol",
    "enhancement pack", "marketplace economics",
  ],
  infra: [
    "ec2", "docker", "nginx", "ssl", "deploy", "matrix.neuraledge",
    "ubuntu", "linux", "ssh", "systemctl", "aws ",
  ],
  partners: [
    "fireflies", "anthropic", "voyageai", "google ai",
    "apify", "firecrawl", "vendor",
  ],
  brand: [
    "brand voice", "deck", "pptx", "landing page",
    "logo", "design system", "#132f48", "teal", "case study",
  ],
};

export function routeToWing(text: string): string {
  const lower = text.toLowerCase();
  let bestWing = "_quarantine";
  let bestScore = 0;

  for (const [wing, keywords] of Object.entries(WING_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestWing = wing;
    }
  }

  return bestWing;
}

// ─── Room routing ───────────────────────────────────────────────

const ROOM_KEYWORDS: Record<string, Record<string, string[]>> = {
  platform: {
    stack: ["convex", "supabase", "tanstack", "fastapi", "voyage", "gemini", "database"],
    architecture: ["cortex", "topology", "multi-agent", "system design", "layer"],
    "neop-catalog": ["neop", "aria", "forge", "scout", "recon", "emma", "icd"],
    "api-contracts": ["api", "webhook", "endpoint", "rest ", "grpc"],
    features: ["feature", "wip", "roadmap", "backlog"],
    retired: ["killed", "deprecated", "removed", "sunset"],
    pricing: ["pricing", "tier ", "package", "cost model"],
  },
  clients: {
    "zoo-media": ["zoo media", "akhilesh", "icd"],
    "unborred-club": ["unborred"],
    _shared: ["cross-client", "client pattern"],
  },
  team: {
    rahul: ["rahul"],
    mansi: ["mansi"],
    shivam: ["shivam"],
    naveen: ["naveen"],
    ankit: ["ankit"],
    org: ["org chart", "hiring", "roles", "team structure"],
  },
};

export function routeToRoom(text: string, wing: string): string {
  const lower = text.toLowerCase();
  const rooms = ROOM_KEYWORDS[wing];
  if (!rooms) return "unclassified";

  let bestRoom = Object.keys(rooms)[0] ?? "unclassified";
  let bestScore = 0;

  for (const [room, keywords] of Object.entries(rooms)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRoom = room;
    }
  }

  return bestRoom;
}

// ─── Category classification ────────────────────────────────────

const CATEGORY_SIGNALS: Record<string, string[]> = {
  decision: ["decided", "chose", "picked", "went with", "rejected", "approved", "selected"],
  task: ["todo", "need to", "action item", "should do", "will do", "must", "implement"],
  lesson: ["learned", "mistake", "worked well", "next time", "takeaway", "retrospective"],
  preference: ["prefer", "like to", "want to", "style", "convention"],
  procedure: ["steps to", "how to", "process", "runbook", "sop", "guide"],
  signal: ["alert", "warning", "incident", "down", "outage", "urgent"],
  goal: ["goal", "okr", "target", "aim to", "by q4", "by end of"],
  question: ["question", "wondering", "unsure", "should we", "what if"],
};

export function classifyCategory(text: string): string {
  const lower = text.toLowerCase();
  let bestCat = "fact";
  let bestScore = 0;

  for (const [cat, signals] of Object.entries(CATEGORY_SIGNALS)) {
    let score = 0;
    for (const sig of signals) {
      if (lower.includes(sig)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCat = cat;
    }
  }

  return bestCat;
}

// ─── Confidence scoring ─────────────────────────────────────────

export function scoreConfidence(humanText: string, assistantText: string): number {
  let confidence = 0.6; // base for claude_chat source

  const combined = (humanText + " " + assistantText).toLowerCase();

  // Boost for specificity signals.
  if (/\d+/.test(combined)) confidence += 0.05;       // has numbers
  if (/@/.test(combined)) confidence += 0.05;          // has email-like
  if (/₹|inr|lakh|crore/i.test(combined)) confidence += 0.05; // has INR amounts
  if (assistantText.length > 500) confidence += 0.1;   // detailed response

  // Penalty for speculation signals.
  if (/\b(maybe|might|could|perhaps|possibly)\b/i.test(combined)) confidence -= 0.15;
  if (/\b(not sure|uncertain|i think)\b/i.test(combined)) confidence -= 0.1;

  return Math.max(0.1, Math.min(1.0, confidence));
}
