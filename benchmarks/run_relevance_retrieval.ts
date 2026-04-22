// Relevance-Based Retrieval Benchmark.
//
// Unlike the exact-closet benchmark, this tests whether the system finds
// ANY relevant document — matching LongMemEval's methodology.
//
// For each query, multiple closets can be "relevant" if they're in the
// same wing/room or cover the same topic. A query about "Zoo Media" is
// relevant to ANY closet in the clients/zoo-media room.
//
// This produces metrics comparable to LongMemEval's R@5 = 96.6%.

import { ConvexHttpClient } from "convex/browser";
import { writeFileSync } from "node:fs";
import { api } from "../convex/_generated/api.js";
import { computeBenchmark, type QueryResult } from "./harness/metrics.js";

const SITE_URL = process.env.CONVEX_SITE_URL ?? "https://small-dogfish-433.convex.site";
const CONVEX_URL = process.env.CONVEX_URL ?? "https://small-dogfish-433.convex.cloud";
const PALACE_ID = process.env.PALACE_ID ?? "k17cmbrx46zmqv0xtcjbnr3j9h85286s";

const client = new ConvexHttpClient(CONVEX_URL);

// ─── Test queries with known relevant rooms ─────────────────────

interface RelevanceQuery {
  id: string;
  query: string;
  relevantRooms: string[];   // any closet in these rooms counts as relevant
  relevantWings: string[];   // wing-level relevance
  category: string;          // query type
  difficulty: "easy" | "medium" | "hard";
}

