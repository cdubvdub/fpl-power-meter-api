import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { ensureDatabase } from "../persistence/db.js";
import { buildAddressAndUnitFromRow } from "../utils/csv.js";

export async function runSingleLookup({ username, password, tin, address, unit }) {
  console.log('Starting single lookup...');
  await clearArtifacts(); // Clear previous screenshots
  const headless = process.env.HEADLESS !== "false";
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    // Login first
    await safeLoginFlow({ page, username, password });
    // Then perform the post-login flow
    const result = await performPostLoginFlow({ page, tin, address, unit });
    return { address, unit, ...result };
  } finally {
    await browser.close();
  }
}

export async function runBatchLookup({ username, password, tin, rows }) {
  console.log('Starting batch lookup...');
  console.log(`Processing ${rows.length} addresses:`, rows.map((row, i) => `${i + 1}. ${buildAddressAndUnitFromRow(row).address}`));
  await clearArtifacts(); // Clear previous screenshots
  const jobId = uuidv4();
  const db = ensureDatabase();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO jobs(job_id, created_at, status, total, processed) VALUES (?, ?, ?, ?, ?)").run(jobId, now, "running", rows.length, 0);
  console.log(`Job ${jobId} created with ${rows.length} total addresses`);

  // Fire-and-forget async processing; keep session during the whole run
  void (async () => {
    const headless = process.env.HEADLESS !== "false";
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    let processed = 0;
    let needsFullFlow = true; // Track if we need to go through full flow or can use "Not the right address?"
    
    try {
      // Pre-login once, reuse session
      await safeLoginFlow({ page, username, password });
      
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        try {
          const { address, unit } = buildAddressAndUnitFromRow(row);
          console.log(`\n=== Processing address ${i + 1}/${rows.length}: ${address}${unit ? ` (Unit: ${unit})` : ''} ===`);
          console.log(`Current page URL: ${page.url()}`);
          
          let result;
          if (needsFullFlow) {
            // First address or after a failure - go through full flow
            console.log('Using full flow for this address...');
            result = await performPostLoginFlow({ page, tin, address, unit });
            console.log('Full flow completed, result:', result);
            needsFullFlow = false; // Next addresses can use "Not the right address?"
          } else {
            // Subsequent addresses - use "Not the right address?" link
            console.log('Using "Not the right address?" flow for this address...');
            console.log('Looking for "Not the right address?" link...');
            result = await processNextAddress({ page, tin, address, unit });
            console.log('"Not the right address?" flow completed, result:', result);
          }
          
          // Check if we got valid results
          console.log(`Result for address ${i + 1}:`, result);
          if (result && (result.meterStatus !== "Not found" || result.propertyStatus !== "Not found")) {
            console.log(`Successfully processed: Meter=${result.meterStatus}, Property=${result.propertyStatus}`);
            const statusCapturedAt = new Date().toISOString();
            const insertResult = db.prepare("INSERT OR REPLACE INTO results(job_id, row_index, address, unit, meter_status, property_status, error, created_at, status_captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run(jobId, i, address, unit || null, result?.meterStatus || null, result?.propertyStatus || null, null, new Date().toISOString(), statusCapturedAt);
            console.log(`Inserted result for address ${i + 1}:`, insertResult);
          } else {
            console.log('No valid status found, will restart from Step 4 for next address');
            const insertResult = db.prepare("INSERT OR REPLACE INTO results(job_id, row_index, address, unit, meter_status, property_status, error, created_at, status_captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run(jobId, i, address, unit || null, null, null, "No status found", new Date().toISOString(), null);
            console.log(`Inserted error result for address ${i + 1}:`, insertResult);
            needsFullFlow = true; // Next address needs full flow
          }
        } catch (error) {
          console.log(`Error processing address ${i + 1}: ${error.message}`);
          console.log(`Full error details:`, error);
          db.prepare("INSERT OR REPLACE INTO results(job_id, row_index, address, unit, meter_status, property_status, error, created_at, status_captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(jobId, i, address, unit || null, null, null, error?.message || "Unknown error", new Date().toISOString(), null);
          needsFullFlow = true; // Next address needs full flow
        }
        processed += 1;
        db.prepare("UPDATE jobs SET processed = ? WHERE job_id = ?").run(processed, jobId);
        console.log(`Completed address ${i + 1}/${rows.length}. Processed count: ${processed}`);
      }
      console.log(`Batch processing completed. Total addresses processed: ${processed}/${rows.length}`);
      db.prepare("UPDATE jobs SET status = 'completed' WHERE job_id = ?").run(jobId);
    } catch (e) {
      console.log(`Batch processing failed: ${e.message}`);
      db.prepare("UPDATE jobs SET status = 'failed' WHERE job_id = ?").run(jobId);
    } finally {
      await browser.close();
    }
  })();

  return { jobId, total: rows.length };
}

async function safeLoginFlow({ page, username, password }) {
  // Set longer default timeout for slow site
  page.setDefaultTimeout(30000);
  
  // Step 1: Browse to https://www.fpl.com
  console.log('Step 1: Navigating to FPL homepage...');
  await page.goto("https://www.fpl.com", { waitUntil: "networkidle" });
  await page.waitForLoadState("domcontentloaded");
  // await capture(page, 'fpl-homepage');
  
  // Cookie consent (best-effort)
  try {
    await page.getByRole("button", { name: /accept|agree|got it|ok/i }).click({ timeout: 5000 });
    await page.waitForTimeout(1000);
  } catch {}

  // Step 2: Enter username and password and select "Log in"
  console.log('Step 2: Looking for login form...');
  // await capture(page, 'before-login');
  
  // Try to find login form on homepage first
  let loginFound = false;
  try {
    const userInput = page.getByLabel(/username/i).or(page.locator('input[type="text"]')).or(page.locator('input[name*="user"]'));
    if (await userInput.first().isVisible({ timeout: 5000 })) {
      console.log('Login form found on homepage');
      loginFound = true;
    }
  } catch {}

  // If not found on homepage, try direct navigation to login
  if (!loginFound) {
    const loginUrls = [
      'https://www.fpl.com/login',
      'https://www.fpl.com/my-account.html',
      'https://www.fpl.com/account/login',
      'https://www.fpl.com/customer-portal'
    ];
    
    for (const url of loginUrls) {
      try {
        console.log(`Trying direct navigation to: ${url}`);
        await page.goto(url, { waitUntil: "networkidle" });
        await page.waitForTimeout(3000);
        
        const userInput = page.getByLabel(/username/i).or(page.locator('input[type="text"]')).or(page.locator('input[name*="user"]'));
        if (await userInput.first().isVisible({ timeout: 5000 })) {
          console.log(`Login form found at: ${url}`);
          loginFound = true;
          break;
        }
      } catch (err) {
        console.log(`Failed to load ${url}: ${err.message}`);
      }
    }
  }
  
  if (!loginFound) {
    await capture(page, 'no-login-found');
    throw new Error('Could not find login form on any FPL page');
  }

  await capture(page, 'login-page');
  
  // Fill credentials
  console.log('Filling login credentials...');
  const userInput = page.getByLabel(/username/i).or(page.locator('input[type="text"]')).or(page.locator('input[name*="user"]'));
  const passInput = page.getByLabel(/password/i).or(page.locator('input[type="password"]'));
  
  await userInput.first().waitFor({ timeout: 10000 });
  await userInput.first().fill(username);
  await passInput.first().fill(password);
  
  console.log('Submitting login...');
  await page.getByRole("button", { name: /log in/i }).click();
  await page.waitForTimeout(3000);
  await capture(page, 'after-login');
}

async function performPostLoginFlow({ page, tin, address, unit }) {
  // Wait for page to load after login
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000);
  
  // Step 3: Select the account (Kalvaitis Holdings, LLC)
  console.log('Step 3: Looking for account selection...');
  await capture(page, 'after-login-account-selection');
  
  try {
    // Look for the specific account link with title "Kalvaitis Holdings, Llc"
    console.log('Looking for account link with title containing "Kalvaitis Holdings"...');
    
    const accountLink = page.locator('a[title*="Kalvaitis Holdings"]').first();
    if (await accountLink.isVisible({ timeout: 5000 })) {
      const accountText = await accountLink.textContent();
      console.log(`Found specific account: "${accountText}", clicking it...`);
      await accountLink.click({ timeout: 10000 });
      await page.waitForTimeout(3000);
    } else {
      console.log('Account selection failed, trying fallback...');
      await capture(page, 'account-selection-failed');
    }
  } catch (e) {
    console.log('Account selection failed:', e.message);
    await capture(page, 'account-selection-failed');
  }
  
  // Step 4: From the top menu select the "Services" drop down and choose "Start, Stop, Move"
  console.log('Step 4: Looking for Services dropdown...');
  // await capture(page, 'before-services-dropdown');
  
  try {
    // Look for Services dropdown in top menu
    const servicesDropdown = page.getByRole('button', { name: /Services/i }).or(page.locator('a:has-text("Services")'));
    if (await servicesDropdown.isVisible({ timeout: 5000 })) {
      console.log('Found Services dropdown, clicking it...');
      await servicesDropdown.click({ timeout: 10000 });
      await page.waitForTimeout(2000);
      
      // Look for "Start, Stop, Move" option
      const startStopMove = page.getByRole('link', { name: /Start, Stop, Move/i }).or(page.locator('a:has-text("Start, Stop, Move")'));
      if (await startStopMove.isVisible({ timeout: 5000 })) {
        console.log('Found "Start, Stop, Move" option, clicking it...');
        await startStopMove.click({ timeout: 10000 });
        await page.waitForTimeout(3000);
      } else {
        console.log('Start, Stop, Move option not found');
        await capture(page, 'start-stop-move-not-found');
      }
    } else {
      console.log('Services dropdown not found');
      await capture(page, 'services-dropdown-not-found');
    }
  } catch (e) {
    console.log('Services dropdown failed:', e.message);
    await capture(page, 'services-dropdown-failed');
  }
  
  // Step 5: On the "Select your region." Page, Select the first "FPL" button
  console.log('Step 5: Looking for region selection...');
  // await capture(page, 'before-region-selection');
  
  try {
    // Look for the specific FPL region choice element
    const fplRegionChoice = page.locator('a.nee-fpl-region-choice[data-region="fpl"]');
    if (await fplRegionChoice.isVisible({ timeout: 5000 })) {
      console.log('Found FPL region choice, clicking it...');
      await fplRegionChoice.click({ timeout: 15000 });
      await page.waitForTimeout(2000);
      
      // Look for Continue button
      const continueButton = page.getByRole("button", { name: /Continue/i });
      if (await continueButton.isVisible({ timeout: 5000 })) {
        console.log('Found Continue button, clicking it...');
        await continueButton.click({ timeout: 15000 });
        await page.waitForTimeout(2000);
      } else {
        console.log('Continue button not found');
        await capture(page, 'continue-button-not-found');
      }
    } else {
      console.log('FPL region choice not found, trying fallback...');
      await capture(page, 'fpl-region-choice-not-found');
      
      // Fallback: try the region map approach
      const regionMap = page.locator(".nee-fpl-region-map");
      if (await regionMap.first().isVisible({ timeout: 5000 })) {
        console.log('Region map found as fallback, selecting FPL...');
        await page.getByRole("button", { name: /FPL/i }).first().click({ timeout: 15000 });
        await page.waitForTimeout(2000);
        await page.getByRole("button", { name: /Continue/i }).click({ timeout: 15000 });
        await page.waitForTimeout(2000);
      } else {
        console.log('Region map not found either');
        await capture(page, 'region-map-not-found');
      }
    }
  } catch (e) {
    console.log('Region selection failed:', e.message);
    await capture(page, 'region-selection-failed');
  }
  
  // Step 6: Select Additional Service
  console.log('Step 6: Looking for Additional Service...');
  // await capture(page, 'before-additional-service');
  
  try {
    await clickAdditionalServiceSafe(page);
    console.log('Successfully clicked Additional Service');
  } catch (e) {
    console.log('Additional Service not found:', e.message);
    await capture(page, 'additional-service-not-found');
  }
  
  // Step 7: Select business (radio button) and press "continue" button
  console.log('Step 7: Looking for Business radio button...');
  await page.waitForTimeout(3000); // Wait for page to fully load
  await capture(page, 'before-business-selection');
  
  // Debug: List all radio buttons and inputs on the page
  try {
    const allInputs = page.locator('input[type="radio"]');
    const inputCount = await allInputs.count();
    console.log(`Found ${inputCount} radio buttons on the page`);
    
    for (let i = 0; i < inputCount; i++) {
      const input = allInputs.nth(i);
      const name = await input.getAttribute('name');
      const value = await input.getAttribute('value');
      const id = await input.getAttribute('id');
      console.log(`Radio ${i}: name="${name}", value="${value}", id="${id}"`);
    }
  } catch (e) {
    console.log('Error listing radio buttons:', e.message);
  }
  
  // Try multiple strategies for Business selection
  let businessSelected = false;
  
  // Strategy 1: Click the visible radio button SVG element for Business
  try {
    console.log('Looking for Business radio button SVG...');
    const businessRadioSvg = page.locator('svg.q-radio__bg:has(path.q-radio__check)');
    if (await businessRadioSvg.isVisible({ timeout: 3000 })) {
      console.log('Found Business radio button SVG, clicking it');
      await businessRadioSvg.click({ timeout: 5000 });
      businessSelected = true;
    }
  } catch (e) {
    console.log('Strategy 1 (SVG) failed:', e.message);
  }
  
  // Strategy 2: Look for the radio button container div and click it
  if (!businessSelected) {
    try {
      console.log('Looking for radio button container...');
      const radioContainer = page.locator('div.q-radio__inner:has(input[value="COMMERCIAL"])');
      if (await radioContainer.isVisible({ timeout: 3000 })) {
        console.log('Found COMMERCIAL radio container, clicking it');
        await radioContainer.click({ timeout: 5000 });
        businessSelected = true;
      }
    } catch (e) {
      console.log('Strategy 2 (container) failed:', e.message);
    }
  }
  
  // Strategy 3: Look for Business text and click the parent radio container
  if (!businessSelected) {
    try {
      console.log('Looking for Business text and parent radio...');
      const businessText = page.getByText(/Business/i);
      if (await businessText.isVisible({ timeout: 3000 })) {
        console.log('Found Business text, looking for parent radio container');
        const parentRadio = businessText.locator('xpath=ancestor::div[contains(@class, "q-radio__inner")]');
        if (await parentRadio.isVisible({ timeout: 3000 })) {
          console.log('Found parent radio container, clicking it');
          await parentRadio.click({ timeout: 5000 });
          businessSelected = true;
        }
      }
    } catch (e) {
      console.log('Strategy 3 (parent) failed:', e.message);
    }
  }
  
  // Strategy 4: Try clicking the radio button by its label
  if (!businessSelected) {
    try {
      console.log('Looking for radio button by label...');
      const businessLabel = page.getByLabel(/Business/i);
      if (await businessLabel.isVisible({ timeout: 3000 })) {
        console.log('Found Business label, clicking it');
        await businessLabel.click({ timeout: 5000 });
        businessSelected = true;
      }
    } catch (e) {
      console.log('Strategy 4 (label) failed:', e.message);
    }
  }
  
  // Strategy 5: Use JavaScript to click the hidden radio input
  if (!businessSelected) {
    try {
      console.log('Using JavaScript to click COMMERCIAL radio...');
      const clicked = await page.evaluate(() => {
        const commercialRadio = document.querySelector('input[name="customerType"][value="COMMERCIAL"]');
        if (commercialRadio) {
          commercialRadio.click();
          return true;
        }
        return false;
      });
      if (clicked) {
        console.log('Successfully clicked COMMERCIAL radio via JavaScript');
        businessSelected = true;
      }
    } catch (e) {
      console.log('Strategy 5 (JavaScript) failed:', e.message);
    }
  }
  
  if (!businessSelected) {
    console.log('Could not find any radio button to select');
    await capture(page, 'no-radio-buttons-found');
  }
  
  console.log('Clicking Continue button...');
  await page.getByRole("button", { name: /continue/i }).click({ timeout: 15000 });
  await page.waitForTimeout(2000);
  await capture(page, 'after-business-continue');

  // Step 8: Next button after Business selection
  console.log('Step 8: Looking for Next button after Business selection...');
  // await capture(page, 'before-step-8-next');
  try {
    await page.getByRole("button", { name: /^next$/i }).click({ timeout: 15000 });
    await page.waitForTimeout(2000);
    await capture(page, 'after-step-8-next');
  } catch (e) {
    console.log('Step 8 Next button failed:', e.message);
    await capture(page, 'step-8-next-failed');
  }

  // Step 9: Master account? No -> Next
  console.log('Step 9: Looking for master account question...');
  // await capture(page, 'before-master-account');
  try {
    const noRadio = page.getByLabel(/^No$/i);
    if (await noRadio.isVisible({ timeout: 5000 })) {
      console.log('Found No radio button for master account, clicking it...');
      await noRadio.check({ timeout: 5000 });
    } else {
      console.log('No radio button not found, trying first radio button...');
      await page.locator('div.q-radio__inner input[type="radio"]').first().check({ timeout: 5000 });
    }
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: /^next$/i }).click({ timeout: 15000 });
    await page.waitForTimeout(2000);
    await capture(page, 'after-master-account');
  } catch (e) {
    console.log('Step 9 master account failed:', e.message);
    await capture(page, 'step-9-master-account-failed');
  }

  // Step 10: TIN, Business Type, Person Making Request -> Next
  console.log('Step 10: Looking for TIN and Business Type fields...');
  // await capture(page, 'before-tin-fields');
  try {
    // Fill TIN
    const tinInput = page.getByLabel(/^TIN$/i).or(page.locator('input[aria-label="TIN"]'));
    if (await tinInput.isVisible({ timeout: 5000 })) {
      console.log('Found TIN input, filling it...');
      await tinInput.fill(String(tin));
    } else {
      console.log('TIN input not found');
    }
    
    // Select U.S. Business
    try {
      // Strategy 1: Target the specific U.S. Business radio by role and exact name
      const usBusinessRadio = page.getByRole('radio', { name: 'U.S. Business', exact: true });
      if (await usBusinessRadio.isVisible({ timeout: 3000 })) {
        console.log('Found U.S. Business radio by role, clicking it...');
        await usBusinessRadio.click({ timeout: 5000 });
      } else {
        // Strategy 2: Target the div container with specific class
        const usBusinessDiv = page.locator('div.nee_fpl_us_business_radion_button');
        if (await usBusinessDiv.isVisible({ timeout: 3000 })) {
          console.log('Found U.S. Business div container, clicking it...');
          await usBusinessDiv.click({ timeout: 5000 });
        } else {
          // Strategy 3: Look for the SVG radio button next to U.S. Business text
          const usBusinessText = page.getByText('U.S. Business');
          if (await usBusinessText.isVisible({ timeout: 3000 })) {
            console.log('Found U.S. Business text, looking for nearby radio...');
            const nearbyRadio = usBusinessText.locator('xpath=preceding::svg[contains(@class, "q-radio__bg")][1] | following::svg[contains(@class, "q-radio__bg")][1]');
            if (await nearbyRadio.isVisible({ timeout: 3000 })) {
              console.log('Found nearby radio SVG, clicking it...');
              await nearbyRadio.click({ timeout: 5000 });
            } else {
              console.log('U.S. Business radio not found, trying first radio...');
              await page.locator('div.q-radio__inner').first().click({ timeout: 5000 });
            }
          } else {
            console.log('U.S. Business text not found, trying first radio...');
            await page.locator('div.q-radio__inner').first().click({ timeout: 5000 });
          }
        }
      }
    } catch (e) {
      console.log('U.S. Business selection failed:', e.message);
      // Fallback: try JavaScript approach
      try {
        console.log('Trying JavaScript approach for U.S. Business...');
        const clicked = await page.evaluate(() => {
          const usBusinessDiv = document.querySelector('div.nee_fpl_us_business_radion_button');
          if (usBusinessDiv) {
            usBusinessDiv.click();
            return true;
          }
          return false;
        });
        if (clicked) {
          console.log('Successfully clicked U.S. Business via JavaScript');
        }
      } catch (jsError) {
        console.log('JavaScript approach also failed:', jsError.message);
      }
    }
    
    // Fill Person Making Request
    const personInput = page.getByLabel(/Person Making Request/i);
    if (await personInput.isVisible({ timeout: 5000 })) {
      console.log('Found Person Making Request input, filling it...');
      await personInput.fill("Devin");
    } else {
      console.log('Person Making Request input not found');
    }
    
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: /^next$/i }).click({ timeout: 15000 });
    await page.waitForTimeout(2000);
    await capture(page, 'after-tin-fields');
  } catch (e) {
    console.log('Step 10 TIN fields failed:', e.message);
    await capture(page, 'step-10-tin-fields-failed');
  }

  // Step 9: Property Use select + Mailing address same -> Next
  console.log('Step 9: Looking for Property Use dropdown...');
  // await capture(page, 'before-property-use');
  
  try {
    // Try multiple strategies for Property Use dropdown
    let propertyUseClicked = false;
    
    // Strategy 1: Click the dropdown container div
    try {
      const propertyUseContainer = page.locator('div.q-field__native:has(input[aria-label="*Property Use"])');
      if (await propertyUseContainer.isVisible({ timeout: 3000 })) {
        console.log('Found Property Use container, clicking it...');
        await propertyUseContainer.click({ timeout: 5000 });
        propertyUseClicked = true;
      }
    } catch (e) {
      console.log('Strategy 1 (container) failed:', e.message);
    }
    
    // Strategy 2: Click the readonly input directly
    if (!propertyUseClicked) {
      try {
        const propertyUseInput = page.locator('input[aria-label="*Property Use"]');
        if (await propertyUseInput.isVisible({ timeout: 3000 })) {
          console.log('Found Property Use input, clicking it...');
          await propertyUseInput.click({ timeout: 5000 });
          propertyUseClicked = true;
        }
      } catch (e) {
        console.log('Strategy 2 (input) failed:', e.message);
      }
    }
    
    // Strategy 3: Use JavaScript to click the dropdown
    if (!propertyUseClicked) {
      try {
        console.log('Using JavaScript to click Property Use dropdown...');
        const clicked = await page.evaluate(() => {
          const dropdown = document.querySelector('input[aria-label="*Property Use"]');
          if (dropdown) {
            dropdown.click();
            return true;
          }
          return false;
        });
        if (clicked) {
          console.log('Successfully clicked Property Use dropdown via JavaScript');
          propertyUseClicked = true;
        }
      } catch (e) {
        console.log('Strategy 3 (JavaScript) failed:', e.message);
      }
    }
    
    if (!propertyUseClicked) {
      console.log('Could not click Property Use dropdown');
      await capture(page, 'property-use-dropdown-failed');
    }
    
    // Wait for dropdown to open
    await page.waitForTimeout(2000);
    
    // Select the option
    console.log('Looking for Property Manager option...');
    try {
      const option = page.getByRole("option", { name: /Property Manager needing service between tenants/i });
      if (await option.isVisible({ timeout: 5000 })) {
        console.log('Found Property Manager option, clicking it...');
        await option.click({ timeout: 5000 });
      } else {
        console.log('Property Manager option not found, trying text search...');
        const textOption = page.getByText(/Property Manager needing service between tenants/i);
        if (await textOption.isVisible({ timeout: 3000 })) {
          await textOption.click({ timeout: 5000 });
        }
      }
    } catch (e) {
      console.log('Property Manager option selection failed:', e.message);
      await capture(page, 'property-manager-option-failed');
    }
    
    // Check mailing address checkbox
    console.log('Looking for mailing address checkbox...');
    try {
      const checkbox = page.getByRole("checkbox", { name: /mailing address.*same.*service/i });
      if (await checkbox.isVisible({ timeout: 3000 })) {
        console.log('Found mailing address checkbox, checking it...');
        await checkbox.check({ timeout: 5000 });
      } else {
        console.log('Mailing address checkbox not found, trying container click...');
        await page.locator(".q-checkbox__bg").first().click({ timeout: 5000 });
      }
    } catch (e) {
      console.log('Mailing address checkbox failed:', e.message);
    }
    
    // Click Next
    console.log('Clicking Next button...');
    await page.getByRole("button", { name: /^next$/i }).click({ timeout: 15000 });
    
  } catch (e) {
    console.log('Step 9 failed:', e.message);
    await capture(page, 'step-9-failed');
  }

  // Step 11: Confirm property -> Next
  console.log('Step 11: Looking for Confirm property radio button...');
  // await capture(page, 'before-confirm-property');
  try {
    const confirmPropertyRadio = page.getByLabel(/Confirm property/i);
    if (await confirmPropertyRadio.isVisible({ timeout: 5000 })) {
      console.log('Found Confirm property radio, checking it...');
      await confirmPropertyRadio.check({ timeout: 5000 });
    } else {
      console.log('Confirm property radio not found, trying first radio...');
      await page.locator(".q-radio__bg").first().click({ timeout: 5000 });
    }
    await page.waitForTimeout(1000);
    await page.getByRole("button", { name: /^next$/i }).click({ timeout: 15000 });
    await page.waitForTimeout(2000);
    await capture(page, 'after-confirm-property');
  } catch (e) {
    console.log('Step 11 Confirm property failed:', e.message);
    await capture(page, 'step-11-confirm-property-failed');
  }

  // Step 12: Address + unit -> Search/Next
  console.log('Step 12: Looking for Address field...');
  // await capture(page, 'before-address-fields');
  try {
    const addressInput = page.getByLabel(/^Address$/i);
    if (await addressInput.isVisible({ timeout: 5000 })) {
      console.log('Found Address input, filling it...');
      await addressInput.fill(address);
      await page.waitForTimeout(2000); // Wait for dropdown to appear
      
      // Look for address dropdown/autocomplete options
      console.log('Looking for address dropdown options...');
      await capture(page, 'after-address-input');
      
      try {
        // Strategy 1: Use JavaScript to comprehensively find dropdown options
        console.log('Using JavaScript to find dropdown options...');
        const dropdownResult = await page.evaluate(() => {
          // Look for various dropdown option selectors
          const selectors = [
            'li[role="option"]',
            'div[role="option"]',
            '.q-item',
            '.dropdown-item',
            '[data-testid*="option"]',
            '[data-testid*="suggestion"]',
            '.q-list-item',
            '.q-item-label',
            '.autocomplete-item',
            '.suggestion-item',
            '[class*="option"]',
            '[class*="suggestion"]',
            '[class*="dropdown"]',
            '[class*="list"]'
          ];
          
          let foundElements = [];
          
          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              console.log(`Found ${elements.length} elements with selector: ${selector}`);
              foundElements.push(...Array.from(elements));
            }
          }
          
          // Also look for any clickable elements that might be dropdown items
          const allClickable = document.querySelectorAll('li, div, span, a, button');
          for (const el of allClickable) {
            const text = el.textContent?.trim();
            const style = window.getComputedStyle(el);
            const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
            
            // Look for elements that might be dropdown items based on content and visibility
            if (isVisible && text && text.length > 0 && text.length < 100) {
              // Check if it's likely a dropdown item
              if (el.closest('[role="listbox"]') || 
                  el.closest('.q-list') || 
                  el.closest('.dropdown-menu') ||
                  el.closest('[class*="dropdown"]') ||
                  el.closest('[class*="list"]')) {
                foundElements.push(el);
              }
            }
          }
          
          // Remove duplicates
          foundElements = [...new Set(foundElements)];
          
          console.log(`Total potential dropdown items found: ${foundElements.length}`);
          
          if (foundElements.length > 0) {
            // Try to click the first visible, clickable element
            for (const el of foundElements) {
              if (el.offsetHeight > 0 && !el.disabled) {
                console.log(`Clicking dropdown item: ${el.textContent?.trim()}`);
                el.click();
                return { success: true, clicked: el.textContent?.trim() };
              }
            }
          }
          
          return { success: false, count: foundElements.length };
        });
        
        if (dropdownResult.success) {
          console.log(`Successfully clicked dropdown option: "${dropdownResult.clicked}"`);
          await page.waitForTimeout(2000);
          await capture(page, 'after-dropdown-selection');
        } else {
          console.log(`No clickable dropdown options found (${dropdownResult.count} elements found but none clickable)`);
          await capture(page, 'no-dropdown-selection');
        }
      } catch (e) {
        console.log('Dropdown selection failed:', e.message);
        await capture(page, 'dropdown-selection-failed');
      }
    } else {
      console.log('Address input not found');
    }
    
    if (unit) {
      console.log('Looking for Unit/Apt field...');
      const unitInput = page.getByLabel(/Apt\.?|Unit#|\*Unit#/i).or(page.locator('input[aria-label="*Unit#"]'));
      if (await unitInput.isVisible({ timeout: 5000 })) {
        console.log('Found Unit input, filling it...');
        await unitInput.fill(String(unit));
        await page.waitForTimeout(1000);
        
        // Try to select from autocomplete dropdown
        try {
          const unitOption = page.getByRole("option", { name: new RegExp(`^${escapeRegExp(String(unit))}$`, "i") });
          if (await unitOption.isVisible({ timeout: 3000 })) {
            console.log('Found unit option in dropdown, clicking it...');
            await unitOption.click({ timeout: 3000 });
          }
        } catch (e) {
          console.log('Unit dropdown selection failed:', e.message);
        }
      } else {
        console.log('Unit input not found');
      }
    }
    
    // Click Search button
    try {
      console.log('Looking for Search button...');
      await capture(page, 'before-search-button');
      
      // Strategy 1: Use JavaScript to find and click the correct Search button
      console.log('Using JavaScript to find and click Search button...');
      const searchResult = await page.evaluate(() => {
        // Look for the button with the specific testid first
        const testIdButton = document.querySelector('[data-testid="nee_fpl_connect_service_search_button"]');
        if (testIdButton) {
          console.log('Found Search button by testid');
          testIdButton.click();
          return { found: true, method: 'testid' };
        }
        
        // Look for button with the exact class structure
        const classButton = document.querySelector('button.fplnw-tracking-connect-address-search-button');
        if (classButton) {
          console.log('Found Search button by class');
          classButton.click();
          return { found: true, method: 'class' };
        }
        
        // Look for button containing "Search" text in the specific span structure
        const buttons = document.querySelectorAll('button');
        for (const btn of buttons) {
          const contentSpan = btn.querySelector('span.q-btn__content');
          if (contentSpan) {
            const blockSpan = contentSpan.querySelector('span.block');
            if (blockSpan && blockSpan.textContent.trim() === 'Search') {
              console.log('Found Search button by span structure');
              btn.click();
              return { found: true, method: 'span-structure' };
            }
          }
        }
        
        return { found: false, method: 'none' };
      });
      
      if (searchResult.found) {
        console.log(`Successfully clicked Search button via ${searchResult.method}`);
        await page.waitForTimeout(3000); // Wait longer for page transition
        await capture(page, 'after-search-button');
        
        // Check if we're on a new page or if there are any loading indicators
        try {
          await page.waitForLoadState('networkidle', { timeout: 5000 });
          console.log('Page loaded after search');
        } catch (e) {
          console.log('Page load timeout after search, continuing...');
        }
      } else {
        console.log('Search button not found via any method');
        await capture(page, 'search-button-not-found');
      }
    } catch (e) {
      console.log('Search button click failed:', e.message);
      await capture(page, 'search-button-failed');
    }
    
    // Click Next button
    try {
      const nextButton = page.getByRole("button", { name: /^next$/i });
      if (await nextButton.isVisible({ timeout: 15000 })) {
        console.log('Found Next button, clicking it...');
        await nextButton.click({ timeout: 15000 });
        await page.waitForTimeout(2000);
        await capture(page, 'after-address-next');
      } else {
        console.log('Next button not found after address');
        await capture(page, 'after-address-next-failed');
      }
    } catch (e) {
      console.log('Address Next button failed:', e.message);
      await capture(page, 'after-address-next-failed');
    }
  } catch (e) {
    console.log('Step 12 Address fields failed:', e.message);
    await capture(page, 'step-12-address-fields-failed');
  }

  // Step 13: Confirm
  console.log('Step 13: Looking for Confirm button...');
  // await capture(page, 'before-confirm');
  try {
    // Strategy 1: Look for the specific span structure
    let confirmClicked = false;
    
    try {
      const confirmSpan = page.locator('span.q-btn__content:has(span.block:has-text("Confirm"))');
      if (await confirmSpan.isVisible({ timeout: 5000 })) {
        console.log('Found Confirm button by span structure, clicking it...');
        await confirmSpan.click();
        confirmClicked = true;
      }
    } catch (e) {
      console.log('Strategy 1 (span structure) failed:', e.message);
    }
    
    // Strategy 2: Look for span with "Confirm" text directly
    if (!confirmClicked) {
      try {
        const confirmSpan = page.locator('span.block:has-text("Confirm")');
        if (await confirmSpan.isVisible({ timeout: 5000 })) {
          console.log('Found Confirm span, clicking it...');
          await confirmSpan.click();
          confirmClicked = true;
        }
      } catch (e) {
        console.log('Strategy 2 (span text) failed:', e.message);
      }
    }
    
    // Strategy 3: Use JavaScript to find and click the specific elements
    if (!confirmClicked) {
      try {
        console.log('Using JavaScript to find Confirm button...');
        const jsResult = await page.evaluate(() => {
          // Look for the specific span structure
          const selectors = [
            'span.q-btn__content span.block',
            'span.block',
            'span:has-text("Confirm")',
            '.q-btn__content:has-text("Confirm")'
          ];
          
          for (const selector of selectors) {
            const elements = document.querySelectorAll(selector);
            for (const el of elements) {
              if (el.textContent?.trim() === 'Confirm' && el.offsetHeight > 0) {
                console.log(`Found Confirm element with selector ${selector}: ${el.outerHTML.substring(0, 100)}`);
                el.click();
                return true;
              }
            }
          }
          
          // Also look for any element containing exactly "Confirm"
          const allElements = document.querySelectorAll('*');
          for (const el of allElements) {
            if (el.textContent?.trim() === 'Confirm' && el.offsetHeight > 0 && !el.disabled) {
              console.log(`Found Confirm text element: ${el.tagName} - ${el.className}`);
              el.click();
              return true;
            }
          }
          
          return false;
        });
        
        if (jsResult) {
          console.log('Successfully clicked Confirm button via JavaScript');
          confirmClicked = true;
        }
      } catch (e) {
        console.log('Strategy 3 (JavaScript) failed:', e.message);
      }
    }
    
  if (confirmClicked) {
    console.log('Confirm button clicked successfully');
    await page.waitForTimeout(3000);
    await capture(page, 'after-confirm');
    
    // Step 13.5: Handle Unit/Apt number if provided
    if (unit) {
      console.log('Step 13.5: Handling Unit/Apt number...');
      await capture(page, 'before-unit-entry');
      
      try {
        // Look for the Unit# input field
        const unitInput = page.locator('input[aria-label="*Unit#"]');
        if (await unitInput.isVisible({ timeout: 5000 })) {
          console.log('Found Unit# input, filling it...');
          await unitInput.fill(unit);
          await page.waitForTimeout(2000); // Wait for dropdown to appear
          
          // Look for unit dropdown options and select first one
          console.log('Looking for unit dropdown options...');
          try {
            const unitDropdownResult = await page.evaluate(() => {
              // Look for dropdown options
              const selectors = [
                'li[role="option"]',
                'div[role="option"]',
                '.q-item',
                '.dropdown-item',
                '[class*="option"]',
                '[class*="suggestion"]'
              ];
              
              for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                if (elements.length > 0) {
                  console.log(`Found ${elements.length} unit dropdown elements with selector: ${selector}`);
                  const firstElement = elements[0];
                  if (firstElement.offsetHeight > 0 && !firstElement.disabled) {
                    console.log(`Clicking unit dropdown item: ${firstElement.textContent?.trim()}`);
                    firstElement.click();
                    return { success: true, clicked: firstElement.textContent?.trim() };
                  }
                }
              }
              
              return { success: false };
            });
            
            if (unitDropdownResult.success) {
              console.log(`Successfully clicked unit dropdown option: "${unitDropdownResult.clicked}"`);
              await page.waitForTimeout(1000);
            } else {
              console.log('No unit dropdown options found, continuing...');
            }
          } catch (e) {
            console.log('Unit dropdown selection failed:', e.message);
          }
          
          // Click Next button
          console.log('Looking for Next button after unit selection...');
          try {
            const nextButton = page.locator('span.block:has-text("Next")');
            if (await nextButton.isVisible({ timeout: 5000 })) {
              console.log('Found Next button, clicking it...');
              await nextButton.click();
              await page.waitForTimeout(3000);
              await capture(page, 'after-unit-next');
            } else {
              console.log('Next button not found after unit selection');
            }
          } catch (e) {
            console.log('Next button click failed:', e.message);
          }
        } else {
          console.log('Unit# input not found');
        }
      } catch (e) {
        console.log('Unit handling failed:', e.message);
        await capture(page, 'unit-handling-failed');
      }
    } else {
      console.log('No unit number provided, skipping unit handling step');
    }
    
    console.log('Waiting for status page to load (5+ seconds)...');
    await page.waitForTimeout(8000); // Wait 8 seconds for status page to load
  } else {
    console.log('Confirm button not found with any strategy');
    await capture(page, 'confirm-click-failed');
  }
  } catch (e) {
    console.log('Step 13 Confirm failed:', e.message);
    await capture(page, 'confirm-click-failed');
  }

  // Step 14: Read statuses
  console.log('Step 14: Looking for Meter Status and Property Status...');
  // await capture(page, 'before-status-reading');
  let meterStatus = "";
  let propertyStatus = "";
  try {
    const meterLabel = page.getByText(/Meter Status/i).first();
    if (await meterLabel.isVisible({ timeout: 5000 })) {
      meterStatus = await meterLabel.locator('xpath=following::*[1]').innerText({ timeout: 5000 });
      console.log('Found Meter Status:', meterStatus);
    } else {
      console.log('Meter Status label not found');
    }
  } catch (e) {
    console.log('Meter Status reading failed:', e.message);
  }
  
  try {
    // First try the specific selector for the p element with classes
    const propStatusElement = page.locator('p.nee-fpl-property-status');
    if (await propStatusElement.isVisible({ timeout: 5000 })) {
      propertyStatus = await propStatusElement.innerText({ timeout: 5000 });
      console.log('Found Property Status (specific selector):', propertyStatus);
    } else {
      console.log('Property Status element not found with specific selector, trying fallback...');
      
      // Fallback: Look for Property Status label and following element
      const propLabel = page.getByText(/Property Status/i).first();
      if (await propLabel.isVisible({ timeout: 5000 })) {
        propertyStatus = await propLabel.locator('xpath=following::*[1]').innerText({ timeout: 5000 });
        console.log('Found Property Status (fallback):', propertyStatus);
      } else {
        console.log('Property Status label not found');
      }
    }
  } catch (e) {
    console.log('Property Status reading failed:', e.message);
  }
  
  await capture(page, 'after-status-reading');

  return {
    meterStatus: meterStatus || "Not found",
    propertyStatus: propertyStatus || "Not found",
  };
}

