// Closet enrichment query — separate from search.ts because search.ts
// uses "use node" (for Gemini API) and Convex only allows actions in
// Node.js files, not queries.

import { internalQuery } from "../_generated/server.js";
import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel.js";

export const enrichClosets = internalQuery({
  args: {
    closetIds: v.array(v.id("closets")),
  },
  handler: async (ctx, { closetIds }) => {
    const results = await Promise.all(
      closetIds.map(async (id) => {
        const closet = await ctx.db.get(id);
        if (!closet) return null;

        const [wing, room] = await Promise.all([
          ctx.db.get(closet.wingId),
          ctx.db.get(closet.roomId),
        ]);

        return {
          closet,
          wingName: wing?.name ?? "unknown",
          roomName: room?.name ?? "unknown",
        };
      }),
    );

    return results;
  },
});
