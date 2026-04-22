// End-to-end smoke test — every Convex API the frontend calls.
//
// For each (page, function), call the API and assert minimum invariants
// (returns a value, expected shape, non-empty when palace has data, etc).
// Output is machine-readable JSON + human summary.

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { writeFileSync } from "node:fs";

const CONVEX_URL = process.env.CONVEX_URL ?? "https://small-dogfish-433.convex.cloud";
const SITE_URL = process.env.CONVEX_SITE_URL ?? "https://small-dogfish-433.convex.site";
const PROD_FRONTEND = process.env.PROD_FRONTEND ?? "https://dist-dbqy631f8-mansi5.vercel.app";

const client = new ConvexHttpClient(CONVEX_URL);

interface Check {
  page: string;
  name: string;
  pass: boolean;
  ms: number;
  detail?: string;
}

const checks: Check[] = [];

async function run<T>(page: string, name: string, fn: () => Promise<T>, validate: (v: T) => string | true): Promise<T | null> {
  const t0 = Date.now();
  try {
    const result = await fn();
    const ms = Date.now() - t0;
    const v = validate(result);
    if (v === true) {
      checks.push({ page, name, pass: true, ms });
    } else {
      checks.push({ page, name, pass: false, ms, detail: v });
    }
    return result;
  } catch (e: any) {
    checks.push({ page, name, pass: false, ms: Date.now() - t0, detail: e.message?.slice(0, 200) ?? "error" });
    return null;
  }
}

