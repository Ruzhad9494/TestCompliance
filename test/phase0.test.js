'use strict';
process.env.TZ = 'Asia/Kuala_Lumpur';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { createEnv, Spreadsheet } = require('./mock');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
function load() { vm.runInThisContext(CODE, { filename: 'Code.gs' }); }

const FILE_A = '1AbCdEfGhIjKlMnOpQrStUvWxYz012';
const FILE_B = '1ZyXwVuTsRqPoNmLkJiHgFeDcBa987';
const FILE_C = '1QqWwEeRrTtYyUuIiOoPpAaSsDd345';
const link = id => 'https://drive.google.com/file/d/' + id + '/view?usp=sharing';

function envReady() { const env = createEnv(); load(); return env; }
function tab(env, name) { return globalThis.readTable_(name); }
function certsOf(env) { return tab(env, 'Certs'); }

function buildOldBook(env, tz = 'Asia/Kuala_Lumpur') {
  const old = new Spreadsheet('Old', tz);
  old.sheets = [];
  const cert = old.insertSheet('Cert');
  cert.fill([
    ['ID', 'NAME', 'CIDB', 'CIDB Cert', 'NIOSH', 'Niosh Cert', 'Working at Height', 'WaH Cert', 'First Aid', 'First Aid Cert'],
    ['VES001', 'Ahmad  Fakhri bin Zakaria', '23/11/2026', link(FILE_A), new Date(2027, 1, 20), '', '', '', '', ''],
    ['VES002', 'SITI NUR BT RAHIM', '31/02/2027', '', '27/12/2025', '', '', '', '', ''],
    ['VES003', 'RAJESH A/L KUMAR', '', link(FILE_B), '', '', '', '', '', ''],
    ['', 'TIADA ID ORANG', '01/01/2027', '', '', '', '', '', '', ''],
    ['', '', '', '', '', '', '', '', '', ''],
    ['VES004', 'WAN HAKIM', '15/12/2026', 'https://example.com/bukan-drive', '', '', '', '', '', '']
  ]);
  const cm = old.insertSheet('Chargeman License');
  cm.fill([
    ['Solar Farm', 'Chargeman Name', 'Competency No.', 'Expiry Date', 'Document', 'NRIC'],
    ['Farm A', 'AHMAD FAKHRI B. ZAKARIA', 'TNB027535P', '20/11/2026', link(FILE_C), '900101-01-1234'],
    ['Farm B', 'SITI NUR  BT RAHIM', 'PJ-001', new Date(2026, 11, 15), '', '910202-02-2345'],
    ['Farm C', 'OUTSIDER ONE', 'X-1', '25/12/2026', '', '800303-03-3456'],
    ['Farm D', 'outsider one', 'X-2', '25/12/2027', '', ''],
    ['Farm E', '', 'Z-9', '01/01/2027', '', '']
  ]);
  const id = 'OLDBOOKID_' + 'x'.repeat(30);
  env.books[id] = old;
  return { old, id };
}

/* ---------------- fungsi tulen ---------------- */
test('parseDateAny_: tarikh sah, tak sah, Date, timezone', () => {
  load(); createEnv();
  const ok = globalThis.parseDateAny_('23/11/2026');
  assert.equal(ok.state, 'ok'); assert.equal(ok.date.getFullYear(), 2026); assert.equal(ok.date.getMonth(), 10); assert.equal(ok.date.getDate(), 23);
  assert.equal(globalThis.parseDateAny_('31/02/2027').state, 'bad');
  assert.equal(globalThis.parseDateAny_('06/2028').state, 'bad');
  assert.equal(globalThis.parseDateAny_('23/11/26').state, 'bad');
  assert.equal(globalThis.parseDateAny_('').state, 'empty');
  assert.equal(globalThis.parseDateAny_('2026-11-23').date.getDate(), 23);
  // Date tengah malam UTC dalam sheet bertimezone UTC kekal 23hb (tak anjak)
  const utcMidnight = new Date(Date.UTC(2026, 10, 23));
  assert.equal(globalThis.parseDateAny_(utcMidnight, 'UTC').date.getDate(), 23);
});

