// End-to-end check of the real desktop app. Run with: npm run test:e2e
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
  const dlg = () => page.locator('dialog');
  const fill = (label, value) => dlg().getByLabel(label, { exact: true }).fill(value);
  const btn = (name) => page.getByRole('button', { name, exact: true });
  const nav = (name) => page.getByRole('navigation').getByRole('button', { name });
  const tile = (name) => page.locator('.tile').filter({ has: page.locator('.name', { hasText: new RegExp('^' + name + '$') }) });
  const shot = async (name) => { if (shots) await page.screenshot({ path: path.join(shots, name + '.png') }); };
  const TEXT = 'Text saved in this tablet (this is what gets copied)';
  const newTablet = async (name, text, opts = {}) => {
    await btn('New tablet').click();
    await fill('Tablet name', name);
    await fill(TEXT, text);
    if (opts.hide) await dlg().getByLabel(/Hide the text/).check();
    if (opts.pw) { await fill('Tablet password (optional)', opts.pw); await fill('Repeat tablet password', opts.pw); }
    if (opts.shot) await shot(opts.shot);
    await dlg().getByRole('button', { name: 'Save' }).click();
    await tile(name).waitFor();
  };
  const newFolder = async (name, pw) => {
    await btn('New folder').click();
    await fill('Folder name', name);
    if (pw) { await fill('Folder password (optional)', pw); await fill('Repeat folder password', pw); }
    await dlg().getByRole('button', { name: 'Create folder' }).click();
    await page.getByRole('heading', { name: new RegExp(name + '$') }).waitFor();
  };
  const copied = async (want) => { await page.waitForTimeout(150); assert.equal((await clip()).text, want); };

  // First-run setup
  await page.getByLabel('Admin password (can add, edit and delete)').fill('admin123');
  await page.getByLabel('Repeat Admin password').fill('admin123');
  await page.getByLabel('Operator password (can only view and copy)').fill('admin123');
  await page.getByLabel('Repeat Operator password').fill('admin123');
  await btn('Create and open').click();
  await page.getByText('must be different').waitFor();
  await page.getByLabel('Operator password (can only view and copy)').fill('oper123');
  await page.getByLabel('Repeat Operator password').fill('oper123');
  await btn('Create and open').click();
  await page.getByText('Admin', { exact: true }).waitFor();
  await page.getByText('Nothing copied yet').waitFor();

  // Folders and tablets
  await newFolder('Company');
  await newTablet('Compny', 'acme INDUSTRIES pvt ltd', { shot: '2-new-tablet' });
  await btn('Rename tablet').click();
  await fill('New name', 'Company name');
  await dlg().getByRole('button', { name: 'Rename' }).click();
  await tile('Company name').waitFor();

  // One-click copy in each style, and the "last copied" bar shows what was copied
  const expect = { Normal: 'acme INDUSTRIES pvt ltd', BIG: 'ACME INDUSTRIES PVT LTD', small: 'acme industries pvt ltd',
    'First capital': 'Acme industries pvt ltd', 'Each Word': 'Acme Industries Pvt Ltd' };
  for (const [chip, want] of Object.entries(expect)) {
    await page.locator('.stylebar').getByRole('button', { name: chip, exact: true }).click();
    await tile('Company name').locator('.name').click();
    await copied(want);
    assert.equal(await page.locator('.copybar .txt').textContent(), want, 'copy bar shows ' + chip);
  }
  await page.locator('.stylebar').getByRole('button', { name: 'Italic', exact: true }).click();
  await tile('Company name').locator('.name').click(); await page.waitForTimeout(150);
  let c = await clip();
  assert.equal(c.text, 'acme INDUSTRIES pvt ltd');
  assert.match(c.html, /<i>acme INDUSTRIES pvt ltd<\/i>/);
  await page.locator('.stylebar').getByRole('button', { name: 'Italic ✱' }).click();
  await tile('Company name').locator('.name').click(); await page.waitForTimeout(150);
  assert.ok((await clip()).text.startsWith('\u{1d622}\u{1d624}\u{1d62e}\u{1d626} '), 'unicode italic');
  await page.locator('.stylebar').getByRole('button', { name: 'Normal' }).click();
  await btn('Copy in another style').click();
  await dlg().getByRole('button', { name: /^BIG/ }).click();
  await copied('ACME INDUSTRIES PVT LTD');

  // Tablet with its own password, and a hidden tablet
  await newTablet('Net banking', 'p@ss-9981', { pw: 'tab1234' });
  await newTablet('PAN', 'ABCDE1234F', { hide: true });
  assert.equal(await page.getByText('ABCDE1234F').count(), 0, 'hidden text not on screen');
  await tile('PAN').locator('.name').click();
  await copied('ABCDE1234F');
  assert.equal(await page.locator('.copybar .txt').textContent(), '••••••••');
  await btn('Show the copied text').click();
  assert.equal(await page.locator('.copybar .txt').textContent(), 'ABCDE1234F');
  await shot('1-board');

  // Sorting is chosen outside the tablets; the tablets have no up/down buttons
  const names = () => page.locator('.tile .name').allTextContents();
  assert.equal(await page.getByRole('button', { name: /Move (up|down)/ }).count(), 0);
  assert.deepEqual(await names(), ['Company name', 'Net banking', 'PAN']);
  await page.getByLabel('Sort tablets').selectOption('newest');
  assert.deepEqual(await names(), ['PAN', 'Net banking', 'Company name']);
  await page.getByLabel('Sort tablets').selectOption('za');
  assert.deepEqual(await names(), ['PAN', 'Net banking', 'Company name']);
  await page.getByLabel('Sort tablets').selectOption('az');
  assert.deepEqual(await names(), ['Company name', 'Net banking', 'PAN']);
  await page.getByLabel('Sort tablets').selectOption('oldest');

  // Password folder inside Company, with a tablet in it
  await newFolder('Bank', 'fold1234');
  await page.getByRole('heading', { name: 'Home / Company / Bank' }).waitFor();
  await newTablet('Account no', '000111222333');
  // Set, then change, a password on an existing tablet
  await newTablet('IFSC', 'ACME0001234');
  await tile('IFSC').getByRole('button', { name: 'Set a password for this tablet' }).click();
  await fill('New password for this tablet', 'ifsc1234'); await fill('Repeat password', 'ifsc1234');
  await dlg().getByRole('button', { name: 'Save' }).click();
  await tile('IFSC').getByRole('button', { name: 'Change or remove tablet password' }).waitFor();

  // Moving a tablet between folders needs the Admin password every time
  await tile('Account no').getByRole('button', { name: 'Move to another folder' }).click();
  await dlg().getByLabel('Move it to folder').selectOption({ label: 'Home (top level)' });
  await fill('Admin password', 'oper123');
  await dlg().getByRole('button', { name: 'Move' }).click();
  await dlg().getByText('Wrong Admin password.').waitFor();
  await fill('Admin password', 'admin123');
  await dlg().getByRole('button', { name: 'Move' }).click();
  await page.getByText('Moved to Home.').waitFor();
  assert.equal(await tile('Account no').count(), 0, 'tablet left the folder');
  await nav(/Home/).click();
  await tile('Account no').locator('.name').click();
  await copied('000111222333');
  await tile('Account no').getByRole('button', { name: 'Move to another folder' }).click();
  await dlg().getByLabel('Move it to folder').selectOption(await dlg().locator('option', { hasText: 'Bank' }).getAttribute('value'));
  await fill('Admin password', 'admin123');
  await dlg().getByRole('button', { name: 'Move' }).click();
  await page.getByText('Moved to Home / Company / Bank.').waitFor();
  assert.equal(await dlg().count(), 0);
  await nav(/Bank/).click();
  await tile('Account no').getByRole('button', { name: 'Edit tablet' }).click();
  assert.equal(await dlg().getByLabel('Keep it in folder').count(), 0, 'edit cannot move without password');
  await dlg().getByRole('button', { name: 'Cancel' }).click();

  // Folder search is separate from tablet search
  const fsearch = page.getByRole('navigation').getByLabel('Search folders');
  await fsearch.fill('zzz');
  await page.getByText('No folder has that name.').waitFor();
  await fsearch.fill('ban');
  assert.deepEqual(await page.locator('.node').allTextContents(), ['BankHome / Company']);
  await page.locator('.node', { hasText: 'Bank' }).click();
  await page.getByRole('heading', { name: 'Home / Company / Bank' }).waitFor();
  assert.equal(await page.getByRole('navigation').getByLabel('Search folders').inputValue(), '');
  await nav(/Company/).waitFor();

  // Search finds tablets across folders
  await page.getByLabel('Search all tablets').fill('account');
  await page.locator('.tile .path', { hasText: 'Home / Company / Bank' }).waitFor();
  await page.getByLabel('Search all tablets').fill('');

  // Settings: clipboard clear + CSV import
  await btn('Settings').click();
  await shot('3-settings');
  await page.getByLabel('Clear clipboard after').selectOption('15');
  await page.getByLabel('Which tablets').selectOption('all');
  const csv = path.join(userData, 'in.csv');
  fs.writeFileSync(csv, 'Folder,Name,Value,Sensitive\r\nCompany / Tax,GST,27ABCDE1234F1Z5,no\r\nCompany,Company name,acme INDUSTRIES pvt ltd,no\r\n,,x,\r\n');
  let chooser = page.waitForEvent('filechooser');
  await btn('Import from Excel or CSV…').click();
  await (await chooser).setFiles(csv);
  await page.getByText('1 new tablet(s) will be added. 1 already exist and 1 row(s)').waitFor();
  await dlg().getByRole('button', { name: 'Import' }).click();
  await btn('Tablets').click();
  await nav(/Tax/).click();
  await tile('GST').waitFor();

  if (process.env.XLSX) {
    await btn('Settings').click();
    chooser = page.waitForEvent('filechooser');
    await btn('Import from Excel or CSV…').click();
    await (await chooser).setFiles(process.env.XLSX);
    await dlg().getByRole('button', { name: 'Import' }).click();
    await btn('Tablets').click();
    await nav(/FromExcel/).click();
    await tile('Phone').waitFor();
  }

  // Text tools
  await btn('Text tools').click();
  await page.getByLabel('Text to convert').fill('hello WORLD');
  await page.locator('.panel').getByRole('button', { name: 'Each Word' }).click();
  await copied('Hello World');
  await shot('4-text-tools');

  // Mini window stays on top
  await btn('Mini window').click();
  await btn('Full window').waitFor();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), true);
  await btn('Tablets').click();
  await page.waitForTimeout(300);
  await shot('5-mini');
  await btn('Full window').click();
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop()), false);

  // Nothing readable on disk
  const raw = fs.readFileSync(path.join(userData, 'snipboard-vault.json'), 'utf8');
  // Short words can appear by chance in encrypted (base64) data, so look for whole phrases.
  assert.ok(!/acme INDUSTRIES|000111222333|27ABCDE1234F1Z5|Company name|p@ss/i.test(raw), 'vault file is encrypted');

  // Restart as Operator: data persists, read-only, password folder and tablets stay locked
  await app.close();
  app = await launch(); page = await app.firstWindow(); watch(page);
  await page.getByLabel('Password').fill('nope');
  await btn('Unlock').click();
  await page.getByText('Wrong password.').waitFor();
  await page.getByLabel('Password').fill('oper123');
  await btn('Unlock').click();
  await page.getByText('Operator', { exact: true }).waitFor();
  await nav(/Company/).click();
  await tile('Company name').waitFor();
  for (const name of ['New tablet', 'New folder', 'Rename tablet', 'Edit tablet', 'Delete tablet', 'Settings', 'Rename folder', 'Delete folder'])
    assert.equal(await btn(name).count(), 0, 'operator has no ' + name);

  // Password tablet: wrong password refused, right one copies
  await tile('Net banking').getByText('Password needed to copy').waitFor();
  await tile('Net banking').locator('.name').click();
  await fill('Tablet password', 'wrong');
  await dlg().getByRole('button', { name: 'Open' }).click();
  await dlg().getByText('Wrong password.').waitFor();
  await fill('Tablet password', 'tab1234');
  await dlg().getByRole('button', { name: 'Open' }).click();
  await copied('p@ss-9981');

  // Password folder: contents hidden from search until unlocked
  await page.getByLabel('Search all tablets').fill('account');
  await page.getByText('0 results').waitFor();
  await page.getByLabel('Search all tablets').fill('');
  await nav(/Bank/).click();
  await page.getByText('This folder is protected by a password.').waitFor();
  await shot('6-locked-folder');
  await btn('Unlock folder').click();
  await fill('Folder password', 'bad');
  await dlg().getByRole('button', { name: 'Open folder' }).click();
  await dlg().getByText('Wrong password.').waitFor();
  await fill('Folder password', 'fold1234');
  await dlg().getByRole('button', { name: 'Open folder' }).click();
  await tile('Account no').locator('.name').click();
  await copied('000111222333');
  await tile('IFSC').locator('.name').click();
  await fill('Tablet password', 'ifsc1234');
  await dlg().getByRole('button', { name: 'Open' }).click();
  await copied('ACME0001234');
  await btn('Lock this folder again').click();
  await page.getByText('This folder is protected by a password.').waitFor();
  await btn('Lock the app').click();

  // Admin: remove the folder password, move the folder; tablets stay readable
  await page.getByLabel('Password').fill('admin123');
  await btn('Unlock').click();
  await nav(/Bank/).click();
  await btn('Unlock folder').click();
  await fill('Folder password', 'fold1234');
  await dlg().getByRole('button', { name: 'Open folder' }).click();
  await btn('Change or remove folder password').click();
  await dlg().getByLabel('What to do').selectOption('remove');
  await dlg().getByRole('button', { name: 'Save' }).click();
  await btn('Set a password for this folder').waitFor();
  await btn('Move folder').click();
  await dlg().getByLabel('Move it inside').selectOption({ label: 'Home (top level)' });
  await dlg().getByRole('button', { name: 'Move' }).click();
  await page.getByRole('heading', { name: 'Home / Bank' }).waitFor();
  await btn('Lock the app').click();
  await page.getByLabel('Password').fill('oper123');
  await btn('Unlock').click();
  await nav(/Bank/).click();
  await tile('Account no').locator('.name').click();
  await copied('000111222333');
  await shot('7-operator');
  await btn('Lock the app').click();
  await btn('Unlock').waitFor();

  // Clipboard is cleared 15s after the copy (setting chosen above)
  await page.waitForTimeout(15500);
  assert.equal((await clip()).text, '', 'clipboard cleared');

  await app.close();
  assert.deepEqual(errors, []);
  console.log('E2E OK');
})().catch((e) => { console.error(e); process.exit(1); });
