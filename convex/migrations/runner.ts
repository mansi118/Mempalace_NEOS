// Migration runner scaffold.
//
// Every closet carries `schemaVersion`. When we evolve the schema in v2,
// we register a migration function here from N → N+1, then run
// `migrateClosets` to bring all closets up to current.
//
// For Phase 1, the only migration is identity (v1 → v1: no-op). The runner
// exists so the architectural path is paved.

import { internalMutation } from "../_generated/server.js";
import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel.js";

export const CURRENT_CLOSET_SCHEMA_VERSION = 1;

type ClosetMigration = (
  closet: Doc<"closets">,
) => Partial<Doc<"closets">> | null; // null = no change

const CLOSET_MIGRATIONS: Record<number, ClosetMigration> = {
  // 1 → 2: not needed yet. Add here when v2 schema changes land.
  // Example:
  //   2: (c) => ({ newField: deriveFromOldField(c) }),
};

export const migrateClosetBatch = internalMutation({
  args: {
    palaceId: v.id("palaces"),
    fromVersion: v.number(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { palaceId, fromVersion, limit }) => {
    const closets = await ctx.db
      .query("closets")
      .withIndex("by_palace", (q) => q.eq("palaceId", palaceId))
      .filter((q) => q.eq(q.field("schemaVersion"), fromVersion))
      .take(limit ?? 100);

    let migrated = 0;
    for (const c of closets) {
      let current = c;
      let version = fromVersion;
      while (version < CURRENT_CLOSET_SCHEMA_VERSION) {
        const next = CLOSET_MIGRATIONS[version + 1];
        if (!next) break;
        const patch = next(current);
        if (patch) {
          await ctx.db.patch(c._id as Id<"closets">, {
            ...patch,
            schemaVersion: version + 1,
          });
          current = { ...current, ...patch, schemaVersion: version + 1 };
        } else {
          await ctx.db.patch(c._id as Id<"closets">, {
            schemaVersion: version + 1,
          });
          current = { ...current, schemaVersion: version + 1 };
        }
        version += 1;
      }
      migrated += 1;
    }

    return { migrated, remaining: closets.length === (limit ?? 100) };
  },
});
