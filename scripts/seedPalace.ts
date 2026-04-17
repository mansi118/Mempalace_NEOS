// Seed NeuralEDGE HQ palace from config/wings.yaml.
//
// Idempotent: safe to re-run. Uses palace.status = "provisioning" → "ready"
// to ensure half-built palaces are invisible to serving queries until done.
//
// Usage:
//   $ npm run seed:palace -- [--client-id=neuraledge] [--name="NeuralEDGE HQ"]

import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { api } from "../convex/_generated/api.js";
import type { Id } from "../convex/_generated/dataModel.js";

interface RoomDef {
  primary_hall: string;
  description: string;
}

interface WingDef {
  description: string;
  sort_order: number;
  rooms: Record<string, RoomDef>;
}

interface WingsConfig {
  schema_version: number;
  hall_types: string[];
  wings: Record<string, WingDef>;
}

// ───── parse args ─────

function getArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return fallback;
}

const clientId = getArg("client-id", "neuraledge");
const palaceName = getArg("name", "NeuralEDGE HQ");
const falkordbGraph = getArg("falkordb-graph", `palace_${clientId}`);
const createdBy = getArg("created-by", "system");

// ───── load config ─────

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, "../config/wings.yaml");
const yaml = readFileSync(configPath, "utf8");
const config = parseYaml(yaml) as WingsConfig;

// ───── connect to Convex ─────

const url = process.env.CONVEX_URL;
if (!url) {
  console.error("CONVEX_URL not set. Run `npx convex dev` first.");
  process.exit(1);
}
const client = new ConvexHttpClient(url);

// ───── seed ─────

async function main(): Promise<void> {
  console.log(`Seeding palace "${palaceName}" (clientId=${clientId})...`);

  // 1. Palace (idempotent)
  const palaceId: Id<"palaces"> = await client.mutation(
    api.palace.mutations.createPalace,
    { name: palaceName, clientId, falkordbGraph, createdBy },
  );
  console.log(`  palace: ${palaceId}`);

  // 2. Wings
  const wingIds = new Map<string, Id<"wings">>();
  for (const [name, wing] of Object.entries(config.wings)) {
    const wingId = await client.mutation(api.palace.mutations.createWing, {
      palaceId,
      name,
      description: wing.description,
      sortOrder: wing.sort_order,
    });
    wingIds.set(name, wingId);
    console.log(`  wing ${name}: ${wingId}`);
  }

  // 3. Halls (one per hall_type per wing)
  const hallIds = new Map<string, Id<"halls">>(); // key: `${wingName}/${hallType}`
  for (const [wingName, wingId] of wingIds) {
    for (const hallType of config.hall_types) {
      const hallId = await client.mutation(api.palace.mutations.createHall, {
        wingId,
        palaceId,
        type: hallType,
      });
      hallIds.set(`${wingName}/${hallType}`, hallId);
    }
  }
  console.log(`  halls: ${hallIds.size}`);

  // 4. Rooms (assigned to their primary_hall)
  let roomCount = 0;
  for (const [wingName, wing] of Object.entries(config.wings)) {
    const wingId = wingIds.get(wingName);
    if (!wingId) throw new Error(`wing ${wingName} not found`);

    for (const [roomName, room] of Object.entries(wing.rooms)) {
      const hallId = hallIds.get(`${wingName}/${room.primary_hall}`);
      if (!hallId) {
        throw new Error(
          `room ${wingName}/${roomName} primary_hall=${room.primary_hall} not found`,
        );
      }

      await client.mutation(api.palace.mutations.createRoom, {
        hallId,
        wingId,
        palaceId,
        name: roomName,
        summary: room.description,
        tags: [],
      });
      roomCount += 1;
    }
  }
  console.log(`  rooms: ${roomCount}`);

  // 5. Initial L0/L1 (placeholder; Phase 5 will regenerate via Claude Haiku)
  await client.mutation(api.palace.mutations.updatePalaceBriefing, {
    palaceId,
    l0_briefing: `I am a NEop for ${palaceName}. Memory: search before assuming.`,
    l1_wing_index: `Wings: ${[...wingIds.keys()].join(", ")} (${roomCount} rooms total).`,
  });

  // 6. Mark palace ready (provisioning atomicity gate)
  await client.mutation(api.palace.mutations.markPalaceReady, { palaceId });
  console.log(`  status: ready`);

  // 7. Verify counts
  const stats = await client.query(api.palace.queries.getStats, { palaceId });
  console.log("");
  console.log("Stats:", JSON.stringify(stats, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