async function processNextAddress({ page, tin, address, unit }) {
  console.log('Processing next address using "Not the right address?" flow...');
  
  try {
    // Step 16: Click "Not the right address?" link
    console.log('Step 16: Looking for "Not the right address?" link...');
    // await capture(page, 'before-not-right-address');
    
    // Try multiple selectors for the "Not the right address?" link
    let notRightAddressLink = null;
    const selectors = [
      'a.text-weight-bold.text-primary:has-text("Not the right address?")',
      'a:has-text("Not the right address?")',
      'a[href="javascript:void(0);"]:has-text("Not the right address?")',
      'a.text-primary:has-text("Not the right address?")'
    ];
    
    for (const selector of selectors) {
      try {
        const link = page.locator(selector);
        if (await link.isVisible({ timeout: 5000 })) {
          console.log(`Found "Not the right address?" link with selector: ${selector}`);
          notRightAddressLink = link;
          break;
        }
      } catch (e) {
        console.log(`Selector ${selector} failed:`, e.message);
      }
    }
    
    if (notRightAddressLink) {
      console.log('Clicking "Not the right address?" link...');
      await notRightAddressLink.click();
      await page.waitForTimeout(3000);
      await capture(page, 'after-not-right-address-click');
    } else {
      console.log('"Not the right address?" link not found with any selector, falling back to full flow');
      console.log('Current page URL:', page.url());
      console.log('Current page title:', await page.title());
      return await performPostLoginFlow({ page, tin, address, unit });
    }
    
    // Now we should be back at Step 12 (Address entry)
    console.log('Step 12 (repeat): Looking for Address field...');
    // await capture(page, 'before-repeat-address-fields');
    
    try {
      const addressInput = page.getByLabel(/^Address$/i);
      if (await addressInput.isVisible({ timeout: 5000 })) {
        console.log('Found Address input, filling it...');
        await addressInput.fill(address);
        await page.waitForTimeout(2000); // Wait for dropdown to appear
        
        // Look for address dropdown/autocomplete options
        console.log('Looking for address dropdown options...');
        await capture(page, 'after-repeat-address-input');
        
        try {
          // Use JavaScript to comprehensively find dropdown options
          console.log('Using JavaScript to find dropdown options...');
          const dropdownResult = await page.evaluate(() => {
            // Look for various dropdown option selectors
            const selectors = [
              'li[role="option"]',
              'div[role="option"]',
              '.q-item',
              '.dropdown-item',
              '[data-testid*="option"]',
              '[data-testid*="suggestion"]',
              '.q-list-item',
              '.q-item-label',
              '.autocomplete-item',
              '.suggestion-item',
              '[class*="option"]',
              '[class*="suggestion"]',
              '[class*="dropdown"]',
              '[class*="list"]'
            ];
            
            let foundElements = [];
            
            for (const selector of selectors) {
              const elements = document.querySelectorAll(selector);
              if (elements.length > 0) {
                console.log(`Found ${elements.length} elements with selector: ${selector}`);
                foundElements.push(...Array.from(elements));
              }
            }
            
            // Also look for any clickable elements that might be dropdown items
            const allClickable = document.querySelectorAll('li, div, span, a, button');
            for (const el of allClickable) {
              const text = el.textContent?.trim();
              const style = window.getComputedStyle(el);
              const isVisible = style.display !== 'none' && style.visibility !== 'hidden' && el.offsetHeight > 0;
              
              // Look for elements that might be dropdown items based on content and visibility
              if (isVisible && text && text.length > 0 && text.length < 100) {
                // Check if it's likely a dropdown item
                if (el.closest('[role="listbox"]') || 
                    el.closest('.q-list') || 
                    el.closest('.dropdown-menu') ||
                    el.closest('[class*="dropdown"]') ||
                    el.closest('[class*="list"]')) {
                  foundElements.push(el);
                }
              }
            }
            
            // Remove duplicates
            foundElements = [...new Set(foundElements)];
            
            console.log(`Total potential dropdown items found: ${foundElements.length}`);
            
            if (foundElements.length > 0) {
              // Try to click the first visible, clickable element
              for (const el of foundElements) {
                if (el.offsetHeight > 0 && !el.disabled) {
                  console.log(`Clicking dropdown item: ${el.textContent?.trim()}`);
                  el.click();
                  return { success: true, clicked: el.textContent?.trim() };
                }
              }
            }
            
            return { success: false, count: foundElements.length };
          });
          
          if (dropdownResult.success) {
            console.log(`Successfully clicked dropdown option: "${dropdownResult.clicked}"`);
            await page.waitForTimeout(2000);
            await capture(page, 'after-repeat-dropdown-selection');
          } else {
            console.log(`No clickable dropdown options found (${dropdownResult.count} elements found but none clickable)`);
            await capture(page, 'no-repeat-dropdown-selection');
          }
        } catch (e) {
          console.log('Dropdown selection failed:', e.message);
          await capture(page, 'repeat-dropdown-selection-failed');
        }
      } else {
        console.log('Address input not found');
      }
      
      if (unit) {
        console.log('Looking for Unit/Apt field...');
        const unitInput = page.getByLabel(/Apt\.?|Unit#|\*Unit#/i).or(page.locator('input[aria-label="*Unit#"]'));
        if (await unitInput.isVisible({ timeout: 5000 })) {
          console.log('Found Unit input, filling it...');
          await unitInput.fill(unit);
          await page.waitForTimeout(1000);
        } else {
          console.log('Unit input not found');
        }
      }
      
      // Click Search button
      console.log('Looking for Search button...');
      try {
        const searchButton = page.locator('[data-testid="nee_fpl_connect_service_search_button"]');
        if (await searchButton.isVisible({ timeout: 5000 })) {
          console.log('Found Search button by testid, clicking it...');
          await searchButton.click();
        } else {
          // Fallback strategies
          const searchSpan = page.locator('span.block:has-text("Search")');
          if (await searchSpan.isVisible({ timeout: 3000 })) {
            console.log('Found Search span, clicking it...');
            await searchSpan.click();
          } else {
            // JavaScript fallback
            console.log('Using JavaScript to find and click Search button...');
            await page.evaluate(() => {
              const selectors = [
                '[data-testid="nee_fpl_connect_service_search_button"]',
                'button:has(span:has-text("Search"))',
                'span:has-text("Search")',
                '.q-btn:has-text("Search")'
              ];
              
              for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                  if (el.offsetHeight > 0 && !el.disabled) {
                    console.log(`Found Search element: ${el.outerHTML.substring(0, 100)}`);
                    el.click();
                    return true;
                  }
                }
              }
              return false;
            });
          }
        }
        await page.waitForTimeout(3000);
        console.log('Page loaded after search');
        await capture(page, 'after-repeat-search');
      } catch (e) {
        console.log('Search button click failed:', e.message);
      }
      
      // Click Confirm button
      console.log('Looking for Confirm button...');
      // await capture(page, 'before-repeat-confirm');
      try {
        // Strategy 1: Look for the specific span structure
        let confirmClicked = false;
        
        try {
          const confirmSpan = page.locator('span.q-btn__content:has(span.block:has-text("Confirm"))');
          if (await confirmSpan.isVisible({ timeout: 5000 })) {
            console.log('Found Confirm button by span structure, clicking it...');
            await confirmSpan.click();
            confirmClicked = true;
          }
        } catch (e) {
          console.log('Strategy 1 (span structure) failed:', e.message);
        }
        
        // Strategy 2: Look for span with "Confirm" text directly
        if (!confirmClicked) {
          try {
            const confirmSpan = page.locator('span.block:has-text("Confirm")');
            if (await confirmSpan.isVisible({ timeout: 5000 })) {
              console.log('Found Confirm span, clicking it...');
              await confirmSpan.click();
              confirmClicked = true;
            }
          } catch (e) {
            console.log('Strategy 2 (span text) failed:', e.message);
          }
        }
        
        // Strategy 3: Use JavaScript to find and click the specific elements
        if (!confirmClicked) {
          try {
            console.log('Using JavaScript to find Confirm button...');
            const jsResult = await page.evaluate(() => {
              // Look for the specific span structure
              const selectors = [
                'span.q-btn__content span.block',
                'span.block',
                'span:has-text("Confirm")',
                '.q-btn__content:has-text("Confirm")'
              ];
              
              for (const selector of selectors) {
                const elements = document.querySelectorAll(selector);
                for (const el of elements) {
                  if (el.textContent?.trim() === 'Confirm' && el.offsetHeight > 0) {
                    console.log(`Found Confirm element with selector ${selector}: ${el.outerHTML.substring(0, 100)}`);
                    el.click();
                    return true;
                  }
                }
              }
              
              // Also look for any element containing exactly "Confirm"
              const allElements = document.querySelectorAll('*');
              for (const el of allElements) {
                if (el.textContent?.trim() === 'Confirm' && el.offsetHeight > 0 && !el.disabled) {
                  console.log(`Found Confirm text element: ${el.tagName} - ${el.className}`);
                  el.click();
                  return true;
                }
              }
              
              return false;
            });
            
            if (jsResult) {
              console.log('Successfully clicked Confirm button via JavaScript');
              confirmClicked = true;
            }
          } catch (e) {
            console.log('Strategy 3 (JavaScript) failed:', e.message);
          }
        }
        
        if (confirmClicked) {
          console.log('Confirm button clicked successfully');
          await page.waitForTimeout(3000);
          await capture(page, 'after-repeat-confirm');
          
          // Handle Unit/Apt number if provided (Step 13.5)
          if (unit) {
            console.log('Step 13.5 (repeat): Handling Unit/Apt number...');
            await capture(page, 'before-repeat-unit-entry');
            
            try {
              // Look for the Unit# input field
              const unitInput = page.locator('input[aria-label="*Unit#"]');
              if (await unitInput.isVisible({ timeout: 5000 })) {
                console.log('Found Unit# input, filling it...');
                await unitInput.fill(unit);
                await page.waitForTimeout(2000); // Wait for dropdown to appear
                
                // Look for unit dropdown options and select first one
                console.log('Looking for unit dropdown options...');
                try {
                  const unitDropdownResult = await page.evaluate(() => {
                    // Look for dropdown options
                    const selectors = [
                      'li[role="option"]',
                      'div[role="option"]',
                      '.q-item',
                      '.dropdown-item',
                      '[class*="option"]',
                      '[class*="suggestion"]'
                    ];
                    
                    for (const selector of selectors) {
                      const elements = document.querySelectorAll(selector);
                      if (elements.length > 0) {
                        console.log(`Found ${elements.length} unit dropdown elements with selector: ${selector}`);
                        const firstElement = elements[0];
                        if (firstElement.offsetHeight > 0 && !firstElement.disabled) {
                          console.log(`Clicking unit dropdown item: ${firstElement.textContent?.trim()}`);
                          firstElement.click();
                          return { success: true, clicked: firstElement.textContent?.trim() };
                        }
                      }
                    }
                    
                    return { success: false };
                  });
                  
                  if (unitDropdownResult.success) {
                    console.log(`Successfully clicked unit dropdown option: "${unitDropdownResult.clicked}"`);
                    await page.waitForTimeout(1000);
                  } else {
                    console.log('No unit dropdown options found, continuing...');
                  }
                } catch (e) {
                  console.log('Unit dropdown selection failed:', e.message);
                }
                
                // Click Next button
                console.log('Looking for Next button after unit selection...');
                try {
                  const nextButton = page.locator('span.block:has-text("Next")');
                  if (await nextButton.isVisible({ timeout: 5000 })) {
                    console.log('Found Next button, clicking it...');
                    await nextButton.click();
                    await page.waitForTimeout(3000);
                    await capture(page, 'after-repeat-unit-next');
                  } else {
                    console.log('Next button not found after unit selection');
                  }
                } catch (e) {
                  console.log('Next button click failed:', e.message);
                }
              } else {
                console.log('Unit# input not found');
              }
            } catch (e) {
              console.log('Unit handling failed:', e.message);
              await capture(page, 'repeat-unit-handling-failed');
            }
          }
          
          console.log('Waiting for status page to load (5+ seconds)...');
          await page.waitForTimeout(8000); // Wait 8 seconds for status page to load
        } else {
          console.log('Confirm button not found with any strategy');
          await capture(page, 'repeat-confirm-click-failed');
        }
      } catch (e) {
        console.log('Step 13 Confirm failed:', e.message);
        await capture(page, 'repeat-confirm-click-failed');
      }
      
      // Read statuses (Step 14)
      console.log('Step 14 (repeat): Looking for Meter Status and Property Status...');
      // await capture(page, 'before-repeat-status-reading');
      let meterStatus = "";
      let propertyStatus = "";
      
      try {
        const meterLabel = page.getByText(/Meter Status/i).first();
        if (await meterLabel.isVisible({ timeout: 5000 })) {
          meterStatus = await meterLabel.locator('xpath=following::*[1]').innerText({ timeout: 5000 });
          console.log('Found Meter Status:', meterStatus);
        } else {
          console.log('Meter Status label not found');
        }
      } catch (e) {
        console.log('Meter Status reading failed:', e.message);
      }
      
      try {
        // First try the specific selector for the p element with classes
        const propStatusElement = page.locator('p.nee-fpl-property-status');
        if (await propStatusElement.isVisible({ timeout: 5000 })) {
          propertyStatus = await propStatusElement.innerText({ timeout: 5000 });
          console.log('Found Property Status (specific selector):', propertyStatus);
        } else {
          console.log('Property Status element not found with specific selector, trying fallback...');
          
          // Fallback: Look for Property Status label and following element
          const propLabel = page.getByText(/Property Status/i).first();
          if (await propLabel.isVisible({ timeout: 5000 })) {
            propertyStatus = await propLabel.locator('xpath=following::*[1]').innerText({ timeout: 5000 });
            console.log('Found Property Status (fallback):', propertyStatus);
          } else {
            console.log('Property Status label not found');
          }
        }
      } catch (e) {
        console.log('Property Status reading failed:', e.message);
      }
      
      await capture(page, 'after-repeat-status-reading');
      
      return {
        meterStatus: meterStatus || "Not found",
        propertyStatus: propertyStatus || "Not found",
      };
    } catch (e) {
      console.log('Repeat address processing failed:', e.message);
      return {
        meterStatus: "Not found",
        propertyStatus: "Not found",
      };
    }
  } catch (e) {
    console.log('processNextAddress failed:', e.message);
    return {
      meterStatus: "Not found",
      propertyStatus: "Not found",
    };
  }
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function clickAdditionalServiceSafe(page) {
  // Wait for page to be fully interactive
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000); // Extra wait for slow site
  
  console.log('Trying to find Additional Service element...');
  
  // Strategy 1: role=link with shorter timeout to fail fast
  try {
    const link = page.getByRole("link", { name: /Additional Service/i });
    if (await link.isVisible({ timeout: 3000 })) {
      console.log('Found Additional Service link via role=link');
      await link.click({ timeout: 5000 });
      return;
    }
  } catch (e) {
    console.log('Strategy 1 failed:', e.message);
  }
  
  // Strategy 2: role=button with shorter timeout
  try {
    const btn = page.getByRole("button", { name: /Additional Service/i });
    if (await btn.isVisible({ timeout: 3000 })) {
      console.log('Found Additional Service button via role=button');
      await btn.click({ timeout: 5000 });
      return;
    }
  } catch (e) {
    console.log('Strategy 2 failed:', e.message);
  }
  
  // Strategy 3: class-based anchor with inner span text
  try {
    const anchor = page.locator('a.q-btn:has(span:has-text("Additional Service"))');
    if (await anchor.first().isVisible({ timeout: 3000 })) {
      console.log('Found Additional Service via CSS selector');
      await anchor.first().click({ timeout: 5000 });
      return;
    }
  } catch (e) {
    console.log('Strategy 3 failed:', e.message);
  }
  
  // Strategy 4: Try CSS selector for the specific button structure
  try {
    const cssButton = page.locator('a.nee-fpl-cta-btn-primary:has(span:has-text("Additional Service"))');
    if (await cssButton.first().isVisible({ timeout: 3000 })) {
      console.log('Found Additional Service via specific CSS class');
      await cssButton.first().click({ timeout: 5000 });
      return;
    }
  } catch (e) {
    console.log('Strategy 4 failed:', e.message);
  }
  
  // Strategy 5: find any text then click nearest actionable ancestor
  try {
    const textNode = page.getByText(/Additional Service/i);
    if (await textNode.first().isVisible({ timeout: 3000 })) {
      console.log('Found Additional Service text, looking for clickable ancestor');
      const actionable = textNode.first().locator('xpath=ancestor::a|ancestor::button');
      if (await actionable.first().isVisible({ timeout: 3000 })) {
        await actionable.first().click({ timeout: 5000 });
        return;
      }
    }
  } catch (e) {
    console.log('Strategy 5 failed:', e.message);
  }
  
  // Strategy 6: Try partial text match
  try {
    const partialText = page.getByText(/Additional/i);
    if (await partialText.first().isVisible({ timeout: 3000 })) {
      console.log('Found partial Additional text, looking for clickable ancestor');
      const actionable = partialText.first().locator('xpath=ancestor::a|ancestor::button');
      if (await actionable.first().isVisible({ timeout: 3000 })) {
        await actionable.first().click({ timeout: 5000 });
        return;
      }
    }
  } catch (e) {
    console.log('Strategy 6 failed:', e.message);
  }
  
  // Strategy 7: Look for any clickable element containing "Service"
  try {
    const serviceElements = page.locator('a, button').filter({ hasText: /Service/i });
    const count = await serviceElements.count();
    console.log(`Found ${count} elements containing "Service"`);
    
    for (let i = 0; i < count; i++) {
      const element = serviceElements.nth(i);
      const text = await element.textContent();
      console.log(`Element ${i}: "${text}"`);
      if (text && text.toLowerCase().includes('additional')) {
        console.log(`Clicking element with text: "${text}"`);
        await element.click({ timeout: 5000 });
        return;
      }
    }
  } catch (e) {
    console.log('Strategy 7 failed:', e.message);
  }
  
  console.log('All strategies failed, Additional Service element not found');
  throw new Error('Could not find "Additional Service" link/button after trying all strategies');
}

