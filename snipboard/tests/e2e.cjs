// End-to-end check of the real Electron app. Run with: npm run test:e2e
const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'snip-e2e-'));
  const shots = process.env.SHOTS;
  const launch = () => electron.launch({ executablePath: require('electron'), args: ['.', '--no-sandbox', '--user-data-dir=' + userData], cwd: path.join(__dirname, '..') });
  let app = await launch();
  let page = await app.firstWindow();
  const errors = [];
  const watch = (p) => { p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); }); };
  watch(page);
  const clip = () => app.evaluate(({ clipboard }) => ({ text: clipboard.readText(), html: clipboard.readHTML() }));
  const fill = async (label, value) => page.locator('dialog').getByLabel(label).fill(value);
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };

  // First-run setup
  await page.getByLabel('Admin password (can add, edit and delete)').fill('admin123');
  await page.getByLabel('Repeat Admin password').fill('admin123');
  await page.getByLabel('Operator password (can only view and copy)').fill('admin123');
  await page.getByLabel('Repeat Operator password').fill('admin123');
  await page.getByRole('button', { name: 'Create and open' }).click();
  await page.getByText('must be different').waitFor();
  await page.getByLabel('Operator password (can only view and copy)').fill('oper123');
  await page.getByLabel('Repeat Operator password').fill('oper123');
  await page.getByRole('button', { name: 'Create and open' }).click();
  await page.getByText('Admin', { exact: true }).waitFor();

  // Folders and items
  await page.getByRole('button', { name: '+ Folder' }).click();
  await fill('Folder name', 'Company');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('button', { name: '+ Subfolder' }).click();
  await fill('Folder name', 'Bank');
  await page.getByRole('button', { name: 'Create' }).click();
  await page.getByRole('heading', { name: 'Home / Company / Bank' }).waitFor();
  await page.getByRole('button', { name: '+ New item' }).click();
  await fill('Name (shown on the button)', 'Account no');
  await fill('Text to copy', '000111222333');
  await page.locator('dialog').getByLabel(/Sensitive/).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByText('••••••••').waitFor();
  assert.equal(await page.getByText('000111222333').count(), 0, 'sensitive value hidden');

  await page.getByRole('navigation').getByRole('button', { name: /Company/ }).click();
  await page.getByRole('button', { name: '+ New item' }).click();
  await fill('Name (shown on the button)', 'Compny');
  await fill('Text to copy', 'acme INDUSTRIES pvt ltd');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await fill('New name', 'Company name');
  await page.locator('dialog').getByRole('button', { name: 'Rename' }).click();
  const tile = page.locator('.tile', { hasText: 'Company name' });
  await tile.waitFor();

  // One-click copy in each style
  const expect = { Normal: 'acme INDUSTRIES pvt ltd', BIG: 'ACME INDUSTRIES PVT LTD', small: 'acme industries pvt ltd',
    'First capital': 'Acme industries pvt ltd', 'Each Word': 'Acme Industries Pvt Ltd' };
  for (const [chip, want] of Object.entries(expect)) {
    await page.locator('.stylebar').getByRole('button', { name: chip, exact: true }).click();
    await page.locator('.tile', { hasText: 'Company name' }).locator('.name').click();
    await page.waitForTimeout(150);
    assert.equal((await clip()).text, want, chip);
  }
  await page.locator('.stylebar').getByRole('button', { name: 'Italic', exact: true }).click();
  await page.locator('.tile .name').click(); await page.waitForTimeout(150);
  let c = await clip();
  assert.equal(c.text, 'acme INDUSTRIES pvt ltd');
  assert.match(c.html, /<i>acme INDUSTRIES pvt ltd<\/i>/);
  await page.locator('.stylebar').getByRole('button', { name: 'Italic ✱' }).click();
  await page.locator('.tile .name').click(); await page.waitForTimeout(150);
  assert.ok((await clip()).text.startsWith('\u{1d622}\u{1d624}\u{1d62e}\u{1d626} '), 'unicode italic');
  await page.locator('.stylebar').getByRole('button', { name: 'Normal' }).click();
  await shot('1-board');

  // "Copy as…" menu
  await page.getByRole('button', { name: 'Copy as…' }).click();
  await shot('2-copy-as');
  await page.locator('dialog').getByRole('button', { name: /^BIG/ }).click(); await page.waitForTimeout(150);
  assert.equal((await clip()).text, 'ACME INDUSTRIES PVT LTD');

  // Search finds across folders, including by folder name
  await page.getByLabel('Search all items').fill('account');
  await page.getByText('Home / Company / Bank').waitFor();
  await page.getByLabel('Search all items').fill('');

  // Settings: clipboard clear + CSV import
  await page.getByRole('button', { name: 'Settings' }).click();
  await shot('3-settings');
  await page.getByLabel('Clear clipboard after').selectOption('15');
  await page.getByLabel('Which items').selectOption('all');
  const csv = path.join(userData, 'in.csv');
  fs.writeFileSync(csv, 'Folder,Name,Value,Sensitive\r\nCompany / Tax,GST,27ABCDE1234F1Z5,no\r\nCompany,Company name,acme INDUSTRIES pvt ltd,no\r\n,,x,\r\n');
  let chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import from Excel or CSV…' }).click();
  await (await chooser).setFiles(csv);
  await page.getByText('1 new item(s) will be added. 1 already exist and 1 row(s)').waitFor();
  await page.locator('dialog').getByRole('button', { name: 'Import' }).click();
  await page.getByRole('button', { name: 'Items', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: /Tax/ }).click();
  await page.locator('.tile', { hasText: 'GST' }).waitFor();

  // Excel import (when a sample workbook is supplied)
  if (process.env.XLSX) {
    await page.getByRole('button', { name: 'Settings' }).click();
    chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import from Excel or CSV…' }).click();
    await (await chooser).setFiles(process.env.XLSX);
    await page.locator('dialog').getByRole('button', { name: 'Import' }).click();
    await page.getByRole('button', { name: 'Items', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: /FromExcel/ }).click();
    await page.locator('.tile', { hasText: 'Phone' }).waitFor();
  }

  // Text tools
  await page.getByRole('button', { name: 'Text tools' }).click();
  await page.getByLabel('Text to convert').fill('hello WORLD');
  await page.locator('.panel').getByRole('button', { name: 'Each Word' }).click(); await page.waitForTimeout(150);
  assert.equal((await clip()).text, 'Hello World');
  await shot('4-text-tools');

  // Mini window stays on top
  await page.getByRole('button', { name: 'Mini window' }).click();
  await page.getByRole('button', { name: 'Full window' }).waitFor();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), true);
  await page.getByRole('button', { name: 'Items', exact: true }).click();
  await page.waitForTimeout(300);
  await shot('5-mini');
  await page.getByRole('button', { name: 'Full window' }).click();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), false);

  // Data on disk is encrypted
  const raw = fs.readFileSync(path.join(userData, 'snipboard-vault.json'), 'utf8');
  assert.ok(!/acme|000111222333|GST/i.test(raw), 'vault file is encrypted');

  // Restart: data persists, operator is read-only
  await app.close();
  app = await launch(); page = await app.firstWindow(); watch(page);
  await page.getByLabel('Password').fill('nope');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByText('Wrong password.').waitFor();
  await shot('6-login');
  await page.getByLabel('Password').fill('oper123');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByText('Operator', { exact: true }).waitFor();
  await page.getByRole('navigation').getByRole('button', { name: /Company/ }).click();
  await page.locator('.tile', { hasText: 'Company name' }).waitFor();
  for (const name of ['+ New item', 'Rename', 'Edit', 'Delete', 'Settings', 'Rename folder'])
    assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, 'operator has no ' + name);
  await page.getByRole('navigation').getByRole('button', { name: /Bank/ }).click();
  await page.locator('.tile .name').click(); await page.waitForTimeout(150);
  assert.equal((await clip()).text, '000111222333');
  await shot('7-operator');

  // Lock button
  await page.getByRole('button', { name: 'Lock' }).click();
  await page.getByRole('button', { name: 'Unlock' }).waitFor();

  // Clipboard is cleared 15s after the copy (setting chosen above)
  await page.waitForTimeout(15500);
  assert.equal((await clip()).text, '', 'clipboard cleared');

  await app.close();
  assert.deepEqual(errors, []);
  console.log('E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
