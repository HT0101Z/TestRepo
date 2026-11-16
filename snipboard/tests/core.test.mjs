import test from 'node:test';
import assert from 'node:assert/strict';
import * as tc from '../www/js/textcase.js';
import * as v from '../www/js/vault.js';

test('case conversions', () => {
  assert.equal(tc.toUpper('Acme pvt ltd'), 'ACME PVT LTD');
  assert.equal(tc.toLower('Acme PVT Ltd'), 'acme pvt ltd');
  assert.equal(tc.toSentence('ACME PVT LTD. second LINE'), 'Acme pvt ltd. Second line');
  assert.equal(tc.toTitle("aCME pvt LTD, o'neil road-2b"), "Acme Pvt Ltd, O'neil Road-2b");
  assert.equal(tc.toUnicodeItalic('Ab 1'), '\u{1d608}\u{1d623} 1');
  assert.deepEqual(tc.applyStyle('italic', 'a<b'), { text: 'a<b', html: '<i>a&lt;b</i>' });
  assert.deepEqual(tc.applyStyle('normal', 'x'), { text: 'x' });
});

test('vault roles, save and password change', async () => {
  const data = { items: [{ label: 'Company', value: 'Acme' }] };
  let { file, session } = await v.createVault('admin-pw', 'op-pw', data, 1000);
  assert.ok(v.isVault(file));
  assert.ok(!JSON.stringify(file).includes('Acme'));
  assert.equal((await v.unlock(file, 'admin-pw')).role, 'admin');
  const op = await v.unlock(file, 'op-pw');
  assert.equal(op.role, 'operator');
  assert.deepEqual(op.data, data);
  assert.equal(await v.unlock(file, 'wrong'), null);

  file = await v.saveData(file, session, { items: [] });
  assert.deepEqual((await v.unlock(file, 'op-pw')).data, { items: [] });

  file = await v.setPassword(file, session, 'operator', 'new-op');
  assert.equal(await v.unlock(file, 'op-pw'), null);
  assert.equal((await v.unlock(file, 'new-op')).role, 'operator');
  assert.equal((await v.unlock(file, 'admin-pw')).role, 'admin');
});

import * as io from '../www/js/io.js';

test('csv round trip and row mapping', () => {
  const recs = [
    { path: ['Company', 'Bank'], label: 'A/c', value: 'line1\nline "2", x', sensitive: true },
    { path: [], label: 'Name', value: 'Acme', sensitive: false },
  ];
  const out = io.rowsToRecords(io.parseCsv(io.toCsv(recs)));
  assert.deepEqual(out, { records: recs, skipped: 0 });
  const r = io.rowsToRecords([['Folder', 'Name', 'Value'], ['A > B', 'n', 42], ['', '', ''], ['A', '', 'x']]);
  assert.deepEqual(r, { records: [{ path: ['A', 'B'], label: 'n', value: '42', sensitive: false }], skipped: 1 });
});