const QUERIES: RelevanceQuery[] = [
  // === EASY: Direct entity/topic queries ===
  { id: "e01", query: "What is NeuralEDGE?", relevantRooms: ["org"], relevantWings: ["team"], category: "entity", difficulty: "easy" },
  { id: "e02", query: "Who is Rahul?", relevantRooms: ["org"], relevantWings: ["team"], category: "entity", difficulty: "easy" },
  { id: "e03", query: "Who is Mansi?", relevantRooms: ["org"], relevantWings: ["team"], category: "entity", difficulty: "easy" },
  { id: "e04", query: "Who is Yatharth?", relevantRooms: ["org"], relevantWings: ["team"], category: "entity", difficulty: "easy" },
  { id: "e05", query: "Zoo Media client details", relevantRooms: ["zoo-media"], relevantWings: ["clients"], category: "entity", difficulty: "easy" },
  { id: "e06", query: "What NEops does NeuralEDGE have?", relevantRooms: ["neop-catalog"], relevantWings: ["platform"], category: "entity", difficulty: "easy" },
  { id: "e07", query: "ICD NEop for Zoo Media", relevantRooms: ["zoo-media", "neop-catalog"], relevantWings: ["clients", "platform"], category: "entity", difficulty: "easy" },
  { id: "e08", query: "NEOS platform architecture", relevantRooms: ["architecture"], relevantWings: ["platform"], category: "entity", difficulty: "easy" },
  { id: "e09", query: "OpenClaw runtime", relevantRooms: ["neop-catalog"], relevantWings: ["platform"], category: "entity", difficulty: "easy" },
  { id: "e10", query: "NeP marketplace", relevantRooms: ["neps", "economics"], relevantWings: ["marketplace"], category: "entity", difficulty: "easy" },

  // === MEDIUM: Specific fact queries ===
  { id: "m01", query: "What tech stack does NEOS use?", relevantRooms: ["tools", "architecture"], relevantWings: ["rd", "platform"], category: "fact", difficulty: "medium" },
  { id: "m02", query: "Zoo Media pricing retainer", relevantRooms: ["zoo-media", "org"], relevantWings: ["clients", "team"], category: "fact", difficulty: "medium" },
  { id: "m03", query: "Convex vs Supabase", relevantRooms: ["tools"], relevantWings: ["rd"], category: "decision", difficulty: "medium" },
  { id: "m04", query: "ICP ideal customer profile", relevantRooms: ["icp"], relevantWings: ["gtm"], category: "fact", difficulty: "medium" },
  { id: "m05", query: "cold email outreach strategy", relevantRooms: ["outreach"], relevantWings: ["gtm"], category: "procedure", difficulty: "medium" },
  { id: "m06", query: "NDA MSA SOW legal templates", relevantRooms: ["contracts"], relevantWings: ["legal"], category: "fact", difficulty: "medium" },
  { id: "m07", query: "build3 fundraising details", relevantRooms: ["entities"], relevantWings: ["legal"], category: "fact", difficulty: "medium" },
  { id: "m08", query: "Context Vault memory system", relevantRooms: ["memory-systems"], relevantWings: ["rd"], category: "fact", difficulty: "medium" },
  { id: "m09", query: "GTM go to market strategy", relevantRooms: ["positioning", "icp", "outreach"], relevantWings: ["gtm"], category: "fact", difficulty: "medium" },
  { id: "m10", query: "Aria SDR agent capabilities", relevantRooms: ["neop-catalog"], relevantWings: ["platform"], category: "entity", difficulty: "medium" },
  { id: "m11", query: "Emma WhatsApp shopping agent", relevantRooms: ["features", "neop-catalog"], relevantWings: ["platform"], category: "entity", difficulty: "medium" },
  { id: "m12", query: "Axe content engine", relevantRooms: ["features"], relevantWings: ["platform"], category: "entity", difficulty: "medium" },
  { id: "m13", query: "AWS EC2 infrastructure", relevantRooms: ["tools"], relevantWings: ["rd"], category: "fact", difficulty: "medium" },
  { id: "m14", query: "Synlex Technologies company", relevantRooms: ["org", "entities"], relevantWings: ["team", "legal"], category: "entity", difficulty: "medium" },
  { id: "m15", query: "brand colors design system", relevantRooms: ["zoo-media", "entities"], relevantWings: ["clients", "legal"], category: "fact", difficulty: "medium" },

  // === HARD: Cross-wing reasoning, abstract queries ===
  { id: "h01", query: "How does NeuralEDGE make money?", relevantRooms: ["org"], relevantWings: ["team"], category: "reasoning", difficulty: "hard" },
  { id: "h02", query: "What problems does NEOS solve for clients?", relevantRooms: ["architecture", "zoo-media", "org"], relevantWings: ["platform", "clients", "team"], category: "reasoning", difficulty: "hard" },
  { id: "h03", query: "How are NEops connected to the marketplace?", relevantRooms: ["neop-catalog", "neps", "economics"], relevantWings: ["platform", "marketplace"], category: "reasoning", difficulty: "hard" },
  { id: "h04", query: "What was rejected and why?", relevantRooms: ["tools"], relevantWings: ["rd"], category: "reasoning", difficulty: "hard" },
  { id: "h05", query: "How does the team communicate?", relevantRooms: ["org"], relevantWings: ["team"], category: "fact", difficulty: "hard" },
  { id: "h06", query: "What is the pitch strategy for agencies?", relevantRooms: ["positioning", "outreach", "pitch"], relevantWings: ["gtm"], category: "procedure", difficulty: "hard" },
  { id: "h07", query: "NEXUS and ALTE B2B intelligence", relevantRooms: ["features"], relevantWings: ["platform"], category: "entity", difficulty: "hard" },
  { id: "h08", query: "How does memory work in NEOS?", relevantRooms: ["memory-systems"], relevantWings: ["rd"], category: "fact", difficulty: "hard" },
  { id: "h09", query: "What are the deployment options?", relevantRooms: ["architecture", "tools"], relevantWings: ["platform", "rd"], category: "fact", difficulty: "hard" },
  { id: "h10", query: "Explain the deal flow from lead to contract", relevantRooms: ["positioning", "outreach", "contracts", "pipeline"], relevantWings: ["gtm", "legal"], category: "reasoning", difficulty: "hard" },

  // === UNANSWERABLE: should return low confidence ===
  { id: "u01", query: "What is the weather in Delhi today?", relevantRooms: [], relevantWings: [], category: "unanswerable", difficulty: "hard" },
  { id: "u02", query: "How to install Python on Windows?", relevantRooms: [], relevantWings: [], category: "unanswerable", difficulty: "hard" },
  { id: "u03", query: "What is Spotify's revenue model?", relevantRooms: [], relevantWings: [], category: "unanswerable", difficulty: "hard" },
  { id: "u04", query: "Recipe for butter chicken", relevantRooms: [], relevantWings: [], category: "unanswerable", difficulty: "hard" },
  { id: "u05", query: "Explain quantum computing basics", relevantRooms: [], relevantWings: [], category: "unanswerable", difficulty: "hard" },
];

// ─── Search ─────────────────────────────────────────────────────

