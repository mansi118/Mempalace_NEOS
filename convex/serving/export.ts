// Markdown export — palace → hierarchical Markdown for backup/debug/GDPR.
//
// Exports one wing at a time to stay within response limits.
// Includes closets, drawers, and tunnel map.

import { query } from "../_generated/server.js";
import { v } from "convex/values";

export const exportToMarkdown = query({
  args: {
    palaceId: v.id("palaces"),
    wingFilter: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const palace = await ctx.db.get(args.palaceId);
    if (!palace) return null;

    // Get wings (filtered if specified).
    let wings = await ctx.db
      .query("wings")
      .withIndex("by_palace", (q) => q.eq("palaceId", args.palaceId))
      .collect();

    if (args.wingFilter) {
      wings = wings.filter((w) => w.name === args.wingFilter);
    }
    wings.sort((a, b) => a.sortOrder - b.sortOrder);

    const lines: string[] = [];
    lines.push(`# ${palace.name}`);
    lines.push(`> Exported ${new Date().toISOString()}`);
    lines.push("");

    for (const wing of wings) {
      if (wing.archived) continue;

      lines.push(`## Wing: ${wing.name}`);
      lines.push(`> ${wing.description}`);
      lines.push("");

      const rooms = await ctx.db
        .query("rooms")
        .withIndex("by_wing", (q) => q.eq("wingId", wing._id))
        .collect();

      for (const room of rooms) {
        lines.push(`### ${wing.name}/${room.name}`);
        lines.push(`> ${room.summary}`);
        if (room.tags.length > 0) {
          lines.push(`> Tags: ${room.tags.join(", ")}`);
        }
        lines.push("");

        const closets = await ctx.db
          .query("closets")
          .withIndex("by_room", (q) => q.eq("roomId", room._id))
          .collect();

        const visible = closets.filter(
          (c) => !c.retracted && !c.decayed && c.supersededBy === undefined,
        );

        for (const closet of visible) {
          const cat = closet.category;
          const conf = closet.confidence.toFixed(2);
          const date = new Date(closet.createdAt).toISOString().slice(0, 10);

          lines.push(
            `#### ${closet.title || "Untitled"} [${cat}] (${conf}, ${date})`,
          );
          lines.push("");
          lines.push(closet.content);
          lines.push("");

          // Drawers.
          const drawers = await ctx.db
            .query("drawers")
            .withIndex("by_closet", (q) => q.eq("closetId", closet._id))
            .collect();
          const valid = drawers.filter((d) => d.validUntil === undefined);

          if (valid.length > 0) {
            lines.push("**Facts:**");
            for (const d of valid) {
              lines.push(`- ${d.fact}`);
            }
            lines.push("");
          }
        }

        if (visible.length === 0) {
          lines.push("*No memories in this room.*");
          lines.push("");
        }
      }
    }

    // Tunnel map.
    const tunnels = await ctx.db
      .query("tunnels")
      .withIndex("by_palace", (q) => q.eq("palaceId", args.palaceId))
      .collect();

    if (tunnels.length > 0) {
      lines.push("## Tunnel Map");
      lines.push("");
      for (const t of tunnels) {
        const fromRoom = await ctx.db.get(t.fromRoomId);
        const toRoom = await ctx.db.get(t.toRoomId);
        const fromWing = fromRoom ? await ctx.db.get(fromRoom.wingId) : null;
        const toWing = toRoom ? await ctx.db.get(toRoom.wingId) : null;
        lines.push(
          `- ${fromWing?.name}/${fromRoom?.name} → ${toWing?.name}/${toRoom?.name} (${t.relationship}, strength ${t.strength.toFixed(2)})`,
        );
      }
      lines.push("");
    }

    return lines.join("\n");
  },
});