async function clickAdditionalService(page) {
  // Wait for page to be fully interactive
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(3000); // Extra wait for slow site
  
  console.log('Trying to find Additional Service element...');
  
  // Strategy 1: role=link with shorter timeout to fail fast
  try {
    const link = page.getByRole("link", { name: /Additional Service/i });
    if (await link.isVisible({ timeout: 3000 })) {
      console.log('Found Additional Service link via role=link');
      await link.click({ timeout: 5000 });
      return;
    }
  } catch (e) {
    console.log('Strategy 1 failed:', e.message);
  }
  
  // Strategy 2: role=button with shorter timeout
  try {
    const btn = page.getByRole("button", { name: /Additional Service/i });
    if (await btn.isVisible({ timeout: 3000 })) {
      console.log('Found Additional Service button via role=button');
      await btn.click({ timeout: 5000 });
      return;
    }
  } catch (e) {
    console.log('Strategy 2 failed:', e.message);
  }
  
  // Strategy 3: class-based anchor with inner span text
  try {
    const anchor = page.locator('a.q-btn:has(span:has-text("Additional Service"))');
    if (await anchor.first().isVisible({ timeout: 3000 })) {
      console.log('Found Additional Service via CSS selector');
      await anchor.first().click({ timeout: 5000 });
      return;
    }
  } catch (e) {
    console.log('Strategy 3 failed:', e.message);
  }
  
  // Strategy 4: Try CSS selector for the specific button structure
  try {
    const cssButton = page.locator('a.nee-fpl-cta-btn-primary:has(span:has-text("Additional Service"))');
    if (await cssButton.first().isVisible({ timeout: 3000 })) {
      console.log('Found Additional Service via specific CSS class');
      await cssButton.first().click({ timeout: 5000 });
      return;
    }
  } catch (e) {
    console.log('Strategy 4 failed:', e.message);
  }
  
  // Strategy 5: find any text then click nearest actionable ancestor
  try {
    const textNode = page.getByText(/Additional Service/i);
    if (await textNode.first().isVisible({ timeout: 3000 })) {
      console.log('Found Additional Service text, looking for clickable ancestor');
      const actionable = textNode.first().locator('xpath=ancestor::a|ancestor::button');
      if (await actionable.first().isVisible({ timeout: 3000 })) {
        await actionable.first().click({ timeout: 5000 });
        return;
      }
    }
  } catch (e) {
    console.log('Strategy 5 failed:', e.message);
  }
  
  // Strategy 6: Try partial text match
  try {
    const partialText = page.getByText(/Additional/i);
    if (await partialText.first().isVisible({ timeout: 3000 })) {
      console.log('Found partial Additional text, looking for clickable ancestor');
      const actionable = partialText.first().locator('xpath=ancestor::a|ancestor::button');
      if (await actionable.first().isVisible({ timeout: 3000 })) {
        await actionable.first().click({ timeout: 5000 });
        return;
      }
    }
  } catch (e) {
    console.log('Strategy 6 failed:', e.message);
  }
  
  // Strategy 7: Look for any clickable element containing "Service"
  try {
    const serviceElements = page.locator('a, button').filter({ hasText: /Service/i });
    const count = await serviceElements.count();
    console.log(`Found ${count} elements containing "Service"`);
    
    for (let i = 0; i < count; i++) {
      const element = serviceElements.nth(i);
      const text = await element.textContent();
      console.log(`Element ${i}: "${text}"`);
      if (text && text.toLowerCase().includes('additional')) {
        console.log(`Clicking element with text: "${text}"`);
        await element.click({ timeout: 5000 });
        return;
      }
    }
  } catch (e) {
    console.log('Strategy 7 failed:', e.message);
  }
  
  console.log('All strategies failed, Additional Service element not found');
  throw new Error('Could not find "Additional Service" link/button after trying all strategies');
}

async function clearArtifacts() {
  try {
    const dir = path.join(process.cwd(), 'artifacts');
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        fs.unlinkSync(path.join(dir, file));
      }
      console.log(`Cleared ${files.length} files from artifacts folder`);
    }
  } catch (error) {
    console.log('Error clearing artifacts folder:', error.message);
  }
}

async function capture(page, label) {
  try {
    const dir = path.join(process.cwd(), 'artifacts');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: path.join(dir, `${Date.now()}-${label}.png`), fullPage: true });
  } catch {}
}