async function main() {
  console.log("PALACE E2E Smoke Test");
  console.log("=====================\n");

  // ─── HOME ─────────────────────────────────────────────────────
  const palaces = await run("/", "listPalaces", () => client.query(api.palace.queries.listPalaces, { onlyReady: true }), (v: any) => Array.isArray(v) && v.length > 0 ? true : "no palaces returned");
  if (!palaces || palaces.length === 0) { console.log("FATAL: no palaces"); process.exit(1); }
  const palace = palaces[0]!;
  const palaceId = palace._id as any;

  await run("/", "getStats", () => client.query(api.palace.queries.getStats, { palaceId }), (v: any) => v?.closets?.visible > 0 ? true : "stats has no closets");
  await run("/", "listWings", () => client.query(api.palace.queries.listWings, { palaceId }), (v: any) => Array.isArray(v) && v.length > 0 ? true : "no wings");
  await run("/", "listAllTunnels", () => client.query(api.palace.queries.listAllTunnels, { palaceId }), (v: any) => Array.isArray(v) ? true : "tunnels not array");

  // Monitoring queries shown on home
  await run("/", "searchLatencyStats", () => client.query(api.serving.monitoring.searchLatencyStats, { palaceId, lastHours: 24 }), (v: any) => typeof v?.count === "number" ? true : "bad latency shape");
  await run("/", "errorRate", () => client.query(api.serving.monitoring.errorRate, { palaceId, lastHours: 24 }), (v: any) => typeof v?.total === "number" ? true : "bad errorRate");
  await run("/", "pipelineHealth", () => client.query(api.serving.monitoring.pipelineHealth, { palaceId }), (v: any) => v?.embedding && v?.graphiti ? true : "no pipeline data");

  // Wing-card-expand drill: pick first wing → list rooms
  const wings = await client.query(api.palace.queries.listWings, { palaceId });
  const firstWing = wings[0]!;
  await run("/", "listRoomsByWing", () => client.query(api.palace.queries.listRoomsByWing, { wingId: firstWing._id }), (v: any) => Array.isArray(v) ? true : "rooms not array");

  // ─── ROOM /#/room/:id ─────────────────────────────────────────
  // Find first room with closets to test the deep view.
  let roomId: any = null;
  for (const w of wings) {
    const rooms = await client.query(api.palace.queries.listRoomsByWing, { wingId: w._id });
    for (const r of rooms) {
      if (r.closetCount > 0) { roomId = r._id; break; }
    }
    if (roomId) break;
  }
  if (roomId) {
    await run("/room/:id", "getRoomDeep", () => client.query(api.serving.rooms.getRoomDeep, { palaceId, roomId }), (v: any) => v?.room && Array.isArray(v?.closets) ? true : "bad room deep shape");
  }

  // ─── SEARCH PALETTE ────────────────────────────────────────────
  await run("search", "searchPalace (in-domain)", () => client.action(api.serving.search.searchPalace, { palaceId, query: "Zoo Media client", limit: 5 }), (v: any) => v?.results?.length > 0 && v?.confidence !== "low" ? true : `unexpected: ${v?.confidence}/${v?.results?.length}`);
  await run("search", "searchPalace (off-domain)", () => client.action(api.serving.search.searchPalace, { palaceId, query: "Recipe for butter chicken", limit: 5 }), (v: any) => v?.confidence === "low" ? true : `expected low conf, got ${v?.confidence}`);
  await run("search", "searchPalace (empty)", () => client.action(api.serving.search.searchPalace, { palaceId, query: "", limit: 5 }), (v: any) => v?.reason === "empty_query" ? true : `expected empty_query, got ${v?.reason}`);
  await run("search", "searchPalace (very long)", () => client.action(api.serving.search.searchPalace, { palaceId, query: "x".repeat(5000), limit: 5 }), (v: any) => v ? true : "no response on long query");

  // ─── /#/test PLAYGROUND ────────────────────────────────────────
  // Same searchPalace API; covered above.

  // ─── /#/entities ───────────────────────────────────────────────
  await run("/entities", "graphStats", () => client.action(api.serving.graph.graphStats, { palaceId: palace.clientId }), (v: any) => v?.entities > 0 ? true : "no entities");
  await run("/entities", "graphSearch (broad)", () => client.action(api.serving.graph.graphSearch, { palaceId: palace.clientId, query: "a", limit: 30 }), (v: any) => Array.isArray(v) && v.length > 0 ? true : "no entity results");
  await run("/entities", "graphSearch (specific)", () => client.action(api.serving.graph.graphSearch, { palaceId: palace.clientId, query: "Zoo Media", limit: 10 }), (v: any) => Array.isArray(v) && v.length > 0 ? true : "Zoo Media not found");
  await run("/entities", "graphTraverse", () => client.action(api.serving.graph.graphTraverse, { palaceId: palace.clientId, entityName: "NeuralEDGE", maxDepth: 2 }), (v: any) => v?.connected?.length > 0 ? true : "no neighbors for NeuralEDGE");

  // ─── /#/queries ────────────────────────────────────────────────
  await run("/queries", "recentQueries", () => client.query(api.palace.queries.recentQueries, { palaceId, limit: 50 }), (v: any) => Array.isArray(v) ? true : "not array");
  await run("/queries", "queryLogStats", () => client.query(api.palace.queries.queryLogStats, { palaceId, limit: 500 }), (v: any) => typeof v?.total === "number" ? true : "bad stats");

  // ─── /#/admin ──────────────────────────────────────────────────
  await run("/admin", "listQuarantined", () => client.query(api.palace.queries.listQuarantined, { palaceId }), (v: any) => Array.isArray(v) ? true : "not array");
  await run("/admin", "listNeops", () => client.query(api.access.queries.listNeops, { palaceId }), (v: any) => Array.isArray(v) && v.length > 0 ? true : "no neops");
  await run("/admin", "recentAuditEvents", () => client.query(api.access.queries.recentAuditEvents, { palaceId, limit: 50 }), (v: any) => Array.isArray(v) ? true : "not array");
  await run("/admin", "ingestionActivity", () => client.query(api.serving.monitoring.ingestionActivity, { palaceId, lastHours: 168 }), (v: any) => typeof v?.total === "number" ? true : "bad shape");

  // ─── HTTP /mcp endpoint (search palette uses this in places) ────
  const mcpResp = await fetch(`${SITE_URL}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "palace_search", params: { query: "OpenClaw", palaceId, limit: 5 }, neopId: "_admin", palaceId }),
  });
  const mcpJson = await mcpResp.json();
  const mcpOk = mcpJson?.status === "ok" && mcpJson?.data?.results?.length > 0;
  checks.push({ page: "http", name: "POST /mcp palace_search", pass: mcpOk, ms: 0, detail: mcpOk ? undefined : `status=${mcpJson?.status} results=${mcpJson?.data?.results?.length ?? 0}` });

  // ─── BRIDGE direct (used by serving/graph proxy) ───────────────
  const bridgeResp = await fetch("http://13.127.254.149:8100/health", { signal: AbortSignal.timeout(5000) });
  const bridgeOk = bridgeResp.ok;
  checks.push({ page: "bridge", name: "GET /health", pass: bridgeOk, ms: 0, detail: bridgeOk ? undefined : `status=${bridgeResp.status}` });

  // ─── FRONTEND HTML reachability (Vercel) ───────────────────────
  // Vercel preview deploys are auth-walled, so we just check we get either 200 or 401.
  const frontResp = await fetch(`${PROD_FRONTEND}/`, { signal: AbortSignal.timeout(8000) });
  const frontOk = frontResp.status === 200 || frontResp.status === 401;
  checks.push({ page: "frontend", name: "GET /", pass: frontOk, ms: 0, detail: `status=${frontResp.status}` });

  // ─── REPORT ────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(80));
  const byPage: Record<string, Check[]> = {};
  for (const c of checks) {
    (byPage[c.page] ??= []).push(c);
  }
  const totalPass = checks.filter(c => c.pass).length;
  const totalFail = checks.length - totalPass;

  for (const [page, items] of Object.entries(byPage)) {
    const pass = items.filter(c => c.pass).length;
    console.log(`\n${page}  ${pass}/${items.length}`);
    for (const c of items) {
      const icon = c.pass ? "✓" : "✗";
      const ms = c.ms ? ` (${c.ms}ms)` : "";
      console.log(`  ${icon} ${c.name}${ms}${c.detail ? ` — ${c.detail}` : ""}`);
    }
  }

  console.log("\n" + "─".repeat(80));
  console.log(`TOTAL: ${totalPass}/${checks.length} pass, ${totalFail} fail`);

  writeFileSync("benchmarks/results/results_e2e_smoke.json", JSON.stringify({
    timestamp: new Date().toISOString(),
    totalPass,
    totalFail,
    checks,
  }, null, 2));
  console.log("Saved benchmarks/results/results_e2e_smoke.json");

  if (totalFail > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
