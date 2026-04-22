// Backfill entity extraction → FalkorDB for all closets.
//
// Walks every wing/room/closet, runs Llama 4 Scout extraction,
// POSTs to bridge /graph/ingest. Skips closets already extracted
// unless --force is passed.
//
// Usage:
//   CONVEX_URL=https://modest-camel-322.convex.cloud npx tsx scripts/backfillEntities.ts
//   CONVEX_URL=... npx tsx scripts/backfillEntities.ts --force

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const CONCURRENCY = 1;  // Groq free tier: 30 req/min on Llama 3.3 70B
const REQUEST_INTERVAL_MS = 2100;  // ~28 req/min, under the cap
const force = process.argv.includes("--force");

const url = process.env.CONVEX_URL;
if (!url) { console.error("CONVEX_URL not set"); process.exit(1); }
const client = new ConvexHttpClient(url);

async function processOne(closetId: string, title: string): Promise<"ok" | "skip" | "err"> {
  try {
    const r = await client.action(api.ingestion.extractEntities.extractAndIngestCloset, {
      closetId: closetId as any,
    });
    if (r.status === "ok") {
      console.log(`  OK  ${title.slice(0, 50)} → ${r.entities}e/${r.relations}r`);
      return "ok";
    }
    if (r.status === "skipped") return "skip";
    console.log(`  ERR ${title.slice(0, 50)}: ${r.error?.slice(0, 80)}`);
    return "err";
  } catch (e: any) {
    console.log(`  ERR ${title.slice(0, 50)}: ${e.message?.slice(0, 80)}`);
    return "err";
  }
}

async function main() {
  const palace = await client.query(api.palace.queries.getPalaceByClient, { clientId: "neuraledge" });
  if (!palace) { console.error("Palace not found"); process.exit(1); }
  console.log(`Palace: ${palace.name} (force=${force})`);

  const wings = await client.query(api.palace.queries.listWings, { palaceId: palace._id });

  let total = 0, ok = 0, skip = 0, err = 0, alreadyDone = 0;

  for (const wing of wings) {
    const rooms = await client.query(api.palace.queries.listRoomsByWing, { wingId: wing._id });
    for (const room of rooms) {
      const closets = await client.query(api.palace.queries.listClosets, {
        roomId: room._id,
        includeDecayed: false,
        includeRetracted: false,
      });
      if (closets.length === 0) continue;

      const pending = force ? closets : closets.filter((c: any) => !c.entitiesExtracted);
      alreadyDone += closets.length - pending.length;
      if (pending.length === 0) continue;

      console.log(`\n[${wing.name}/${room.name}] ${pending.length} closets`);

      // Throttled serial processing — Groq free tier caps at 30 req/min.
      for (const c of pending as any[]) {
        const start = Date.now();
        const r = await processOne(c._id, c.title ?? c.content.slice(0, 50));
        total++;
        if (r === "ok") ok++;
        else if (r === "skip") skip++;
        else err++;
        const elapsed = Date.now() - start;
        const sleep = Math.max(0, REQUEST_INTERVAL_MS - elapsed);
        if (sleep > 0) await new Promise((r) => setTimeout(r, sleep));
      }
    }
  }

  console.log(`\n─────────────────────────`);
  console.log(`Processed: ${total}  (ok ${ok} / skip ${skip} / err ${err})`);
  console.log(`Already done (skipped): ${alreadyDone}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
