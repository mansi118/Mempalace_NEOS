// PALACE Retrieval Benchmark — tests search quality on its own corpus.
//
// Generates gold queries from closet titles/content where the correct
// closet ID is known. Measures R@1, R@5, R@10, nDCG@10, MRR, latency.
//
// This is the most valuable benchmark because it tests the FULL pipeline:
// query → Qwen embedding → Convex vector search → post-filter → enrich → rank
//
// Usage:
//   CONVEX_URL=https://small-dogfish-433.convex.cloud npx tsx benchmarks/run_palace_retrieval.ts

import { ConvexHttpClient } from "convex/browser";
import { writeFileSync } from "node:fs";
import { api } from "../convex/_generated/api.js";
import { computeBenchmark, type QueryResult } from "./harness/metrics.js";

const SITE_URL = process.env.CONVEX_SITE_URL ?? "https://small-dogfish-433.convex.site";
const CONVEX_URL = process.env.CONVEX_URL ?? "https://small-dogfish-433.convex.cloud";
const PALACE_ID = process.env.PALACE_ID ?? "k17cmbrx46zmqv0xtcjbnr3j9h85286s";

const client = new ConvexHttpClient(CONVEX_URL);

// ─── Gold query generation ──────────────────────────────────────
//
// Strategy: for each closet with a title, create a natural query
// that should retrieve that closet. The gold answer is the closet ID.

interface GoldQuery {
  id: string;
  query: string;
  goldClosetIds: string[];
  wing: string;
  room: string;
  category: string;
}

function generateQueries(closets: any[]): GoldQuery[] {
  const queries: GoldQuery[] = [];

  for (const c of closets) {
    if (!c.title || c.title.length < 5) continue;
    if (c.retracted || c.decayed) continue;
    if (c.supersededBy) continue;

    // Strategy 1: "What is [title]?" for fact closets
    if (c.category === "fact" || c.category === "identity") {
      queries.push({
        id: `q_${queries.length}`,
        query: `What is ${c.title}?`,
        goldClosetIds: [c._id],
        wing: c.wingName ?? "",
        room: c.roomName ?? "",
        category: c.category,
      });
    }

    // Strategy 2: "Tell me about [title]" for all closets
    queries.push({
      id: `q_${queries.length}`,
      query: c.title,
      goldClosetIds: [c._id],
      wing: c.wingName ?? "",
      room: c.roomName ?? "",
      category: c.category,
    });

    // Strategy 3: Extract a key phrase from content
    const firstSentence = c.content.split(/[.\n]/)[0]?.trim();
    if (firstSentence && firstSentence.length > 20 && firstSentence.length < 200) {
      queries.push({
        id: `q_${queries.length}`,
        query: firstSentence,
        goldClosetIds: [c._id],
        wing: c.wingName ?? "",
        room: c.roomName ?? "",
        category: c.category,
      });
    }
  }

  return queries;
}

// ─── Search via MCP endpoint ────────────────────────────────────