test('matchPerson_: exact, fuzzy BIN vs B., ambiguous, none', () => {
  load(); createEnv();
  const people = [{ staff_id: 'VES001', full_name: 'AHMAD FAKHRI BIN ZAKARIA' }, { staff_id: 'VES002', full_name: 'LIM AH KOW' }];
  assert.equal(globalThis.matchPerson_('ahmad fakhri  bin zakaria', people).type, 'exact');
  const f = globalThis.matchPerson_('AHMAD FAKHRI B. ZAKARIA', people);
  assert.equal(f.type, 'fuzzy'); assert.equal(f.person.staff_id, 'VES001');
  assert.equal(globalThis.matchPerson_('SESEORANG LAIN', people).type, 'none');
  const dup = people.concat([{ staff_id: 'VES009', full_name: 'AHMAD FAKHRI BINTI ZAKARIA' }]);
  assert.equal(globalThis.matchPerson_('AHMAD FAKHRI B ZAKARIA', dup).type, 'ambiguous');
});

test('extractFileId_ terima pautan fail, tolak pautan folder dan bukan-Drive', () => {
  load(); createEnv();
  assert.equal(globalThis.extractFileId_(link(FILE_A)), FILE_A);
  assert.equal(globalThis.extractFileId_('https://drive.google.com/open?id=' + FILE_B), FILE_B);
  assert.equal(globalThis.extractFileId_('https://drive.google.com/drive/folders/' + FILE_A), '');
  assert.equal(globalThis.extractFileId_('https://example.com/x'), '');
});

/* ---------------- setupSystem ---------------- */
test('setupSystem: cipta 11 tab, header tepat, seed, folder, trigger, admin', () => {
  const env = envReady();
  const r = globalThis.setupSystem();
  const names = env.ss.getSheets().map(s => s.getName());
  assert.deepEqual(names.sort(), globalThis.SETUP_TABS.slice().sort(), 'Sheet1 dibuang, 11 tab sahaja');
  globalThis.SETUP_TABS.forEach(t => {
    const sh = env.ss.getSheetByName(t);
    const hdr = globalThis.headersOf_(t);
    assert.deepEqual(sh.getRange(1, 1, 1, hdr.length).getValues()[0], hdr, 'header ' + t);
    assert.equal(sh.frozen, 1);
  });
  assert.equal(tab(env, 'Cert_Types').length, 6);
  assert.equal(tab(env, 'Role_Requirements').length, 6);
  assert.ok(tab(env, 'Config').length >= 16);
  assert.equal(globalThis.getConfig_('company_name'), 'Voltake Energy Services Sdn Bhd');
  assert.equal(globalThis.getConfig_('reminder_days'), '60,30,14,7');
  assert.ok(globalThis.getConfig_('drive_root_folder_id').startsWith('fld-'));
  assert.ok(globalThis.getConfig_('drive_backup_folder_id').startsWith('fld-'));
  assert.deepEqual(env.triggers.map(t => t.fn).sort(), ['dailyReminder', 'weeklyBackup']);
  const users = tab(env, 'Users');
  assert.equal(users.length, 1);
  assert.equal(users[0].role, 'Admin'); assert.equal(users[0].login_id, 'admin@voltake.test');
  assert.equal(users[0].must_change_pin, true);
  assert.ok(r.created.length > 0);
});

test('setupSystem: format lajur teks/tarikh dan dropdown', () => {
  const env = envReady(); globalThis.setupSystem();
  const personnel = env.ss.getSheetByName('Personnel');
  assert.equal(personnel.formats['2,1'], '@'); // staff_id
  const certs = env.ss.getSheetByName('Certs');
  const h = globalThis.headersOf_('Certs');
  assert.equal(certs.formats['2,' + (h.indexOf('expiry_date') + 1)], 'dd/MM/yyyy');
  assert.equal(certs.formats['2,' + (h.indexOf('submitted_at') + 1)], 'dd/MM/yyyy HH:mm');
  assert.equal(certs.formats['2,' + (h.indexOf('cert_no') + 1)], '@');
  assert.ok(certs.validations['2,' + (h.indexOf('record_status') + 1)], 'dropdown record_status');
  assert.ok(certs.validations['2,' + (h.indexOf('type_code') + 1)], 'dropdown type_code');
  assert.equal(certs.rules.length, 2, 'conditional formatting');
  assert.equal(env.ss.getSheetByName('Config').formats['2,2'], '@', 'Config.value teks supaya "60,30,14,7" tak jadi nombor');
});

