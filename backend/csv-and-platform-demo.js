const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = __dirname;
const errors = [];

const csvContent = [
  'Backend Engineer',
  'Frontend Developer,react frontend engineer,Remote',
  'Data Scientist,data scientist ml,New York',
].join('\n');
const csvPath = path.join(SHOT_DIR, 'roles.csv');
fs.writeFileSync(csvPath, csvContent);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  const email = `combo_test_${Date.now()}@example.com`;

  await page.goto('http://localhost:4200/register', { waitUntil: 'networkidle' });
  await page.fill('#name', 'Combo Test');
  await page.fill('#email', email);
  await page.fill('#password', 'password123');
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 10000 });

  // --- Platform login hub + dedicated page ---
  await page.click('a[routerLink="/credentials"]');
  await page.waitForSelector('text=Platform Logins');
  await page.screenshot({ path: path.join(SHOT_DIR, 'p1-hub.png'), fullPage: true });

  await page.click('a:has-text("LinkedIn")');
  await page.waitForURL('**/credentials/linkedin');
  await page.waitForSelector('#username');
  await page.fill('#username', 'me@example.com');
  await page.fill('#password', 'my-linkedin-password');
  await page.click('button:has-text("Save")');
  await page.waitForSelector('text=Saved.');
  await page.screenshot({ path: path.join(SHOT_DIR, 'p2-linkedin-page.png'), fullPage: true });

  await page.click('a:has-text("All platform logins")');
  await page.waitForURL('**/credentials');
  await page.waitForSelector('text=Connected');
  await page.screenshot({ path: path.join(SHOT_DIR, 'p3-hub-connected.png'), fullPage: true });

  // --- CSV bulk import ---
  await page.click('a[routerLink="/filters"]');
  await page.waitForSelector('#name');
  await page.click('.checkbox-pill:has-text("LINKEDIN")');
  await page.setInputFiles('input[type="file"]', csvPath);
  await page.click('button:has-text("Import CSV")');
  await page.waitForSelector('text=Imported', { timeout: 15000 });
  await page.screenshot({ path: path.join(SHOT_DIR, 'p4-csv-imported.png'), fullPage: true });

  await browser.close();
  fs.unlinkSync(csvPath);
  console.log('DONE');
  console.log('Console errors:', errors.length ? errors : 'none');
})().catch((err) => {
  console.error('COMBO DEMO FAILED:', err);
  process.exit(1);
});
