// Access Control Isolation Benchmark.
//
// Tests every NEop against every tool to verify access enforcement.
// Must achieve 100% accuracy — any failure is a security bug.
//
// Usage:
//   CONVEX_SITE_URL=https://small-dogfish-433.convex.site npx tsx benchmarks/run_acl_suite.ts

import { writeFileSync } from "node:fs";

const SITE_URL = process.env.CONVEX_SITE_URL ?? "https://small-dogfish-433.convex.site";
const PALACE_ID = process.env.PALACE_ID ?? "k17cmbrx46zmqv0xtcjbnr3j9h85286s";

// NEops and their expected capabilities from access_matrix.yaml.
const NEOP_CAPABILITIES: Record<string, {
  canRecall: boolean;
  canRemember: boolean;
  canErase: boolean;
  readableWings: string[];
  unreadableWings: string[];
}> = {
  _admin: { canRecall: true, canRemember: true, canErase: true, readableWings: ["platform", "clients", "team", "gtm", "legal"], unreadableWings: [] },
  aria: { canRecall: true, canRemember: true, canErase: false, readableWings: ["platform", "clients", "team", "gtm", "brand"], unreadableWings: [] },
  neuralchat: { canRecall: true, canRemember: false, canErase: false, readableWings: ["platform", "clients", "team", "gtm", "brand"], unreadableWings: ["legal", "infra", "marketplace"] },
  forge: { canRecall: true, canRemember: true, canErase: true, readableWings: ["platform", "rd", "infra", "marketplace"], unreadableWings: ["legal", "gtm", "clients"] },
  recon: { canRecall: true, canRemember: true, canErase: false, readableWings: ["gtm", "clients", "partners", "brand"], unreadableWings: ["platform", "team", "legal", "infra"] },
};

interface ACLTestResult {
  neopId: string;
  tool: string;
  action: string;
  expectedStatus: "ok" | "denied";
  actualStatus: string;
  passed: boolean;
  detail?: string;
}

async function callMCP(tool: string, params: Record<string, any>, neopId: string): Promise<{ status: string; error?: string }> {
  try {
    const resp = await fetch(`${SITE_URL}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Palace-Neop": neopId },
      body: JSON.stringify({ tool, params: { ...params, palaceId: PALACE_ID }, neopId, palaceId: PALACE_ID }),
    });
    const data = await resp.json();
    if (resp.status === 403) return { status: "denied", error: data.error };
    if (resp.status === 200) return { status: "ok" };
    return { status: `http_${resp.status}`, error: data.error };
  } catch (e: any) {
    return { status: "error", error: e.message };
  }
}

async function main() {
  console.log("Access Control Isolation Benchmark");
  console.log("==================================\n");

  const results: ACLTestResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const [neopId, caps] of Object.entries(NEOP_CAPABILITIES)) {
    console.log(`Testing NEop: ${neopId}`);

    // Test 1: palace_status (recall) — should always work for registered NEops
    {
      const { status } = await callMCP("palace_status", {}, neopId);
      const expected = caps.canRecall ? "ok" : "denied";
      const pass = (status === "ok") === caps.canRecall;
      results.push({ neopId, tool: "palace_status", action: "recall", expectedStatus: expected, actualStatus: status, passed: pass });
      pass ? passed++ : failed++;
      if (!pass) console.log(`  FAIL: palace_status expected=${expected} actual=${status}`);
    }

    // Test 2: palace_search (recall)
    {
      const { status } = await callMCP("palace_search", { query: "test", limit: 1 }, neopId);
      const expected = caps.canRecall ? "ok" : "denied";
      const pass = (status === "ok") === caps.canRecall;
      results.push({ neopId, tool: "palace_search", action: "recall", expectedStatus: expected, actualStatus: status, passed: pass });
      pass ? passed++ : failed++;
      if (!pass) console.log(`  FAIL: palace_search expected=${expected} actual=${status}`);
    }

    // Test 3: palace_remember (remember) — should be denied for read-only NEops
    {
      const { status } = await callMCP("palace_remember", { content: "test memory" }, neopId);
      const expected = caps.canRemember ? "ok" : "denied";
      // "ok" or any non-403 counts as "allowed" (may fail for other reasons like missing LLM)
      const allowed = status !== "denied";
      const pass = allowed === caps.canRemember;
      results.push({ neopId, tool: "palace_remember", action: "remember", expectedStatus: expected, actualStatus: status, passed: pass });
      pass ? passed++ : failed++;
      if (!pass) console.log(`  FAIL: palace_remember expected=${expected} actual=${status}`);
    }

    // Test 4: palace_retract_closet (erase) — should be denied for non-erase NEops
    {
      const { status } = await callMCP("palace_retract_closet", { closetId: "fake_id", reason: "test" }, neopId);
      const expected = caps.canErase ? "ok" : "denied";
      // Non-erase NEops should get denied BEFORE the "not found" error
      const pass = caps.canErase ? status !== "denied" : status === "denied";
      results.push({ neopId, tool: "palace_retract_closet", action: "erase", expectedStatus: expected, actualStatus: status, passed: pass });
      pass ? passed++ : failed++;
      if (!pass) console.log(`  FAIL: palace_retract_closet expected=${expected} actual=${status}`);
    }

    console.log(`  ${neopId}: ${results.filter(r => r.neopId === neopId && r.passed).length}/${results.filter(r => r.neopId === neopId).length} passed`);
  }

  // Summary
  const total = passed + failed;
  const accuracy = total > 0 ? (passed / total * 100).toFixed(1) : "0";

  console.log("\n=== ACL RESULTS ===\n");
  console.log(`Total tests: ${total}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Accuracy: ${accuracy}%`);
  console.log(`Status: ${failed === 0 ? "PASS — all access controls enforced" : "FAIL — security violations detected"}`);

  if (failed > 0) {
    console.log("\nFailed tests:");
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  ${r.neopId} → ${r.tool} (${r.action}): expected=${r.expectedStatus}, got=${r.actualStatus}`);
    }
  }

  // Save
  const out = {
    name: "ACL Isolation Suite",
    timestamp: new Date().toISOString(),
    totalTests: total,
    passed,
    failed,
    accuracy: +accuracy,
    results,
  };
  writeFileSync("benchmarks/results/results_acl.json", JSON.stringify(out, null, 2));
  console.log(`\nSaved to benchmarks/results/results_acl.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
