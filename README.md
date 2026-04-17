# PALACE — Context Vault for NEops

Memory system for NEOS NEops. Convex (structured + vectors) + FalkorDB (temporal KG) + Voyage 4 (embeddings).

See `IMPLEMENTATION_PLAN.md` for the full roadmap.

## Phase 1 status

Schema deployed. CRUD mutations + queries implemented. Palace + access seeders ready.

## Quickstart

```bash
npm install
npx convex dev          # deploys schema, generates _generated/
npm run seed:palace     # creates NeuralEDGE HQ palace with 12 wings, 47 rooms
npm run seed:access     # ports access_matrix.yaml into neop_permissions table
npm test                # runs Phase 1 invariant tests
```

## Layout

```
convex/
  schema.ts                # 11 tables, all indexes
  lib/
    enums.ts               # categories, halls, sources, etc.
    validators.ts          # range/enum validation
    safePatch.ts           # append-only enforcement
    dedup.ts               # SHA256 dedup key (whitespace-normalized)
  palace/
    mutations.ts           # CRUD: createPalace, createWing, createCloset, ...
    queries.ts             # listWings, listRooms, listClosets, ...
  access/
    mutations.ts           # logAuditEvent, upsertNeopPermissions
    queries.ts             # getNeopPermissions, listNeops
  ingestion/
    mutations.ts           # logIngestion
  migrations/
    runner.ts              # schemaVersion-based migration scaffold
config/
  wings.yaml               # 12 wings, 47 rooms, primary_hall per room
  access_matrix.yaml       # 12 NEops, runtime + content permissions
scripts/
  seedPalace.ts            # idempotent palace + wings + halls + rooms
  seedAccess.ts            # idempotent NEop permissions
tests/
  palace.test.ts           # 15 invariant tests
```
