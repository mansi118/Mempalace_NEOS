// PII scanner — detects but does NOT redact.
//
// Tags closets with piiTags[] so the access layer can enforce redaction
// per NEop if needed. Redaction is a policy decision, not a scanner decision.
//
// Ported from MemPalace v3.3.0 policy/pii.py (regex-based).

const PII_PATTERNS: Array<{ tag: string; pattern: RegExp }> = [
  // Email addresses
  { tag: "email", pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },

  // Indian phone numbers (+91, 10 digits)
  { tag: "phone", pattern: /(?:\+91[\s-]?)?[6-9]\d{9}/g },

  // Indian PAN (ABCDE1234F)
  { tag: "pan", pattern: /\b[A-Z]{5}\d{4}[A-Z]\b/g },

  // Credit card numbers (13-19 digits, optionally grouped)
  { tag: "credit_card", pattern: /\b(?:\d{4}[\s-]?){3,4}\d{1,4}\b/g },

  // AWS access keys (AKIA...)
  { tag: "aws_key", pattern: /\bAKIA[A-Z0-9]{16}\b/g },
];

/**
 * Scan text for PII patterns. Returns list of detected PII types.
 * Does NOT redact — only tags.
 */
export function scanForPII(text: string): string[] {
  const found = new Set<string>();

  for (const { tag, pattern } of PII_PATTERNS) {
    // Reset lastIndex for global regexes.
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      found.add(tag);
    }
  }

  return [...found];
}
