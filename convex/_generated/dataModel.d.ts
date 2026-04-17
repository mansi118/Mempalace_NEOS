/* eslint-disable */
/**
 * Generated data model types. Derived from `../schema.ts`.
 */

import type {
  DataModelFromSchemaDefinition,
  DocumentByName,
  TableNamesInDataModel,
} from "convex/server";
import type { GenericId } from "convex/values";
import schema from "../schema.js";

export type SchemaDataModel = DataModelFromSchemaDefinition<typeof schema>;
export type TableNames = TableNamesInDataModel<SchemaDataModel>;
export type Doc<TableName extends TableNames> = DocumentByName<
  SchemaDataModel,
  TableName
>;
export type Id<TableName extends TableNames | "_storage" | "_scheduled_functions"> =
  GenericId<TableName>;
export type DataModel = SchemaDataModel;