async function searchPalace(query: string, limit: number = 10): Promise<{
  results: Array<{ closetId: string; score: number; wingName: string; roomName: string }>;
  queryTimeMs: number;
}> {
  const t0 = Date.now();
  try {
    const resp = await fetch(`${SITE_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool: "palace_search",
        params: { query, palaceId: PALACE_ID, limit, similarityFloor: 0.1 },
        neopId: "_admin",
        palaceId: PALACE_ID,
      }),
    });
    const data = await resp.json();
    const queryTimeMs = Date.now() - t0;
    const results = (data.data?.results ?? []).map((r: any) => ({
      closetId: r.closetId,
      score: r.score,
      wingName: r.wingName,
      roomName: r.roomName,
    }));
    return { results, queryTimeMs };
  } catch {
    return { results: [], queryTimeMs: Date.now() - t0 };
  }
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  console.log("PALACE Retrieval Benchmark");
  console.log("=========================\n");

  // 1. Get all closets with enrichment data.
  console.log("Loading corpus...");
  const wings = await client.query(api.palace.queries.listWings, { palaceId: PALACE_ID as any });

  const allClosets: any[] = [];
  for (const wing of wings) {
    const rooms = await client.query(api.palace.queries.listRoomsByWing, { wingId: wing._id });
    for (const room of rooms) {
      const closets = await client.query(api.palace.queries.listClosets, {
        roomId: room._id,
        includeDecayed: false,
        includeRetracted: false,
      });
      for (const c of closets) {
        allClosets.push({ ...c, wingName: wing.name, roomName: room.name });
      }
    }
  }

  console.log(`Corpus: ${allClosets.length} closets across ${wings.length} wings\n`);

  // 2. Generate gold queries.
  const goldQueries = generateQueries(allClosets);
  // Sample to keep benchmark runtime reasonable.
  const sample = goldQueries.sort(() => Math.random() - 0.5).slice(0, 200);
  console.log(`Queries: ${goldQueries.length} total, sampling ${sample.length}\n`);

  // 3. Run queries.
  console.log("Running queries...");
  const queryResults: QueryResult[] = [];
  let completed = 0;

  for (const gq of sample) {
    const { results, queryTimeMs } = await searchPalace(gq.query);
    const retrievedIds = results.map(r => r.closetId);

    queryResults.push({
      queryId: gq.id,
      query: gq.query,
      retrievedIds,
      relevantIds: new Set(gq.goldClosetIds),
      scores: results.map(r => r.score),
      latencyMs: queryTimeMs,
    });

    completed++;
    if (completed % 20 === 0) {
      console.log(`  ${completed}/${sample.length} queries completed`);
    }
  }

  // 4. Compute metrics.
  const benchmark = computeBenchmark(
    "PALACE Retrieval (self-corpus)",
    queryResults,
    allClosets.length,
  );

  // 5. Print results.
  console.log("\n=== RESULTS ===\n");
  console.log(`Corpus size: ${benchmark.corpusSize}`);
  console.log(`Queries: ${benchmark.queryCount}`);
  console.log("");
  console.log(`  R@1:      ${(benchmark.metrics["R@1"] * 100).toFixed(1)}%`);
  console.log(`  R@5:      ${(benchmark.metrics["R@5"] * 100).toFixed(1)}%`);
  console.log(`  R@10:     ${(benchmark.metrics["R@10"] * 100).toFixed(1)}%`);
  console.log(`  MRR@10:   ${(benchmark.metrics["MRR@10"] * 100).toFixed(1)}%`);
  console.log(`  nDCG@10:  ${(benchmark.metrics["nDCG@10"] * 100).toFixed(1)}%`);
  console.log(`  P@5:      ${(benchmark.metrics["P@5"] * 100).toFixed(1)}%`);
  console.log("");
  console.log(`  Avg latency:    ${benchmark.metrics.avgLatencyMs}ms`);
  console.log(`  Median latency: ${benchmark.metrics.medianLatencyMs}ms`);
  console.log(`  p95 latency:    ${benchmark.metrics.p95LatencyMs}ms`);

  // 6. Show failures (queries where R@1 = 0).
  const failures = benchmark.perQuery.filter(q => !q.correct);
  if (failures.length > 0) {
    console.log(`\n=== FAILURES (${failures.length}/${benchmark.queryCount} missed at R@1) ===\n`);
    for (const f of failures.slice(0, 10)) {
      console.log(`  Q: "${f.query.slice(0, 60)}"`);
      console.log(`     R@5=${(f["R@5"] * 100).toFixed(0)}% nDCG=${(f["nDCG@10"] * 100).toFixed(0)}% top=${f.topResult?.slice(0, 20) ?? "none"}`);
    }
  }

  // 7. Save results.
  const outPath = "benchmarks/results/results_palace_retrieval.json";
  writeFileSync(outPath, JSON.stringify(benchmark, null, 2));
  console.log(`\nResults saved to ${outPath}`);
}

main().catch(e => { console.error(e); process.exit(1); });
