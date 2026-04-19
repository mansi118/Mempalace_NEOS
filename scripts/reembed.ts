// Re-embed all closets with enriched context.
//
// Prepends wing/room/title to content before embedding so semantic
// context is stronger. Fixes search quality for queries like
// "What is NeuralEDGE?" and "Who is Rahul?"
//
// Usage:
//   CONVEX_URL=https://small-dogfish-433.convex.cloud npx tsx scripts/reembed.ts

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const BATCH_SIZE = 20;

const url = process.env.CONVEX_URL;
if (!url) { console.error("CONVEX_URL not set"); process.exit(1); }
const client = new ConvexHttpClient(url);

async function main() {
  const palace = await client.query(api.palace.queries.getPalaceByClient, { clientId: "neuraledge" });
  if (!palace) { console.error("Palace not found"); process.exit(1); }
  const palaceId = palace._id;
  console.log(`Palace: ${palace.name} (${palaceId})`);

  // Get all wings with names.
  const wings = await client.query(api.palace.queries.listWings, { palaceId });
  const wingNames = new Map(wings.map((w: any) => [w._id, w.name]));

  // Process wing by wing.
  let total = 0;
  let succeeded = 0;
  let failed = 0;

  for (const wing of wings) {
    const rooms = await client.query(api.palace.queries.listRoomsByWing, { wingId: wing._id });

    for (const room of rooms) {
      const closets = await client.query(api.palace.queries.listClosets, {
        roomId: room._id,
        includeDecayed: false,
        includeRetracted: false,
      });

      if (closets.length === 0) continue;

      console.log(`  ${wing.name}/${room.name}: ${closets.length} closets`);

      for (const closet of closets) {
        total++;

        // Build enriched text: wing/room context + title + content.
        // This gives the embedding semantic grounding.
        const parts = [
          `[${wing.name}/${room.name}]`,
          closet.title ? `${closet.title}` : "",
          `Category: ${closet.category}`,
          closet.content,
        ].filter(Boolean);

        const enrichedText = parts.join("\n").slice(0, 120_000);

        try {
          await client.action(api.ingestion.embed.embedAndStoreCloset, {
            closetId: closet._id,
            palaceId,
            content: enrichedText,
          });
          succeeded++;
        } catch (e: any) {
          failed++;
          console.error(`    FAIL: ${closet.title?.slice(0, 40)}: ${e.message?.slice(0, 60)}`);
        }

        // Progress every 50.
        if (total % 50 === 0) {
          console.log(`  ... ${total} processed (${succeeded} ok, ${failed} fail)`);
        }
      }
    }
  }

  console.log(`\nDone: ${total} processed, ${succeeded} succeeded, ${failed} failed`);
}

main().catch(e => { console.error(e); process.exit(1); });
