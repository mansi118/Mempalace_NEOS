// Batch ingestion runner for Claude.ai exports.
//
// Parses Claude export JSON, then calls ingestExchange for each exchange.
// Features:
//   - Progress file for crash recovery (skips already-processed exchanges)
//   - --dry-run mode (keyword routing only, no LLM calls, outputs CSV)
//   - --concurrency flag (default 3)
//   - --limit flag (process first N exchanges only)
//   - Backoff on errors
//
// Usage:
//   npm run seed:palace                           # ensure palace exists
//   npx tsx scripts/batchIngest.ts <export.json>  # full ingestion
//   npx tsx scripts/batchIngest.ts <export.json> --dry-run
//   npx tsx scripts/batchIngest.ts <export.json> --limit=50 --concurrency=5

import { ConvexHttpClient } from "convex/browser";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { api } from "../convex/_generated/api.js";
import { parseClaudeExport, type Exchange } from "./parseClaude.js";
import { routeToWing, routeToRoom, classifyCategory } from "../convex/ingestion/route.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Args ───────────────────────────────────────────────────────

const args = process.argv.slice(2);
const exportFile = args.find((a) => !a.startsWith("--"));
const isDryRun = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const clientIdArg = args.find((a) => a.startsWith("--client-id="));

const limit = limitArg ? parseInt(limitArg.split("=")[1]!, 10) : Infinity;
const concurrency = concurrencyArg ? parseInt(concurrencyArg.split("=")[1]!, 10) : 3;
const clientId = clientIdArg ? clientIdArg.split("=")[1]! : "neuraledge";

if (!exportFile) {
  console.error("Usage: npx tsx scripts/batchIngest.ts <claude-export.json> [options]");
  console.error("  --dry-run         Keyword-route only, no LLM, outputs CSV");
  console.error("  --limit=N         Process first N exchanges");
  console.error("  --concurrency=N   Max concurrent ingestions (default 3)");
  console.error("  --client-id=X     Palace client ID (default neuraledge)");
  process.exit(1);
}

// ─── Progress file ──────────────────────────────────────────────

const progressPath = resolve(__dirname, "data/ingest_progress.json");

interface Progress {
  lastProcessed: string; // "conversationId:exchangeIndex"
  processedCount: number;
  timestamp: string;
}

function loadProgress(): Set<string> {
  if (!existsSync(progressPath)) return new Set();
  try {
    const data = JSON.parse(readFileSync(progressPath, "utf8")) as {
      processed: string[];
    };
    return new Set(data.processed ?? []);
  } catch {
    return new Set();
  }
}