test('setupSystem: PIN admin dipaparkan sekali, hash sepadan, tiada plain text', () => {
  const env = envReady(); globalThis.setupSystem();
  const pinAlerts = env.alerts.filter(a => a.t.startsWith('PIN admin'));
  assert.equal(pinAlerts.length, 1);
  const pin = /PIN sementara: (\d{6})/.exec(pinAlerts[0].m)[1];
  assert.ok(!globalThis.isWeakPin_(pin));
  const u = tab(env, 'Users')[0];
  assert.equal(u.pin_hash, crypto.createHash('sha256').update(u.salt + pin).digest('hex'));
  const sheetDump = JSON.stringify(env.ss.getSheetByName('Users').cells);
  assert.ok(!sheetDump.includes(pin), 'PIN tak boleh ada dalam sheet');
  // jalankan semula: tiada PIN baru
  globalThis.setupSystem();
  assert.equal(env.alerts.filter(a => a.t.startsWith('PIN admin')).length, 1);
});

test('setupSystem idempotent: jalankan 2x tak hilang/gandakan data', () => {
  const env = envReady(); globalThis.setupSystem();
  // admin tambah data antara dua run
  globalThis.withLock_(() => globalThis.appendObjects_('Personnel', [{ staff_id: 'VES007', full_name: 'TEST ORANG', designation: 'X', employer_type: 'Voltake', employer_name: 'V', status: 'Aktif', created_at: new Date(), updated_at: new Date() }]));
  const counter1 = globalThis.getConfig_('counter_user');
  const before = { ct: tab(env, 'Cert_Types').length, rr: tab(env, 'Role_Requirements').length, cfg: tab(env, 'Config').length, users: tab(env, 'Users').length, rootId: globalThis.getConfig_('drive_root_folder_id') };
  const r2 = globalThis.setupSystem();
  assert.equal(tab(env, 'Cert_Types').length, before.ct);
  assert.equal(tab(env, 'Role_Requirements').length, before.rr);
  assert.equal(tab(env, 'Config').length, before.cfg);
  assert.equal(tab(env, 'Users').length, before.users);
  assert.equal(tab(env, 'Personnel').length, 1, 'data personel kekal');
  assert.equal(env.triggers.length, 2, 'trigger tak terganda');
  assert.equal(globalThis.getConfig_('drive_root_folder_id'), before.rootId, 'folder Drive sama');
  assert.equal(env.root.kids.length, 1);
  assert.equal(globalThis.getConfig_('counter_user'), counter1);
  assert.equal(r2.created.filter(c => /^Tab /.test(c)).length, 0);
});

test('setupSystem: seed tak timpa ubahan admin pada Role_Requirements', () => {
  const env = envReady(); globalThis.setupSystem();
  const sh = env.ss.getSheetByName('Role_Requirements');
  sh.getRange(2, 2).setValue('CIDB,NIOSH,WAH'); // ubah baris "*"
  globalThis.setupSystem();
  assert.equal(tab(env, 'Role_Requirements').find(r => r.designation === '*').required_types, 'CIDB,NIOSH,WAH');
});

test('setupSystem tanpa UI: admin TIDAK dicipta (PIN tak boleh hilang), jalan semula dengan UI berjaya', () => {
  const env = createEnv({ ui: false }); load();
  const r = globalThis.setupSystem();
  assert.equal(tab(env, 'Users').length, 0);
  assert.ok(r.warnings.some(w => /admin belum dicipta/i.test(w)));
  env.uiAvailable = true;
  globalThis.setupSystem();
  assert.equal(tab(env, 'Users').length, 1);
});

test('setupSystem: header tab sedia ada tak sepadan -> amaran, data tak diusik', () => {
  const env = createEnv(); load();
  const sh = env.ss.insertSheet('Personnel');
  sh.fill([['ID', 'NAMA'], ['VES001', 'LAMA']]);
  const r = globalThis.setupSystem();
  assert.ok(r.warnings.some(w => /Personnel/.test(w)));
  assert.equal(sh.getRange(2, 2).getValues()[0][0], 'LAMA');
});

