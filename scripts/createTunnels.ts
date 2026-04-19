// Auto-create tunnels (cross-wing connections) from known relationships.
//
// NeuralEDGE's knowledge has natural cross-references:
//   - Zoo Media (clients) ↔ ICD NEop (platform) ↔ NePs (marketplace)
//   - Tech stack (rd) ↔ NEOS architecture (platform) ↔ Infrastructure (rd)
//   - GTM engine (gtm) ↔ ICP library (gtm) ↔ Outreach (gtm)
//   - Team (team) ↔ Projects (platform) ↔ Clients (clients)
//   - Legal templates (legal) ↔ Zoo Media (clients)
//   - Build3 (legal) ↔ Business model (team)
//
// Usage:
//   CONVEX_URL=https://small-dogfish-433.convex.cloud npx tsx scripts/createTunnels.ts

import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

const url = process.env.CONVEX_URL;
if (!url) { console.error("CONVEX_URL not set"); process.exit(1); }
const client = new ConvexHttpClient(url);

// Tunnel definitions: [fromWing/fromRoom, toWing/toRoom, relationship, strength]
const TUNNEL_DEFS: Array<[string, string, string, string, number]> = [
  // Clients ↔ Platform
  ["clients", "zoo-media", "platform", "neop-catalog", "depends_on", 0.9],
  ["clients", "zoo-media", "marketplace", "neps", "references", 0.7],
  ["clients", "_shared", "gtm", "pipeline", "references", 0.6],

  // Platform interconnections
  ["platform", "architecture", "platform", "neop-catalog", "depends_on", 0.9],
  ["platform", "neop-catalog", "marketplace", "neps", "extends", 0.8],
  ["platform", "features", "platform", "architecture", "depends_on", 0.7],

  // Tech ↔ Platform
  ["rd", "tools", "platform", "architecture", "depends_on", 0.8],
  ["rd", "memory-systems", "platform", "architecture", "extends", 0.9],

  // GTM ↔ Clients
  ["gtm", "positioning", "clients", "_shared", "references", 0.7],
  ["gtm", "icp", "gtm", "outreach", "depends_on", 0.8],
  ["gtm", "outreach", "clients", "_shared", "caused_by", 0.6],

  // Legal ↔ Clients
  ["legal", "contracts", "clients", "zoo-media", "references", 0.8],
  ["legal", "entities", "team", "org", "depends_on", 0.7],

  // Team ↔ Platform
  ["team", "org", "platform", "neop-catalog", "references", 0.6],
] as any;

async function main() {
  const palace = await client.query(api.palace.queries.getPalaceByClient, { clientId: "neuraledge" });
  if (!palace) { console.error("Palace not found"); process.exit(1); }
  const palaceId = palace._id;
  console.log(`Palace: ${palace.name}`);

  let created = 0;
  let skipped = 0;

  for (const [fromWing, fromRoom, toWing, toRoom, relationship, strength] of TUNNEL_DEFS) {
    // Resolve room IDs.
    const from = await client.query(api.palace.queries.getRoomByName, { palaceId, name: fromRoom });
    const to = await client.query(api.palace.queries.getRoomByName, { palaceId, name: toRoom });

    if (!from || !to) {
      console.log(`  SKIP: ${fromWing}/${fromRoom} → ${toWing}/${toRoom} (room not found)`);
      skipped++;
      continue;
    }

    try {
      await client.mutation(api.palace.mutations.createTunnel, {
        palaceId,
        fromRoomId: from._id,
        toRoomId: to._id,
        relationship: relationship as any,
        strength,
        label: `${fromWing}/${fromRoom} → ${toWing}/${toRoom}`,
      });
      console.log(`  OK: ${fromWing}/${fromRoom} → ${toWing}/${toRoom} (${relationship}, ${strength})`);
      created++;
    } catch (e: any) {
      console.log(`  FAIL: ${e.message?.slice(0, 80)}`);
      skipped++;
    }
  }

  console.log(`\nCreated: ${created}, Skipped: ${skipped}`);
}

main().catch(e => { console.error(e); process.exit(1); });
