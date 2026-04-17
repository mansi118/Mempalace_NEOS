/* eslint-disable */
/**
 * Runtime API references. anyApi is a proxy that builds paths on demand
 * (e.g. `api.palace.mutations.createCloset` resolves at call time).
 */
import { anyApi } from "convex/server";

export const api = anyApi;
export const internal = anyApi;