/* ---------------- migrasi ---------------- */
test('migrateOldData: padanan, tarikh, Pending, Luar baru, NRIC tak diimport', () => {
  const env = envReady(); globalThis.setupSystem();
  const { id } = buildOldBook(env);
  env.promptQueue.push(id);
  const res = globalThis.migrateOldData();

  const people = tab(env, 'Personnel');
  const byId = Object.fromEntries(people.map(p => [p.staff_id, p]));
  assert.equal(byId.VES001.full_name, 'AHMAD FAKHRI BIN ZAKARIA', 'nama dinormalisasi (ruang berganda, huruf besar)');
  assert.equal(byId.VES001.designation, '');
  const outsiders = people.filter(p => p.employer_type === 'Luar');
  assert.equal(outsiders.length, 1);
  assert.equal(outsiders[0].full_name, 'OUTSIDER ONE');
  assert.equal(outsiders[0].staff_id, 'VES005', 'ID seterusnya selepas VES004');

  const certs = certsOf(env);
  const c = (staff, type) => certs.filter(x => x.staff_id === staff && x.type_code === type);
  // VES001 CIDB sah + fail
  const cidb1 = c('VES001', 'CIDB')[0];
  assert.equal(cidb1.file_id, FILE_A);
  assert.equal(cidb1.expiry_date.getDate(), 23); assert.equal(cidb1.expiry_date.getMonth(), 10);
  assert.equal(cidb1.record_status, 'Verified'); assert.equal(cidb1.verified_by, 'MIGRASI');
  assert.match(cidb1.remarks, /belum disemak ulang/);
  // NIOSH daripada Date object
  assert.equal(c('VES001', 'NIOSH')[0].expiry_date.getDate(), 20);
  // VES002 CIDB tarikh tak sah 31/02 dan tiada fail -> tiada cert, ada dalam report
  assert.equal(c('VES002', 'CIDB').length, 0);
  assert.equal(c('VES002', 'NIOSH')[0].expiry_date.getFullYear(), 2025, 'NIOSH tamat 27/12/2025 diimport apa adanya');
  // VES003 fail sahaja -> Pending
  const p3 = c('VES003', 'CIDB')[0];
  assert.equal(p3.record_status, 'Pending'); assert.equal(p3.expiry_date, ''); assert.equal(p3.verified_by, '');
  // VES004 pautan bukan Drive, tarikh sah -> cert dicipta tanpa file_id, report Perlu semak
  assert.equal(c('VES004', 'CIDB')[0].file_id, '');
  // Chargeman
  const cm1 = c('VES001', 'CHARGEMAN')[0];
  assert.equal(cm1.cert_no, 'TNB027535P'); assert.equal(cm1.detail, 'Site: Farm A'); assert.equal(cm1.file_id, FILE_C);
  assert.equal(c('VES002', 'CHARGEMAN')[0].expiry_date.getMonth(), 11);
  assert.equal(c('VES005', 'CHARGEMAN').length, 2, 'baris kedua OUTSIDER ONE padan dengan personel baru');
  // NRIC tak masuk mana-mana tab data
  const dump = JSON.stringify(env.ss.sheets.filter(s => s.name !== 'Migration_Report').map(s => s.cells));
  assert.ok(!dump.includes('900101-01-1234') && !dump.includes('800303-03-3456'));
  assert.equal(tab(env, 'Personnel_Private').length, 0);

  // jumlah semak: created + duplicate + unreadable == sourceItems
  assert.equal(res.created + res.skippedDuplicate + res.unreadable, res.sourceItems);
  assert.equal(res.pendingNoExpiry, 1);
});

test('migrateOldData: Migration_Report betul', () => {
  const env = envReady(); globalThis.setupSystem();
  const { id } = buildOldBook(env); env.promptQueue.push(id);
  globalThis.migrateOldData();
  const rep = env.ss.getSheetByName('Migration_Report');
  const hdr = globalThis.headersOf_('Migration_Report');
  assert.deepEqual(rep.getRange(1, 1, 1, hdr.length).getValues()[0], hdr);
  const rows = globalThis.readTable_('Migration_Report');
  const find = (tabName, n) => rows.find(r => r.source_tab === tabName && r.source_row === n);
  assert.equal(find('Cert', 2).result, 'Baru');
  assert.equal(find('Cert', 3).result, 'Perlu semak'); assert.match(find('Cert', 3).note, /tak boleh dibaca "31\/02\/2027"/);
  assert.equal(find('Cert', 4).result, 'Perlu semak'); assert.match(find('Cert', 4).note, /Pending/);
  assert.equal(find('Cert', 5).result, 'Perlu semak'); assert.match(find('Cert', 5).note, /ID .* kosong/);
  assert.equal(find('Cert', 7).result, 'Perlu semak'); assert.match(find('Cert', 7).note, /pautan fail tak dikenali/);
  assert.ok(rows.some(r => r.source_tab === 'Chargeman License' && /NRIC/.test(r.note) && /TIDAK diimport/.test(r.note)), 'amaran NRIC');
  assert.equal(find('Chargeman License', 2).result, 'Perlu semak'); assert.match(find('Chargeman License', 2).note, /padanan hampir/);
  assert.equal(find('Chargeman License', 3).result, 'Dipadan'); assert.equal(find('Chargeman License', 3).matched_staff_id, 'VES002');
  assert.equal(find('Chargeman License', 4).result, 'Perlu semak'); assert.match(find('Chargeman License', 4).note, /tiada padanan/);
  assert.equal(find('Chargeman License', 5).result, 'Dipadan');
  assert.equal(find('Chargeman License', 6).result, 'Perlu semak'); assert.match(find('Chargeman License', 6).note, /Nama kosong/);
});