function saveProgress(processed: Set<string>): void {
  const dir = dirname(progressPath);
  if (!existsSync(dir)) {
    const { mkdirSync } = require("node:fs");
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(
    progressPath,
    JSON.stringify(
      {
        processed: [...processed],
        count: processed.size,
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

// ─── Convex client ──────────────────────────────────────────────

const url = process.env.CONVEX_URL;
if (!url && !isDryRun) {
  console.error("CONVEX_URL not set. Run `npx convex dev` first.");
  process.exit(1);
}

const client = url ? new ConvexHttpClient(url) : null;

// ─── Semaphore for concurrency control ──────────────────────────

class Semaphore {
  private queue: Array<() => void> = [];
  private current = 0;

  constructor(private max: number) {}

  async acquire(): Promise<void> {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    return new Promise<void>((resolve) => this.queue.push(resolve));
  }

  release(): void {
    this.current--;
    const next = this.queue.shift();
    if (next) {
      this.current++;
      next();
    }
  }
}

// ─── Main ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  const filePath = resolve(exportFile!);
  console.log(`Parsing Claude export: ${filePath}`);

  const { exchanges, stats } = parseClaudeExport(filePath);
  console.log(`Parsed: ${stats.totalConversations} conversations, ${stats.totalExchanges} exchanges`);
  console.log(`Skipped trivial: ${stats.skippedTrivial}`);
  console.log(`Avg exchange length: ${stats.avgExchangeLength} chars`);
  console.log("");

  // Apply limit.
  const toProcess = exchanges.slice(0, limit);
  console.log(`Processing: ${toProcess.length} exchanges (limit=${limit === Infinity ? "none" : limit})`);

  // ── Dry-run mode ──────────────────────────────────────────
  if (isDryRun) {
    console.log("\n--- DRY RUN (keyword routing only, no LLM calls) ---\n");
    console.log("conversationId,exchangeIndex,wing,room,category,humanChars,assistantChars");

    const wingCounts: Record<string, number> = {};

    for (const ex of toProcess) {
      const combined = `${ex.human}\n${ex.assistant}`;
      const wing = routeToWing(combined);
      const room = routeToRoom(combined, wing);
      const category = classifyCategory(combined);

      wingCounts[wing] = (wingCounts[wing] ?? 0) + 1;

      console.log(
        `${ex.conversationId},${ex.exchangeIndex},${wing},${room},${category},${ex.human.length},${ex.assistant.length}`,
      );
    }

    console.log("\n--- Wing distribution ---");
    for (const [wing, count] of Object.entries(wingCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${wing}: ${count} (${((count / toProcess.length) * 100).toFixed(1)}%)`);
    }
    return;
  }

  // ── Full ingestion ────────────────────────────────────────
  if (!client) {
    console.error("CONVEX_URL required for full ingestion.");
    process.exit(1);
  }

  // Lookup palace.
  const palace = await client.query(api.palace.queries.getPalaceByClient, { clientId });
  if (!palace) {
    console.error(`Palace for clientId=${clientId} not found. Run seed:palace first.`);
    process.exit(1);
  }
  console.log(`Palace: ${palace.name} (${palace._id})`);

  // Load progress.
  const processed = loadProgress();
  console.log(`Previously processed: ${processed.size}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log("");

  const sem = new Semaphore(concurrency);
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let totalTokens = 0;
  const t0 = Date.now();

  const promises: Promise<void>[] = [];

  for (let i = 0; i < toProcess.length; i++) {
    const ex = toProcess[i]!;
    const key = `${ex.conversationId}:${ex.exchangeIndex}`;

    // Skip already processed (crash recovery).
    if (processed.has(key)) {
      skipped++;
      continue;
    }

    const promise = (async () => {
      await sem.acquire();
      try {
        const result = await client!.action(api.ingestion.ingest.ingestExchange, {
          palaceId: palace._id,
          human: ex.human,
          assistant: ex.assistant,
          timestamp: ex.timestamp,
          conversationId: ex.conversationId,
          conversationTitle: ex.conversationTitle,
          exchangeIndex: ex.exchangeIndex,
        });

        totalTokens += result.tokensUsed;

        if (result.status === "ok" || result.status === "partial" || result.status === "quarantined") {
          succeeded++;
          processed.add(key);
        } else {
          failed++;
          console.error(`  FAIL [${key}]: ${result.errors.join("; ")}`);
        }

        // Progress update every 10 exchanges.
        if ((succeeded + failed) % 10 === 0) {
          saveProgress(processed);
          const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
          console.log(
            `  [${elapsed}s] ${succeeded + failed + skipped}/${toProcess.length} ` +
            `(ok=${succeeded} fail=${failed} skip=${skipped} tokens=${totalTokens})`,
          );
        }
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`  ERROR [${key}]: ${msg}`);

        // Backoff on rate limit (429).
        if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
          console.log("  Rate limited — backing off 30s...");
          await new Promise((r) => setTimeout(r, 30_000));
        }
      } finally {
        sem.release();
      }
    })();

    promises.push(promise);
  }

  await Promise.all(promises);

  // Final progress save.
  saveProgress(processed);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log("\n--- Summary ---");
  console.log(`Total exchanges: ${toProcess.length}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);
  console.log(`Skipped (already processed): ${skipped}`);
  console.log(`Tokens used: ${totalTokens}`);
  console.log(`Duration: ${elapsed}s`);
  console.log(`Progress saved to: ${progressPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