async function searchPalace(query: string): Promise<{
  results: Array<{ closetId: string; score: number; wingName: string; roomName: string }>;
  confidence: string;
  queryTimeMs: number;
}> {
  const t0 = Date.now();
  try {
    const resp = await fetch(`${SITE_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "palace_search",
        params: { query, palaceId: PALACE_ID, limit: 10, similarityFloor: 0.1 },
        neopId: "_admin", palaceId: PALACE_ID,
      }),
    });
    const data = await resp.json();
    return {
      results: data.data?.results ?? [],
      confidence: data.data?.confidence ?? "low",
      queryTimeMs: Date.now() - t0,
    };
  } catch {
    return { results: [], confidence: "error", queryTimeMs: Date.now() - t0 };
  }
}

// ─── Build closet → room mapping ────────────────────────────────

async function buildRoomIndex(): Promise<Map<string, Set<string>>> {
  const roomToClosets = new Map<string, Set<string>>();
  const wings = await client.query(api.palace.queries.listWings, { palaceId: PALACE_ID as any });

  for (const wing of wings) {
    const rooms = await client.query(api.palace.queries.listRoomsByWing, { wingId: wing._id });
    for (const room of rooms) {
      const closets = await client.query(api.palace.queries.listClosets, { roomId: room._id });
      const ids = new Set(closets.filter((c: any) => !c.retracted && !c.decayed && !c.supersededBy).map((c: any) => c._id));
      roomToClosets.set(room.name, ids);
    }
  }

  return roomToClosets;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log("Relevance-Based Retrieval Benchmark");
  console.log("====================================\n");

  const roomIndex = await buildRoomIndex();
  let totalClosets = 0;
  for (const ids of roomIndex.values()) totalClosets += ids.size;
  console.log(`Corpus: ${totalClosets} closets across ${roomIndex.size} rooms\n`);

  const queryResults: QueryResult[] = [];
  const categoryResults: Record<string, { total: number; r1: number; r5: number }> = {};
  const difficultyResults: Record<string, { total: number; r1: number; r5: number }> = {};
  let unanswerableCorrect = 0;
  let unanswerableTotal = 0;

  for (const q of QUERIES) {
    // Build relevant set from rooms.
    const relevantIds = new Set<string>();
    for (const roomName of q.relevantRooms) {
      const ids = roomIndex.get(roomName);
      if (ids) for (const id of ids) relevantIds.add(id);
    }

    const { results, confidence, queryTimeMs } = await searchPalace(q.query);
    const retrievedIds = results.map(r => r.closetId);

    // For unanswerable queries: check if confidence is low.
    if (q.category === "unanswerable") {
      unanswerableTotal++;
      const topScore = results[0]?.score ?? 0;
      if (confidence === "low" || topScore < 0.4) {
        unanswerableCorrect++;
      }
      // Skip retrieval metrics for unanswerable.
      const retrievedRooms = results.map(r => r.roomName);
      console.log(`  [${q.difficulty}] ${q.id}: "${q.query.slice(0, 40)}" → conf=${confidence} top=${topScore.toFixed(2)} ${confidence === "low" || topScore < 0.4 ? "✓ CORRECT" : "✗ FALSE POSITIVE"}`);
      continue;
    }

    queryResults.push({
      queryId: q.id,
      query: q.query,
      retrievedIds,
      relevantIds,
      scores: results.map(r => r.score),
      latencyMs: queryTimeMs,
    });

    // Track by category and difficulty.
    const r1 = retrievedIds.length > 0 && relevantIds.has(retrievedIds[0]!) ? 1 : 0;
    const r5 = retrievedIds.slice(0, 5).some(id => relevantIds.has(id)) ? 1 : 0;

    if (!categoryResults[q.category]) categoryResults[q.category] = { total: 0, r1: 0, r5: 0 };
    categoryResults[q.category]!.total++; categoryResults[q.category]!.r1 += r1; categoryResults[q.category]!.r5 += r5;

    if (!difficultyResults[q.difficulty]) difficultyResults[q.difficulty] = { total: 0, r1: 0, r5: 0 };
    difficultyResults[q.difficulty]!.total++; difficultyResults[q.difficulty]!.r1 += r1; difficultyResults[q.difficulty]!.r5 += r5;

    const topRoom = results[0]?.roomName ?? "none";
    const hit = r5 ? "✓" : "✗";
    console.log(`  [${q.difficulty}] ${q.id}: "${q.query.slice(0, 45)}" → ${hit} top=${topRoom} score=${(results[0]?.score ?? 0).toFixed(3)}`);
  }

  // Compute aggregate metrics.
  const benchmark = computeBenchmark("PALACE Relevance Retrieval", queryResults, totalClosets);

  // Print results.
  console.log("\n==========================================");
  console.log("  RELEVANCE RETRIEVAL RESULTS");
  console.log("==========================================\n");

  console.log(`Corpus: ${totalClosets} closets | Queries: ${QUERIES.length} (${QUERIES.length - unanswerableTotal} answerable, ${unanswerableTotal} unanswerable)\n`);

  console.log("Overall (answerable queries):");
  console.log(`  R@1:      ${(benchmark.metrics["R@1"] * 100).toFixed(1)}%`);
  console.log(`  R@5:      ${(benchmark.metrics["R@5"] * 100).toFixed(1)}%`);
  console.log(`  R@10:     ${(benchmark.metrics["R@10"] * 100).toFixed(1)}%`);
  console.log(`  MRR@10:   ${(benchmark.metrics["MRR@10"] * 100).toFixed(1)}%`);
  console.log(`  nDCG@10:  ${(benchmark.metrics["nDCG@10"] * 100).toFixed(1)}%`);

  console.log("\nBy difficulty:");
  for (const [diff, stats] of Object.entries(difficultyResults)) {
    console.log(`  ${diff.padEnd(8)} R@1=${(stats.r1/stats.total*100).toFixed(0)}%  R@5=${(stats.r5/stats.total*100).toFixed(0)}%  (${stats.total} queries)`);
  }

  console.log("\nBy category:");
  for (const [cat, stats] of Object.entries(categoryResults)) {
    console.log(`  ${cat.padEnd(12)} R@1=${(stats.r1/stats.total*100).toFixed(0)}%  R@5=${(stats.r5/stats.total*100).toFixed(0)}%  (${stats.total} queries)`);
  }

  console.log(`\nUnanswerable detection: ${unanswerableCorrect}/${unanswerableTotal} (${(unanswerableCorrect/unanswerableTotal*100).toFixed(0)}%)`);

  console.log(`\nLatency:`);
  console.log(`  Avg:    ${benchmark.metrics.avgLatencyMs}ms`);
  console.log(`  Median: ${benchmark.metrics.medianLatencyMs}ms`);
  console.log(`  p95:    ${benchmark.metrics.p95LatencyMs}ms`);

  // Save full results.
  const fullResult = {
    ...benchmark,
    byDifficulty: difficultyResults,
    byCategory: categoryResults,
    unanswerable: { correct: unanswerableCorrect, total: unanswerableTotal, accuracy: +(unanswerableCorrect/unanswerableTotal).toFixed(4) },
  };
  writeFileSync("benchmarks/results/results_relevance_retrieval.json", JSON.stringify(fullResult, null, 2));
  console.log("\nSaved to benchmarks/results/results_relevance_retrieval.json");

  // ─── Regression budgets ─────────────────────────────────────────
  //
  // Any floor breach prints a red BUDGET FAIL and exits non-zero so CI
  // gates on quality. Set via env to allow progressive tightening without
  // editing code — the defaults are intentionally conservative.
  const budgets = {
    mediumR5: Number(process.env.BUDGET_MEDIUM_R5 ?? 0.85),
    hardR5:   Number(process.env.BUDGET_HARD_R5   ?? 0.60),
    unans:    Number(process.env.BUDGET_UNANS     ?? 1.00),
    p95Ms:    Number(process.env.BUDGET_P95_MS    ?? 2000),
  };
  const med = difficultyResults["medium"] ?? { total: 0, r1: 0, r5: 0 };
  const hard = difficultyResults["hard"] ?? { total: 0, r1: 0, r5: 0 };
  const mediumR5 = med.total ? med.r5 / med.total : 0;
  const hardR5 = hard.total ? hard.r5 / hard.total : 0;
  const unansRate = unanswerableTotal ? unanswerableCorrect / unanswerableTotal : 1;
  const p95 = benchmark.metrics.p95LatencyMs;

  console.log("\n─── Regression budgets ───");
  const rows = [
    { name: "medium R@5",    value: mediumR5, budget: budgets.mediumR5, fmt: (v: number) => `${(v * 100).toFixed(0)}%` },
    { name: "hard R@5",      value: hardR5,   budget: budgets.hardR5,   fmt: (v: number) => `${(v * 100).toFixed(0)}%` },
    { name: "unanswerable",  value: unansRate, budget: budgets.unans,    fmt: (v: number) => `${(v * 100).toFixed(0)}%` },
    { name: "p95 latency",   value: p95,      budget: budgets.p95Ms,    fmt: (v: number) => `${v}ms`,  lowerIsBetter: true },
  ];
  let anyFail = false;
  for (const r of rows) {
    const fail = r.lowerIsBetter ? r.value > r.budget : r.value < r.budget;
    const icon = fail ? "✗ FAIL" : "✓ ok  ";
    const op = r.lowerIsBetter ? "<=" : ">=";
    console.log(`  ${icon}  ${r.name.padEnd(16)} ${r.fmt(r.value).padStart(6)}  (budget ${op} ${r.fmt(r.budget)})`);
    if (fail) anyFail = true;
  }

  if (anyFail) {
    console.error("\nBUDGET FAIL — retrieval quality below threshold. See above.");
    process.exit(2);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
