/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access_enforce from "../access/enforce.js";
import type * as access_mutations from "../access/mutations.js";
import type * as access_queries from "../access/queries.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as ingestion_embed from "../ingestion/embed.js";
import type * as ingestion_extract from "../ingestion/extract.js";
import type * as ingestion_extractEntities from "../ingestion/extractEntities.js";
import type * as ingestion_ingest from "../ingestion/ingest.js";
import type * as ingestion_mutations from "../ingestion/mutations.js";
import type * as ingestion_pii from "../ingestion/pii.js";
import type * as ingestion_route from "../ingestion/route.js";
import type * as lib_dedup from "../lib/dedup.js";
import type * as lib_entityExtractor from "../lib/entityExtractor.js";
import type * as lib_enums from "../lib/enums.js";
import type * as lib_geminiLlm from "../lib/geminiLlm.js";
import type * as lib_graphClient from "../lib/graphClient.js";
import type * as lib_queryExpander from "../lib/queryExpander.js";
import type * as lib_qwen from "../lib/qwen.js";
import type * as lib_safePatch from "../lib/safePatch.js";
import type * as lib_validators from "../lib/validators.js";
import type * as maintenance_backfill from "../maintenance/backfill.js";
import type * as maintenance_curator from "../maintenance/curator.js";
import type * as maintenance_dedup from "../maintenance/dedup.js";
import type * as maintenance_pruner from "../maintenance/pruner.js";
import type * as maintenance_tunnels from "../maintenance/tunnels.js";
import type * as migrations_runner from "../migrations/runner.js";
import type * as palace_mutations from "../palace/mutations.js";
import type * as palace_provision from "../palace/provision.js";
import type * as palace_queries from "../palace/queries.js";
import type * as serving_assemble from "../serving/assemble.js";
import type * as serving_enrich from "../serving/enrich.js";
import type * as serving_export from "../serving/export.js";
import type * as serving_l0l1 from "../serving/l0l1.js";
import type * as serving_monitoring from "../serving/monitoring.js";
import type * as serving_rooms from "../serving/rooms.js";
import type * as serving_search from "../serving/search.js";
import type * as serving_tunnels from "../serving/tunnels.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "access/enforce": typeof access_enforce;
  "access/mutations": typeof access_mutations;
  "access/queries": typeof access_queries;
  crons: typeof crons;
  http: typeof http;
  "ingestion/embed": typeof ingestion_embed;
  "ingestion/extract": typeof ingestion_extract;
  "ingestion/extractEntities": typeof ingestion_extractEntities;
  "ingestion/ingest": typeof ingestion_ingest;
  "ingestion/mutations": typeof ingestion_mutations;
  "ingestion/pii": typeof ingestion_pii;
  "ingestion/route": typeof ingestion_route;
  "lib/dedup": typeof lib_dedup;
  "lib/entityExtractor": typeof lib_entityExtractor;
  "lib/enums": typeof lib_enums;
  "lib/geminiLlm": typeof lib_geminiLlm;
  "lib/graphClient": typeof lib_graphClient;
  "lib/queryExpander": typeof lib_queryExpander;
  "lib/qwen": typeof lib_qwen;
  "lib/safePatch": typeof lib_safePatch;
  "lib/validators": typeof lib_validators;
  "maintenance/backfill": typeof maintenance_backfill;
  "maintenance/curator": typeof maintenance_curator;
  "maintenance/dedup": typeof maintenance_dedup;
  "maintenance/pruner": typeof maintenance_pruner;
  "maintenance/tunnels": typeof maintenance_tunnels;
  "migrations/runner": typeof migrations_runner;
  "palace/mutations": typeof palace_mutations;
  "palace/provision": typeof palace_provision;
  "palace/queries": typeof palace_queries;
  "serving/assemble": typeof serving_assemble;
  "serving/enrich": typeof serving_enrich;
  "serving/export": typeof serving_export;
  "serving/l0l1": typeof serving_l0l1;
  "serving/monitoring": typeof serving_monitoring;
  "serving/rooms": typeof serving_rooms;
  "serving/search": typeof serving_search;
  "serving/tunnels": typeof serving_tunnels;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
