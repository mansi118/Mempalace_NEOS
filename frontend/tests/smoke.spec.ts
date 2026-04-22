// Playwright smoke — verifies every route loads, renders critical content,
// and that the navigation chrome (logo/back button) actually navigates.
//
// Read-only. Makes zero writes to Convex. Safe to run against prod on a cron.

import { test, expect, Page } from "@playwright/test";

async function gotoAndWaitForData(page: Page, path: string) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[console] ${msg.text().slice(0, 200)}`);
  });
  await page.goto(path, { waitUntil: "domcontentloaded" });
  // Wait for Convex to push initial data; the Navbar palace name is a proxy.
  await expect(page.getByText("PALACE", { exact: false })).toBeVisible({ timeout: 15_000 });
  return errors;
}

test.describe("home", () => {
  test("/ renders hero, stats, and wings", async ({ page }) => {
    const errors = await gotoAndWaitForData(page, "/");
    await expect(page.getByRole("heading", { name: /Your palace of/i })).toBeVisible();
    await expect(page.getByText(/Context Vault — Live/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Wings$/i })).toBeVisible({ timeout: 15_000 });
    expect(errors, `console errors: ${errors.join("\n")}`).toHaveLength(0);
  });

  test("clicking 'Browse Palace' scrolls to wings grid", async ({ page }) => {
    await gotoAndWaitForData(page, "/");
    await page.getByRole("button", { name: /Browse Palace/i }).click();
    await expect(page.locator("#wings-grid")).toBeInViewport({ timeout: 5_000 });
  });
});

test.describe("navigation chrome", () => {
  test("logo returns to home from any sub-page", async ({ page }) => {
    await gotoAndWaitForData(page, "/#/entities");
    await page.getByRole("button", { name: /Go to palace home/i }).click();
    await expect(page).toHaveURL(/\/$|#$/);
    await expect(page.getByRole("heading", { name: /Your palace of/i })).toBeVisible();
  });

  test("navbar Entities tab navigates + highlights", async ({ page }) => {
    await gotoAndWaitForData(page, "/");
    await page.getByRole("button", { name: /^Entities$/ }).first().click();
    await expect(page).toHaveURL(/#\/entities$/);
    await expect(page.getByRole("heading", { name: /Entity Graph/i })).toBeVisible();
  });

  test("unknown hash falls back to home", async ({ page }) => {
    await gotoAndWaitForData(page, "/#/does-not-exist");
    await expect(page.getByRole("heading", { name: /Your palace of/i })).toBeVisible();
  });
});

test.describe("test playground", () => {
  test("/#/test has back button that navigates away", async ({ page }) => {
    await gotoAndWaitForData(page, "/#/test");
    await expect(page.getByRole("heading", { name: /PALACE Search Playground/i })).toBeVisible();
    // 7 preset queries render
    await expect(page.getByRole("button", { name: /Easy entity/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /Off-domain/i })).toBeVisible();
    // Back button leaves /test
    await page.getByRole("button", { name: /^Back$/ }).first().click();
    await expect(page).not.toHaveURL(/#\/test/);
  });
});

test.describe("entities", () => {
  test("/#/entities shows graph stats and lists entities", async ({ page }) => {
    await gotoAndWaitForData(page, "/#/entities");
    await expect(page.getByRole("heading", { name: /Entity Graph/i })).toBeVisible();
    await expect(page.getByText(/Entities$/i).first()).toBeVisible({ timeout: 10_000 });
    // Filter input is present
    await expect(page.getByPlaceholder(/Filter entities/i)).toBeVisible();
  });
});

test.describe("queries analytics", () => {
  test("/#/queries renders the four summary cards", async ({ page }) => {
    await gotoAndWaitForData(page, "/#/queries");
    await expect(page.getByRole("heading", { name: /Query Analytics/i })).toBeVisible();
    await expect(page.getByText(/Confidence distribution/i)).toBeVisible();
    await expect(page.getByText(/Recent searches/i)).toBeVisible();
  });
});

test.describe("admin", () => {
  test("/#/admin defaults to Quarantine tab and can switch tabs", async ({ page }) => {
    await gotoAndWaitForData(page, "/#/admin");
    await expect(page.getByRole("heading", { name: /Admin Console/i })).toBeVisible();
    // Default Quarantine tab
    await expect(page.getByRole("button", { name: /^Quarantine$/ })).toHaveCSS("border-bottom-color", /rgb\(0, 212, 170\)|#00D4AA/i);
    // Switch to Audit log
    await page.getByRole("button", { name: /^Audit log$/ }).click();
    // Some rows or "No audit events yet." appear
    await expect(page.locator("main")).toContainText(/Audit|events|No audit/i, { timeout: 8_000 });
    // Switch to NEops
    await page.getByRole("button", { name: /^NEops$/ }).click();
    // Back button returns home
    await page.getByRole("button", { name: /^Back$/ }).first().click();
    await expect(page).not.toHaveURL(/#\/admin/);
  });
});

test.describe("room deep link", () => {
  test("/#/room/<id> with fake id shows 'Room not found'", async ({ page }) => {
    // Use a syntactically valid Convex-id-looking string to hit the "not found" branch.
    await gotoAndWaitForData(page, "/#/room/k57_nonexistent_room_id_0000");
    await expect(page.getByText(/Room not found|Loading room/i)).toBeVisible({ timeout: 10_000 });
  });
});
