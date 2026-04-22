import { defineConfig, devices } from "@playwright/test";

// Uses the deployed Vercel URL as the baseURL. Tests run read-only, no writes.
// Override PROD_URL for canary tests against a different deployment.
const BASE = process.env.PROD_URL ?? "https://dist-dbqy631f8-mansi5.vercel.app";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  retries: 1,
  fullyParallel: false, // single worker keeps Convex subscription load predictable
  reporter: process.env.CI ? "dot" : "list",

  use: {
    baseURL: BASE,
    // Preview deployments may require the Vercel bypass token; inject if provided.
    extraHTTPHeaders: process.env.VERCEL_BYPASS_TOKEN
      ? { "x-vercel-protection-bypass": process.env.VERCEL_BYPASS_TOKEN }
      : undefined,
    viewport: { width: 1280, height: 800 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