test('migrateOldData idempotent: run kali kedua tiada cert/personel terganda', () => {
  const env = envReady(); globalThis.setupSystem();
  const { id } = buildOldBook(env);
  env.promptQueue.push(id); const r1 = globalThis.migrateOldData();
  const nCerts = certsOf(env).length, nPeople = tab(env, 'Personnel').length;
  env.promptQueue.push(id); const r2 = globalThis.migrateOldData();
  assert.equal(certsOf(env).length, nCerts);
  assert.equal(tab(env, 'Personnel').length, nPeople);
  assert.equal(r2.created, 0);
  assert.equal(r2.skippedDuplicate, r1.created);
  assert.equal(r2.created + r2.skippedDuplicate + r2.unreadable, r2.sourceItems);
});

test('migrateOldData: sheet lama tak diubah (baca sahaja)', () => {
  const env = envReady(); globalThis.setupSystem();
  const { old, id } = buildOldBook(env);
  const snap = JSON.stringify(old.sheets.map(s => [s.name, s.cells, s.formats]));
  env.promptQueue.push(id); globalThis.migrateOldData();
  assert.equal(JSON.stringify(old.sheets.map(s => [s.name, s.cells, s.formats])), snap);
});

test('migrateOldData: tarikh Date dari sheet lama timezone lain tak anjak sehari', () => {
  const env = envReady(); globalThis.setupSystem();
  const old = new Spreadsheet('Old', 'UTC'); old.sheets = [];
  old.insertSheet('Cert').fill([['ID', 'NAME', 'CIDB'], ['VES010', 'ORANG UTC', new Date(Date.UTC(2026, 10, 23))]]);
  old.insertSheet('Chargeman License').fill([['Solar Farm', 'Chargeman Name']]);
  env.books['UTCBOOK_' + 'y'.repeat(30)] = old; env.promptQueue.push('UTCBOOK_' + 'y'.repeat(30));
  globalThis.migrateOldData();
  assert.equal(certsOf(env)[0].expiry_date.getDate(), 23);
});

test('migrateOldData: pautan daripada formula HYPERLINK dan rich text', () => {
  const env = envReady(); globalThis.setupSystem();
  const old = new Spreadsheet('Old'); old.sheets = [];
  const c = old.insertSheet('Cert').fill([['ID', 'NAME', 'CIDB', 'CIDB Cert', 'NIOSH', 'Niosh Cert'], ['VES011', 'ORANG LINK', '01/12/2026', 'Lihat', '02/12/2026', 'Fail']]);
  c.formulas['2,4'] = '=HYPERLINK("' + link(FILE_A) + '","Lihat")';
  c.links['2,6'] = link(FILE_B);
  old.insertSheet('Chargeman License').fill([['Solar Farm', 'Chargeman Name']]);
  const id = 'LINKBOOK_' + 'z'.repeat(30); env.books[id] = old; env.promptQueue.push(id);
  globalThis.migrateOldData();
  const certs = certsOf(env);
  assert.equal(certs.find(x => x.type_code === 'CIDB').file_id, FILE_A);
  assert.equal(certs.find(x => x.type_code === 'NIOSH').file_id, FILE_B);
});

test('migrateOldData: ID spreadsheet tak sah / dibatalkan', () => {
  const env = envReady(); globalThis.setupSystem();
  assert.equal(globalThis.migrateOldData(), null); // prompt dibatalkan
  env.promptQueue.push('abc'); assert.equal(globalThis.migrateOldData(), null);
  assert.equal(certsOf(env).length, 0);
});

/* ---------------- healthCheck ---------------- */
test('healthCheck: bersih selepas setup + migrasi', () => {
  const env = envReady(); globalThis.setupSystem();
  const { id } = buildOldBook(env); env.promptQueue.push(id); globalThis.migrateOldData();
  const h = globalThis.healthCheck();
  assert.deepEqual(h.errors, []);
  assert.ok(h.ok);
  assert.ok(h.info.some(i => /belum ada designation/.test(i)));
});

