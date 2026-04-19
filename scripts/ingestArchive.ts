"use strict";
// Ingest the NeuralEDGE Complete Archive into the palace.
//
// This archive is pre-structured markdown, NOT Claude chat JSON.
// Each folder maps to a wing, each file to a room, each ## section
// to a closet with facts extracted as drawers.
//
// Usage:
//   npx tsx scripts/ingestArchive.ts /tmp/claude_export/neuraledge_export
//   npx tsx scripts/ingestArchive.ts /tmp/claude_export/neuraledge_export --dry-run

import { ConvexHttpClient } from "convex/browser";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, basename, join } from "node:path";
import { api } from "../convex/_generated/api.js";

// ─── Archive folder → palace wing mapping ───────────────────────

const FOLDER_TO_WING: Record<string, string> = {
  "01_company": "team",
  "02_neos_platform": "platform",
  "03_clients": "clients",
  "04_tech_and_memory": "rd",
  "05_gtm": "gtm",
  "06_projects": "platform",
  "07_legal_and_fundraising": "legal",
  "08_chat_index": "_quarantine",
};

const FILE_TO_ROOM: Record<string, string> = {
  // 01_company
  "01_overview.md": "org",
  "02_team.md": "org",
  "03_business_model.md": "org",
  // 02_neos_platform
  "01_neos_architecture.md": "architecture",
  "02_neops_catalog.md": "neop-catalog",
  "03_neps_marketplace.md": "neps",
  "04_openclaw_runtime.md": "neop-catalog",
  // 03_clients
  "01_clients_roster.md": "_shared",
  "02_zoo_media_full.md": "zoo-media",
  "03_zoo_media_decks.md": "zoo-media",
  "04_zoo_icd_neop.md": "zoo-media",
  // 04_tech_and_memory
  "01_tech_stack.md": "tools",
  "02_context_vault.md": "memory-systems",
  "03_cortex_palace_v3.md": "memory-systems",
  "04_infrastructure.md": "tools",
  // 05_gtm
  "01_gtm_engine.md": "positioning",
  "02_icp_library.md": "icp",
  "03_outreach_playbook.md": "outreach",
  // 06_projects
  "01_named_builds.md": "features",
  "02_nexus_alte.md": "features",
  "03_customer_connect_emma.md": "features",
  "04_axe_content_engine.md": "features",
  // 07_legal
  "01_legal_templates.md": "contracts",
  "02_pitch_decks.md": "entities",
  "03_build3_bar_raiser.md": "entities",
  // 08_chat_index
  "conversation_index.md": "unclassified",
};

// ─── Category detection from content ────────────────────────────

function detectCategory(title: string, content: string): string {
  const lower = (title + " " + content).toLowerCase();
  if (/\bdecid|\bchose|\bpicked|\brejected|\bselected|\bapproved/.test(lower)) return "decision";
  if (/\btodo|\baction item|\bneed to|\bshould do|\bmust do/.test(lower)) return "task";
  if (/\blearned|\bmistake|\btakeaway|\bwhat worked|\bretro/.test(lower)) return "lesson";
  if (/\bprefer|\bstyle|\bconvention|\blike to/.test(lower)) return "preference";
  if (/\bstep|\bhow to|\bprocess|\brunbook|\bworkflow/.test(lower)) return "procedure";
  if (/\bidentity|\bmission|\bvision|\bcore thesis|\bwho we are/.test(lower)) return "identity";
  return "fact";
}

// ─── Simple fact extraction from markdown ───────────────────────

function extractFacts(content: string): string[] {
  const facts: string[] = [];
  const lines = content.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Bullet points with specific data.
    if (/^[-*]\s+\*\*/.test(trimmed)) {
      const fact = trimmed
        .replace(/^[-*]\s+/, "")
        .replace(/\*\*/g, "")
        .trim();
      if (fact.length > 10 && fact.length < 200) {
        facts.push(fact);
      }
    }
    // Table rows with data.
    if (/^\|.+\|.+\|/.test(trimmed) && !/^[\|\s-]+$/.test(trimmed) && !/^\|.*---/.test(trimmed)) {
      const cells = trimmed.split("|").filter(c => c.trim()).map(c => c.trim().replace(/\*\*/g, ""));
      if (cells.length >= 2 && cells[0] && cells[0].length > 2 && cells[0] !== "Phase" && cells[0] !== "NEop" && cells[0] !== "Primitive") {
        const fact = cells.slice(0, 3).join(" — ");
        if (fact.length > 10 && fact.length < 200) {
          facts.push(fact);
        }
      }
    }
  }

  return facts.slice(0, 20); // Cap at 20 facts per section.
}

// ─── Split markdown into sections ───────────────────────────────

interface Section {
  title: string;
  content: string;
  level: number;
}

