// Seed neop_permissions table from config/access_matrix.yaml.
//
// Idempotent via upsertNeopPermissions.

import { ConvexHttpClient } from "convex/browser";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { api } from "../convex/_generated/api.js";

type ContentRule = { read: "*" | string[]; write: "*" | string[] };
type ContentTable = Record<string, Record<string, ContentRule>>;
type RuntimeTable = Record<string, string[]>;
type ScopeBinding = { parent: string; scope: { wing: string; room: string } };

interface AccessMatrix {
  schema_version: number;
  runtime: RuntimeTable;
  content: ContentTable;
  scopes: Record<string, ScopeBinding>;
}

// ───── args ─────

function getArg(name: string, fallback: string): string {
  const prefix = `--${name}=`;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith(prefix)) return a.slice(prefix.length);
  }
  return fallback;
}

const clientId = getArg("client-id", "neuraledge");

// ───── load config ─────

const __dirname = dirname(fileURLToPath(import.meta.url));
const configPath = resolve(__dirname, "../config/access_matrix.yaml");
const yaml = readFileSync(configPath, "utf8");
const matrix = parseYaml(yaml) as AccessMatrix;

// ───── Convex ─────

const url = process.env.CONVEX_URL;
if (!url) {
  console.error("CONVEX_URL not set. Run `npx convex dev` first.");
  process.exit(1);
}
const client = new ConvexHttpClient(url);

// ───── seed ─────

async function main(): Promise<void> {
  console.log(`Seeding access matrix for clientId=${clientId}...`);

  const palace = await client.query(api.palace.queries.getPalaceByClient, {
    clientId,
  });
  if (!palace) {
    console.error(`Palace for clientId=${clientId} not found. Run seed:palace first.`);
    process.exit(1);
  }

  let count = 0;

  // 1. Base NEops (with content table entries)
  for (const [neopId, runtimeOps] of Object.entries(matrix.runtime)) {
    const content = matrix.content[neopId] ?? {};
    await client.mutation(api.palace.mutations.upsertNeopPermissions, {
      palaceId: palace._id,
      neopId,
      runtimeOps,
      contentAccess: JSON.stringify(content),
    });
    count += 1;
  }

  // 2. Scoped NEop instances (inherit parent runtime + content, add scope binding)
  for (const [scopedId, binding] of Object.entries(matrix.scopes)) {
    const parentRuntime = matrix.runtime[binding.parent];
    const parentContent = matrix.content[binding.parent];
    if (!parentRuntime || !parentContent) {
      throw new Error(
        `scope ${scopedId} references unknown parent ${binding.parent}`,
      );
    }
    await client.mutation(api.palace.mutations.upsertNeopPermissions, {
      palaceId: palace._id,
      neopId: scopedId,
      parentNeopId: binding.parent,
      runtimeOps: parentRuntime,
      contentAccess: JSON.stringify(parentContent),
      scopeWing: binding.scope.wing,
      scopeRoom: binding.scope.room,
    });
    count += 1;
  }

  console.log(`  ${count} neop_permissions entries upserted`);

  const neops = await client.query(api.access.queries.listNeops, {
    palaceId: palace._id,
  });
  console.log(`  verified: ${neops.length} NEops in DB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
