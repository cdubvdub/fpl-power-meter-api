import { chromium } from "playwright";
import { v4 as uuidv4 } from "uuid";
import { ensureDatabase } from "../persistence/db.js";
import { buildAddressAndUnitFromRow } from "../utils/csv.js";

export async function runSingleLookup({ username, password, tin, address, unit }) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    const result = await performFlow({ page, username, password, tin, address, unit });
    return { address, unit, ...result };
  } finally {
    await browser.close();
  }
}

export async function runBatchLookup({ username, password, tin, rows }) {
  const jobId = uuidv4();
  const db = ensureDatabase();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO jobs(job_id, created_at, status, total, processed) VALUES (?, ?, ?, ?, ?)").run(jobId, now, "running", rows.length, 0);

  // Fire-and-forget async processing; keep session during the whole run
  void (async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    let processed = 0;
    try {
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        try {
          const { address, unit } = buildAddressAndUnitFromRow(row);
          const result = await performFlow({ page, username, password, tin, address, unit });
          db.prepare("INSERT OR REPLACE INTO results(job_id, row_index, address, unit, meter_status, property_status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .run(jobId, i, address, unit || null, result?.meterStatus || null, result?.propertyStatus || null, null, new Date().toISOString());
        } catch (error) {
          db.prepare("INSERT OR REPLACE INTO results(job_id, row_index, address, unit, meter_status, property_status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
            .run(jobId, i, null, null, null, null, error?.message || "Unknown error", new Date().toISOString());
        }
        processed += 1;
        db.prepare("UPDATE jobs SET processed = ? WHERE job_id = ?").run(processed, jobId);
      }
      db.prepare("UPDATE jobs SET status = 'completed' WHERE job_id = ?").run(jobId);
    } catch (e) {
      db.prepare("UPDATE jobs SET status = 'failed' WHERE job_id = ?").run(jobId);
    } finally {
      await browser.close();
    }
  })();

  return { jobId, total: rows.length };
}

async function performFlow({ page, username, password, tin, address, unit }) {
  // High-level resilient automation using role/name when possible.
  // 1. Navigate to FPL
  await page.goto("https://www.fpl.com", { waitUntil: "domcontentloaded" });

  // 2. Region selection: click first FPL and Continue if shown
  try {
    const regionMap = page.locator(".nee-fpl-region-map");
    if (await regionMap.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await page.getByRole("button", { name: /FPL/i }).first().click({ timeout: 5000 }).catch(() => {});
      await page.getByRole("button", { name: /Continue/i }).click({ timeout: 5000 }).catch(() => {});
    }
  } catch {}

  // 3. Additional Service
  await page.getByRole("link", { name: /Additional Service/i }).click({ timeout: 15000 });

  // 4. Login
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /log in/i }).click();

  // 5. Business radio and continue
  await page.getByLabel(/business/i).check({ timeout: 15000 }).catch(async () => {
    // fallback to click on the radio container
    await page.locator('div.q-radio__inner input[name="customerType"][value="COMMERCIAL"]').check();
  });
  await page.getByRole("button", { name: /continue/i }).click();

  // 6. Next
  await page.getByRole("button", { name: /^next$/i }).click();

  // 7. No master account, Next
  await page.getByLabel(/^no$/i).check({ timeout: 10000 }).catch(async () => {
    await page.locator('div.q-radio__inner input[type="radio"]').first().check();
  });
  await page.getByRole("button", { name: /^next$/i }).click();

  // 8. TIN, Business Type (U.S. Business), Person Making Request = Devin, Next
  // TIN can be password type
  await page.getByLabel(/TIN/i).fill(String(tin));
  // Business type radio
  await page.getByLabel(/U\.S\. Business/i).check().catch(async () => {
    await page.locator('svg.q-radio__bg').first().click();
  });
  await page.getByLabel(/Person Making Request/i).fill("Devin");
  await page.getByRole("button", { name: /^next$/i }).click();

  // 9. Property Use dropdown and mailing address same as service, Next
  const propertyUse = page.getByLabel(/Property Use/i);
  await propertyUse.click();
  await page.getByRole("option", { name: /Property Manager needing service between tenants/i }).click();
  // Checkbox for mailing address same as service
  await page.getByRole("checkbox", { name: /mailing address.*same.*service/i }).check().catch(async () => {
    await page.locator(".q-checkbox__bg").first().click();
  });
  await page.getByRole("button", { name: /^next$/i }).click();

  // 10. Confirm property, Next
  await page.getByLabel(/Confirm property/i).check().catch(async () => {
    await page.locator(".q-radio__bg").first().click();
  });
  await page.getByRole("button", { name: /^next$/i }).click();

  // 11. Address + optional unit, Search or Next per flow
  await page.getByLabel(/^Address$/i).fill(address);
  if (unit) {
    // Try Apt or Unit fields and autocomplete selection
    const aptInput = page.getByLabel(/Apt\.?|Unit#|\*Unit#/i);
    await aptInput.fill(String(unit));
    // If an autocomplete appears, select exact match
    const option = page.getByRole("option", { name: new RegExp(`^${escapeRegExp(String(unit))}$`, "i") });
    await option.click({ timeout: 3000 }).catch(() => {});
  }
  // Some flows require Search before Next
  await page.getByRole("button", { name: /search/i }).click({ timeout: 3000 }).catch(() => {});
  await page.getByRole("button", { name: /^next$/i }).click({ timeout: 10000 }).catch(() => {});

  // 12. Confirm
  await page.getByRole("button", { name: /^confirm$/i }).click({ timeout: 15000 }).catch(() => {});

  // 13. Read Meter Status and Property Status
  let meterStatus = "";
  let propertyStatus = "";
  try {
    meterStatus = await page.getByText(/Meter Status\s*:/i).locator("xpath=following-sibling::*").first().innerText({ timeout: 5000 });
  } catch {}
  try {
    propertyStatus = await page.getByText(/Property Status\s*:/i).locator("xpath=following-sibling::*").first().innerText({ timeout: 5000 });
  } catch {}

  return {
    meterStatus: meterStatus || "Not found",
    propertyStatus: propertyStatus || "Not found",
  };
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