function splitIntoSections(markdown: string): Section[] {
  const sections: Section[] = [];
  const lines = markdown.split("\n");
  let currentTitle = "";
  let currentLevel = 0;
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)/);
    if (match) {
      if (currentTitle && currentLines.length > 0) {
        const content = currentLines.join("\n").trim();
        if (content.length > 20) {
          sections.push({ title: currentTitle, content, level: currentLevel });
        }
      }
      currentTitle = match[2]!;
      currentLevel = match[1]!.length;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // Last section.
  if (currentTitle && currentLines.length > 0) {
    const content = currentLines.join("\n").trim();
    if (content.length > 20) {
      sections.push({ title: currentTitle, content, level: currentLevel });
    }
  }

  return sections;
}

// ─── Main ───────────────────────────────────────────────────────

async function main() {
  const archivePath = process.argv[2];
  const isDryRun = process.argv.includes("--dry-run");

  if (!archivePath) {
    console.error("Usage: npx tsx scripts/ingestArchive.ts <archive-path> [--dry-run]");
    process.exit(1);
  }

  const url = process.env.CONVEX_URL;
  if (!url && !isDryRun) {
    console.error("CONVEX_URL not set. Set it or use --dry-run.");
    process.exit(1);
  }

  const client = url ? new ConvexHttpClient(url) : null;

  // Find palace.
  let palaceId: string | null = null;
  if (client) {
    const palace = await client.query(api.palace.queries.getPalaceByClient, {
      clientId: "neuraledge",
    });
    if (!palace) {
      console.error("NeuralEDGE palace not found. Run provision first.");
      process.exit(1);
    }
    palaceId = palace._id;
    console.log(`Palace: ${palace.name} (${palaceId})`);
  }

  // Scan archive folders.
  const folders = readdirSync(archivePath)
    .filter(f => statSync(join(archivePath, f)).isDirectory())
    .sort();

  let totalSections = 0;
  let totalFacts = 0;
  let totalClosets = 0;
  let totalSkipped = 0;

  for (const folder of folders) {
    const wing = FOLDER_TO_WING[folder] ?? "_quarantine";
    const folderPath = join(archivePath, folder);
    const files = readdirSync(folderPath).filter(f => f.endsWith(".md")).sort();

    console.log(`\n=== ${folder} → wing: ${wing} (${files.length} files) ===`);

    for (const file of files) {
      const room = FILE_TO_ROOM[file] ?? "unclassified";
      const filePath = join(folderPath, file);
      const content = readFileSync(filePath, "utf8");
      const sections = splitIntoSections(content);

      console.log(`  ${file} → room: ${room} (${sections.length} sections)`);

      for (const section of sections) {
        const category = detectCategory(section.title, section.content);
        const facts = extractFacts(section.content);
        totalSections++;
        totalFacts += facts.length;

        if (isDryRun) {
          console.log(
            `    [${category}] ${section.title.slice(0, 60)} (${section.content.length} chars, ${facts.length} facts)`,
          );
          continue;
        }

        // Create closet.
        try {
          const roomId = await client!.mutation(
            api.palace.mutations.getOrCreateRoom,
            {
              palaceId: palaceId as any,
              wingName: wing,
              roomName: room,
              summary: `${folder}/${file}`,
            },
          );

          const result = await client!.mutation(
            api.palace.mutations.createCloset,
            {
              roomId,
              palaceId: palaceId as any,
              content: section.content.slice(0, 50000),
              title: section.title.slice(0, 120),
              category,
              sourceType: "document",
              sourceAdapter: "archive-import",
              sourceExternalId: `${folder}/${file}#${section.title}`,
              authorType: "system",
              authorId: "archive-import",
              confidence: 0.9,
            } as any,
          );

          if (result.status === "noop") {
            totalSkipped++;
            continue;
          }

          totalClosets++;

          // Create drawers for extracted facts.
          for (const fact of facts) {
            await client!.mutation(api.palace.mutations.createDrawer, {
              closetId: result.closetId,
              palaceId: palaceId as any,
              fact,
              validFrom: Date.now(),
              confidence: 0.85,
            });
          }

          // Embed the closet content via Qwen.
          try {
            await client!.action(api.ingestion.embed.embedAndStoreCloset, {
              closetId: result.closetId,
              palaceId: palaceId as any,
              content: (section.title + "\n" + section.content).slice(0, 50000),
            });
          } catch (e: any) {
            console.log(`    [embed-failed] ${section.title.slice(0, 40)}: ${e.message?.slice(0, 80)}`);
          }

        } catch (e: any) {
          console.error(`    [ERROR] ${section.title.slice(0, 40)}: ${e.message?.slice(0, 100)}`);
        }
      }
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Sections processed: ${totalSections}`);
  console.log(`Closets created: ${totalClosets}`);
  console.log(`Skipped (dedup): ${totalSkipped}`);
  console.log(`Facts extracted: ${totalFacts}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