test('healthCheck: tangkap orphan, type_code tak sah, tarikh teks, header rosak', () => {
  const env = envReady(); globalThis.setupSystem();
  globalThis.withLock_(() => {
    globalThis.appendObjects_('Personnel', [{ staff_id: 'VES001', full_name: 'A', designation: 'X', employer_type: 'Voltake', status: 'Aktif', created_at: new Date(), updated_at: new Date() }]);
    const base = { submitted_by: 'U', submitted_at: new Date(), record_status: 'Verified', verified_by: 'U' };
    globalThis.appendObjects_('Certs', [
      Object.assign({ cert_id: 'C-000001', staff_id: 'VES999', type_code: 'CIDB', expiry_date: new Date(2027, 0, 1) }, base),
      Object.assign({ cert_id: 'C-000002', staff_id: 'VES001', type_code: 'NOPE', expiry_date: new Date(2027, 0, 1) }, base),
      Object.assign({ cert_id: 'C-000003', staff_id: 'VES001', type_code: 'CIDB', expiry_date: '23/11/2026' }, base),
      Object.assign({ cert_id: 'C-000004', staff_id: 'VES001', type_code: 'NIOSH', expiry_date: '' }, base)
    ]);
  });
  const h = globalThis.runHealthCheck_();
  const joined = h.errors.join('\n');
  assert.match(joined, /VES999.*orphan/);
  assert.match(joined, /type_code "NOPE"/);
  assert.match(joined, /expiry_date bukan tarikh sebenar/);
  assert.match(joined, /Verified tapi tiada expiry_date/);
  env.ss.getSheetByName('Jobs').getRange(1, 1).setValue('salah');
  assert.match(globalThis.runHealthCheck_().errors.join('\n'), /Header tab Jobs/);
});

/* ---------------- jana PIN staf ---------------- */
test('generateStaffPins: user Staf untuk Voltake aktif sahaja, PIN_LIST ada PIN, hash sepadan, idempotent', () => {
  const env = envReady(); globalThis.setupSystem();
  const now = new Date();
  globalThis.withLock_(() => globalThis.appendObjects_('Personnel', [
    { staff_id: 'VES001', full_name: 'A', designation: 'X', employer_type: 'Voltake', status: 'Aktif', created_at: now, updated_at: now },
    { staff_id: 'VES002', full_name: 'B', designation: 'X', employer_type: 'Voltake', status: 'Tidak aktif', created_at: now, updated_at: now },
    { staff_id: 'VES003', full_name: 'C', designation: 'X', employer_type: 'Luar', status: 'Aktif', created_at: now, updated_at: now }
  ]));
  const r = globalThis.generateStaffPins();
  assert.equal(r.created, 1); assert.equal(r.skippedOther, 2);
  const users = tab(env, 'Users').filter(u => u.role === 'Staf');
  assert.equal(users.length, 1);
  assert.equal(users[0].login_id, 'ves001'); assert.equal(users[0].staff_id, 'VES001'); assert.equal(users[0].must_change_pin, true);
  const pl = env.ss.getSheetByName('PIN_LIST');
  const pin = pl.getRange(2, 4).getValues()[0][0];
  assert.match(pin, /^\d{6}$/);
  assert.equal(pl.formats['2,4'], '@', 'format teks supaya sifar depan kekal');
  assert.equal(users[0].pin_hash, crypto.createHash('sha256').update(users[0].salt + pin).digest('hex'));
  // run kedua: tiada user baru
  const r2 = globalThis.generateStaffPins();
  assert.equal(r2.created, 0); assert.equal(r2.hasUser, 1);
  assert.equal(tab(env, 'Users').filter(u => u.role === 'Staf').length, 1);
});

test('randomPin_: tiada PIN lemah dalam 2000 percubaan', () => {
  load(); createEnv();
  for (let i = 0; i < 2000; i++) { const p = globalThis.randomPin_(); assert.match(p, /^\d{6}$/); assert.ok(!globalThis.isWeakPin_(p)); }
});

test('audit log merekod setup/migrate/pins tanpa PIN atau IC', () => {
  const env = envReady(); globalThis.setupSystem();
  const { id } = buildOldBook(env); env.promptQueue.push(id); globalThis.migrateOldData();
  const log = tab(env, 'Audit_Log');
  assert.ok(['setup', 'migrate'].every(a => log.some(l => l.action === a)));
  const dump = JSON.stringify(log);
  assert.ok(!/\d{6}-\d{2}-\d{4}/.test(dump));
  assert.equal(log[0].user_id, 'U-000001', 'setup direkod atas nama admin yang baru dicipta');
});
