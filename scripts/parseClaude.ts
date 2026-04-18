// Claude.ai export parser.
//
// Reads the exported JSON, chunks by Q+A exchange pairs, and returns
// an array of Exchange objects ready for ingestion.
//
// Usage:
//   import { parseClaudeExport } from "./parseClaude.js";
//   const exchanges = parseClaudeExport("scripts/data/conversations.json");

import { readFileSync } from "node:fs";

export interface Exchange {
  human: string;
  assistant: string;
  timestamp: number;
  conversationId: string;
  conversationTitle: string;
  exchangeIndex: number;
}

interface ClaudeMessage {
  uuid: string;
  text: string;
  content?: Array<{ type: string; text?: string }>;
  sender: "human" | "assistant";
  created_at: string;
  updated_at: string;
}

interface ClaudeConversation {
  uuid: string;
  name: string;
  created_at: string;
  updated_at: string;
  chat_messages: ClaudeMessage[];
}

function extractText(msg: ClaudeMessage): string {
  // Claude export format: text field OR content array with parts.
  if (msg.text) return msg.text;
  if (msg.content && Array.isArray(msg.content)) {
    return msg.content
      .filter((c) => c.type === "text" && c.text)
      .map((c) => c.text!)
      .join("\n\n");
  }
  return "";
}

export function parseClaudeExport(filePath: string): {
  exchanges: Exchange[];
  stats: {
    totalConversations: number;
    totalExchanges: number;
    skippedTrivial: number;
    avgExchangeLength: number;
  };
} {
  const raw = readFileSync(filePath, "utf8");
  let conversations: ClaudeConversation[];

  try {
    const parsed = JSON.parse(raw);
    // Claude export might be an array directly or wrapped in an object.
    conversations = Array.isArray(parsed) ? parsed : parsed.conversations ?? parsed.chat_conversations ?? [];
  } catch (e) {
    throw new Error(`Failed to parse Claude export: ${e}`);
  }

  const exchanges: Exchange[] = [];
  let skippedTrivial = 0;
  let totalChars = 0;

  for (const convo of conversations) {
    const messages = convo.chat_messages ?? [];
    let exchangeIdx = 0;

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]!;
      if (msg.sender !== "human") continue;

      // Find the next assistant message.
      const next = messages[i + 1];
      if (!next || next.sender !== "assistant") continue;

      const humanText = extractText(msg);
      const assistantText = extractText(next);

      // Skip trivial exchanges (< 20 chars human message).
      if (humanText.trim().length < 20) {
        skippedTrivial++;
        continue;
      }

      // Skip empty assistant responses.
      if (!assistantText.trim()) {
        skippedTrivial++;
        continue;
      }

      const timestamp = new Date(msg.created_at).getTime();

      exchanges.push({
        human: humanText,
        assistant: assistantText,
        timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
        conversationId: convo.uuid,
        conversationTitle: convo.name || "Untitled",
        exchangeIndex: exchangeIdx,
      });

      totalChars += humanText.length + assistantText.length;
      exchangeIdx++;
      i++; // Skip the assistant message we just processed.
    }
  }

  // Sort by timestamp (oldest first — chronological ingestion).
  exchanges.sort((a, b) => a.timestamp - b.timestamp);

  return {
    exchanges,
    stats: {
      totalConversations: conversations.length,
      totalExchanges: exchanges.length,
      skippedTrivial,
      avgExchangeLength: exchanges.length > 0 ? Math.round(totalChars / exchanges.length) : 0,
    },
  };
}
