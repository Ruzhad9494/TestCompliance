'use strict';
process.env.TZ = 'Asia/Kuala_Lumpur';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createEnv } = require('./mock');

const CODE = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
const G = globalThis;

const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), Buffer.alloc(500, 7)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(200, 1)]);
const PDF_SMALL = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300, 65)]);
const b64 = b => b.toString('base64');

function api(action, params, token) {
  const out = G.doPost({ postData: { contents: JSON.stringify({ action, params: params || {}, token }) } });
  return JSON.parse(out.getContent());
}
function ok(r) { assert.equal(r.ok, true, JSON.stringify(r)); return r.data; }
function fail(r, code) { assert.equal(r.ok, false, 'sepatutnya gagal: ' + JSON.stringify(r)); if (code) assert.equal(r.code, code, JSON.stringify(r)); return r; }

// Dunia ujian: admin, lead, 2 staf (VES001 aktif, VES002), 1 luar
function world() {
  const env = createEnv(); vm.runInThisContext(CODE, { filename: 'Code.gs' });
  G.setupSystem();
  const adminPin = /PIN sementara: (\d{6})/.exec(env.alerts.find(a => a.t.startsWith('PIN admin')).m)[1];
  const now = new Date();
  G.withLock_(() => {
    G.appendObjects_('Personnel', [
      { staff_id: 'VES001', full_name: 'AHMAD FAKHRI', designation: 'ELECTRICAL CHARGEMAN', employer_type: 'Voltake', employer_name: 'V', status: 'Aktif', notes: 'rahsia-nota', email: 'a@x.my', created_at: now, updated_at: now },
      { staff_id: 'VES002', full_name: 'SITI NUR', designation: 'ELECTRICAL TECHNICIAN', employer_type: 'Voltake', employer_name: 'V', status: 'Aktif', created_at: now, updated_at: now },
      { staff_id: 'VES003', full_name: 'TIDAK AKTIF ORANG', designation: 'X', employer_type: 'Voltake', employer_name: 'V', status: 'Tidak aktif', created_at: now, updated_at: now }
    ]);
    G.appendObjects_('Personnel_Private', [{ staff_id: 'VES001', ic_no: '900101-01-1234', phone: '60123456789', updated_at: now }]);
    G.createUser_({ login_id: 'lead@voltake.test', full_name: 'LEAD', role: 'Lead', staff_id: '', pin: '482915' });
  });
  G.generateStaffPins();
  const pl = env.ss.getSheetByName('PIN_LIST');
  const staffPin = id => { for (let r = 2; r < 10; r++) { if (pl.getRange(r, 1).getValues()[0][0] === id) return pl.getRange(r, 4).getValues()[0][0]; } };
  const w = { env, adminPin, leadPin: '482915', staffPin };
  // admin: login, tukar PIN wajib
  const first = ok(api('login', { login_id: 'admin@voltake.test', pin: adminPin }));
  ok(api('changePin', { old_pin: adminPin, new_pin: '739104' }, first.token));
  w.adminPin = '739104';
  w.admin = ok(api('login', { login_id: 'admin@voltake.test', pin: '739104' })).token;
  // lead dan staf: tukar PIN wajib dahulu
  const lt = ok(api('login', { login_id: 'lead@voltake.test', pin: '482915' })).token;
  ok(api('changePin', { old_pin: '482915', new_pin: '270381' }, lt));
  w.lead = ok(api('login', { login_id: 'lead@voltake.test', pin: '270381' })).token;
  const sp = staffPin('VES001');
  const st = ok(api('login', { login_id: 'ves001', pin: sp })).token;
  ok(api('changePin', { old_pin: sp, new_pin: '815263' }, st));
  w.staf = ok(api('login', { login_id: 'ves001', pin: '815263' })).token;
  const sp2 = staffPin('VES002');
  const st2 = ok(api('login', { login_id: 'ves002', pin: sp2 })).token;
  ok(api('changePin', { old_pin: sp2, new_pin: '561937' }, st2));
  w.staf2 = ok(api('login', { login_id: 'ves002', pin: '561937' })).token;
  return w;
}

const certBase = { staff_id: 'VES001', type_code: 'CIDB', cert_no: 'PJ-T-6-B-0144-2025', expiry_date: '2027-02-20' };

/* ---------------- Login, lockout, sesi ---------------- */
test('login: berjaya, mesej gagal generik (pengguna tiada = PIN salah)', () => {
  const w = world();
  const d = ok(api('login', { login_id: 'ADMIN@voltake.test ', pin: w.adminPin }));
  assert.equal(d.user.role, 'Admin'); assert.ok(d.token.length >= 32);
  const wrongPin = fail(api('login', { login_id: 'admin@voltake.test', pin: '000001' }), 'LOGIN_GAGAL');
  const noUser = fail(api('login', { login_id: 'tiada@voltake.test', pin: '000001' }), 'LOGIN_GAGAL');
  assert.equal(wrongPin.error, noUser.error);
  fail(api('login', { login_id: 'admin@voltake.test', pin: 'abc' }), 'LOGIN_GAGAL');
  const users = G.readTable_('Users');
  assert.ok(!JSON.stringify(d).includes(users[0].pin_hash), 'hash tak bocor');
});

test('lockout: 5 PIN salah kunci akaun, PIN betul pun ditolak, buka selepas tempoh', () => {
  const w = world();
  for (let i = 0; i < 4; i++) fail(api('login', { login_id: 'ves002', pin: '111112' }), 'LOGIN_GAGAL');
  fail(api('login', { login_id: 'ves002', pin: '111112' }), 'AKAUN_DIKUNCI');
  fail(api('login', { login_id: 'ves002', pin: '561937' }), 'AKAUN_DIKUNCI');
  const u = G.readTable_('Users').find(x => x.login_id === 'ves002');
  const mins = (u.locked_until.getTime() - Date.now()) / 60000;
  assert.ok(mins > 14 && mins <= 15, 'kunci ~15 minit, dapat ' + mins);
  // luput tempoh kunci
  w.env.ss.getSheetByName('Users').getRange(u._row, G.headersOf_('Users').indexOf('locked_until') + 1).setValue(new Date(Date.now() - 1000));
  ok(api('login', { login_id: 'ves002', pin: '561937' }));
  assert.equal(G.readTable_('Users').find(x => x.login_id === 'ves002').failed_count, 0);
});

test('PIN wajib tukar: semua action lain disekat sehingga changePin', () => {
  const env = createEnv(); vm.runInThisContext(CODE); G.setupSystem();
  const pin = /PIN sementara: (\d{6})/.exec(env.alerts.find(a => a.t.startsWith('PIN admin')).m)[1];
  const t = ok(api('login', { login_id: 'admin@voltake.test', pin })).token;
  assert.equal(ok(api('getMe', {}, t)).user.must_change_pin, true);
  fail(api('listPersonnel', {}, t), 'PIN_PERLU_TUKAR');
  fail(api('changePin', { old_pin: '999990', new_pin: '739104' }, t), 'PIN_LAMA_SALAH');
  fail(api('changePin', { old_pin: pin, new_pin: '123456' }, t), 'VALIDASI');
  fail(api('changePin', { old_pin: pin, new_pin: '111111' }, t), 'VALIDASI');
  fail(api('changePin', { old_pin: pin, new_pin: '12345' }, t), 'VALIDASI');
  fail(api('changePin', { old_pin: pin, new_pin: pin }, t), 'VALIDASI');
  ok(api('changePin', { old_pin: pin, new_pin: '739104' }, t));
  ok(api('listPersonnel', {}, t));
  fail(api('login', { login_id: 'admin@voltake.test', pin }), 'LOGIN_GAGAL');
  ok(api('login', { login_id: 'admin@voltake.test', pin: '739104' }));
});

test('sesi: tanpa token, token palsu, logout, cache luput, user dinyahaktif', () => {
  const w = world();
  fail(api('listPersonnel', {}), 'SESI_TAMAT');
  fail(api('listPersonnel', {}, 'x'.repeat(64)), 'SESI_TAMAT');
  fail(api('listPersonnel', {}, { a: 1 }), 'SESI_TAMAT');
  const t = ok(api('login', { login_id: 'admin@voltake.test', pin: w.adminPin })).token;
  ok(api('listPersonnel', {}, t));
  ok(api('logout', {}, t));
  fail(api('listPersonnel', {}, t), 'SESI_TAMAT');
  // luput cache
  const t2 = ok(api('login', { login_id: 'admin@voltake.test', pin: w.adminPin })).token;
  Object.keys(w.env.cache).forEach(k => delete w.env.cache[k]);
  fail(api('listPersonnel', {}, t2), 'SESI_TAMAT');
  // user dinyahaktif -> token sedia ada mati serta-merta
  const u = G.readTable_('Users').find(x => x.login_id === 'lead@voltake.test');
  w.env.ss.getSheetByName('Users').getRange(u._row, G.headersOf_('Users').indexOf('active') + 1).setValue(false);
  fail(api('listPersonnel', {}, w.lead), 'SESI_TAMAT');
});

test('role diubah dalam Users berkuatkuasa pada token sedia ada (role bukan dibaca daripada cache)', () => {
  const w = world();
  ok(api('listPersonnel', {}, w.lead));
  fail(api('savePersonnel', { mode: 'create', full_name: 'X' }, w.lead), 'TIDAK_DIBENARKAN');
  const u = G.readTable_('Users').find(x => x.login_id === 'lead@voltake.test');
  w.env.ss.getSheetByName('Users').getRange(u._row, G.headersOf_('Users').indexOf('role') + 1).setValue('Staf');
  fail(api('listPersonnel', {}, w.lead), 'TIDAK_DIBENARKAN');
});

test('router: JSON rosak, action tiada, kunci prototaip, badan kosong', () => {
  world();
  const raw = c => JSON.parse(G.doPost({ postData: { contents: c } }).getContent());
  assert.equal(raw('{bukan json').code, 'PERMINTAAN_SALAH');
  assert.equal(raw('').code, 'PERMINTAAN_SALAH');
  assert.equal(raw(JSON.stringify({ action: 'constructor' })).code, 'ACTION_TIADA');
  assert.equal(raw(JSON.stringify({ action: '__proto__' })).code, 'ACTION_TIADA');
  assert.equal(raw(JSON.stringify({ action: 'dailyReminder' })).code, 'ACTION_TIADA', 'fungsi dalaman tak boleh dipanggil');
  assert.equal(G.doPost({}).getContent().includes('PERMINTAAN_SALAH'), true);
});

/* ---------------- Akses tanpa kebenaran (IPD pelan ujian) ---------------- */
test('R-03 dan R-02 ditolak di server untuk action admin, dan ditolak direkod', () => {
  const w = world();
  const adminOnly = [['savePersonnel', { mode: 'create', full_name: 'A' }], ['getPersonnel', { staff_id: 'VES001', include_private: true }], ['saveCert', certBase]];
  adminOnly.forEach(([a, p]) => { fail(api(a, p, w.staf), 'TIDAK_DIBENARKAN'); fail(api(a, p, w.lead), 'TIDAK_DIBENARKAN'); });
  ['listPersonnel', 'listCerts'].forEach(a => fail(api(a, {}, w.staf), 'TIDAK_DIBENARKAN'));
  assert.ok(G.readTable_('Audit_Log').some(l => l.action === 'akses_ditolak' && l.target === 'savePersonnel'));
  assert.equal(G.readTable_('Personnel').length, 3, 'tiada personel dicipta oleh role tak berhak');
});

/* ---------------- Personel ---------------- */
test('R-02 listPersonnel: tiada ic_no/phone/email/notes, aktif sahaja; admin nampak semua', () => {
  const w = world();
  const lead = ok(api('listPersonnel', {}, w.lead));
  assert.deepEqual(lead.personnel.map(p => p.staff_id).sort(), ['VES001', 'VES002']);
  const dump = JSON.stringify(lead);
  ['ic_no', 'phone', 'email', 'notes', '900101-01-1234', '60123456789', 'rahsia-nota', 'a@x.my', 'next_staff_id'].forEach(k => assert.ok(!dump.includes(k), 'bocor: ' + k));
  const admin = ok(api('listPersonnel', {}, w.admin));
  assert.equal(admin.personnel.length, 3);
  assert.equal(admin.next_staff_id, 'VES004');
  assert.ok(!JSON.stringify(admin).includes('900101-01-1234'), 'IC pun tak ada dalam senarai admin');
});

test('getPersonnel: IC hanya bila diminta, dan dilog view_ic', () => {
  const w = world();
  const a = ok(api('getPersonnel', { staff_id: 'ves001' }, w.admin));
  assert.equal(a.private, undefined);
  assert.equal(G.readTable_('Audit_Log').filter(l => l.action === 'view_ic').length, 0);
  const b = ok(api('getPersonnel', { staff_id: 'VES001', include_private: true }, w.admin));
  assert.equal(b.private.ic_no, '900101-01-1234'); assert.equal(b.private.phone, '60123456789');
  assert.equal(G.readTable_('Audit_Log').filter(l => l.action === 'view_ic').length, 1);
  fail(api('getPersonnel', { staff_id: 'VES999' }, w.admin), 'TIADA');
});

test('savePersonnel: cipta, normalisasi, validasi, unik IC', () => {
  const w = world();
  const d = ok(api('savePersonnel', { mode: 'create', full_name: '  muhammad   hakim ', designation: 'electrical technician', ic_no: '910202025678', phone: '012-345 6789', email: 'H@X.MY' }, w.admin));
  assert.equal(d.staff_id, 'VES004', 'ID auto');
  const p = G.readTable_('Personnel').find(x => x.staff_id === 'VES004');
  assert.equal(p.full_name, 'MUHAMMAD HAKIM'); assert.equal(p.designation, 'ELECTRICAL TECHNICIAN'); assert.equal(p.email, 'h@x.my');
  assert.equal(p.employer_type, 'Voltake'); assert.equal(p.employer_name, 'Voltake Energy Services Sdn Bhd'); assert.equal(p.status, 'Aktif');
  const pr = G.readTable_('Personnel_Private').find(x => x.staff_id === 'VES004');
  assert.equal(pr.ic_no, '910202-02-5678'); assert.equal(pr.phone, '60123456789');
  // validasi
  fail(api('savePersonnel', { mode: 'create', staff_id: 'ABC1', full_name: 'X' }, w.admin), 'VALIDASI');
  fail(api('savePersonnel', { mode: 'create', staff_id: 'VES001', full_name: 'X' }, w.admin), 'VALIDASI');   // wujud
  fail(api('savePersonnel', { mode: 'create', full_name: '' }, w.admin), 'VALIDASI');
  fail(api('savePersonnel', { mode: 'create', full_name: 'X', ic_no: '12345' }, w.admin), 'VALIDASI');
  fail(api('savePersonnel', { mode: 'create', full_name: 'X', ic_no: '900101-01-1234' }, w.admin), 'VALIDASI'); // IC berganda
  fail(api('savePersonnel', { mode: 'create', full_name: 'X', phone: '123' }, w.admin), 'VALIDASI');
  fail(api('savePersonnel', { mode: 'create', full_name: 'X', email: 'bukan-email' }, w.admin), 'VALIDASI');
  fail(api('savePersonnel', { mode: 'create', full_name: 'X', employer_type: 'Hantu' }, w.admin), 'VALIDASI');
  fail(api('savePersonnel', { mode: 'create', full_name: 'X'.repeat(500) }, w.admin), 'VALIDASI');
  fail(api('savePersonnel', { mode: 'update', staff_id: 'VES777', full_name: 'X' }, w.admin), 'TIADA');
});

test('savePersonnel kemas kini: data peribadi tak berubah bila medan tak dihantar; boleh kosongkan', () => {
  const w = world();
  ok(api('savePersonnel', { mode: 'update', staff_id: 'VES001', full_name: 'Ahmad Fakhri Baru', designation: 'B4 33KV CHARGEMAN', status: 'Aktif' }, w.admin));
  assert.equal(G.readTable_('Personnel').find(x => x.staff_id === 'VES001').full_name, 'AHMAD FAKHRI BARU');
  assert.equal(G.readTable_('Personnel_Private').find(x => x.staff_id === 'VES001').ic_no, '900101-01-1234');
  ok(api('savePersonnel', { mode: 'update', staff_id: 'VES001', full_name: 'AHMAD FAKHRI BARU', phone: '' }, w.admin));
  assert.equal(G.readTable_('Personnel_Private').find(x => x.staff_id === 'VES001').phone, '');
  assert.equal(G.readTable_('Personnel_Private').find(x => x.staff_id === 'VES001').ic_no, '900101-01-1234');
  const log = G.readTable_('Audit_Log').filter(l => l.action === 'save_personnel');
  assert.ok(log.length >= 2); assert.ok(!JSON.stringify(log).includes('900101'), 'IC tak masuk audit');
});

test('input berbahaya: awalan formula dipagari, aksara kawalan dibuang', () => {
  const w = world();
  ok(api('savePersonnel', { mode: 'create', full_name: '=HYPERLINK("http://x")', notes: '+cmd|calc\u0007' }, w.admin));
  const sh = w.env.ss.getSheetByName('Personnel');
  const row = G.readTable_('Personnel').find(x => x.staff_id === 'VES004')._row;
  const hdr = G.headersOf_('Personnel');
  assert.ok(String(sh.getRange(row, hdr.indexOf('full_name') + 1).getValues()[0][0]).startsWith("'="));
  assert.ok(String(sh.getRange(row, hdr.indexOf('notes') + 1).getValues()[0][0]).startsWith("'+"));
  assert.ok(!/\u0007/.test(String(sh.getRange(row, hdr.indexOf('notes') + 1).getValues()[0][0])));
});

/* ---------------- Cert dan fail ---------------- */
test('saveCert: validasi medan', () => {
  const w = world();
  fail(api('saveCert', { staff_id: 'VES001', type_code: 'CIDB', expiry_date: '2027-02-20' }, w.admin), 'VALIDASI');                       // no cert wajib
  fail(api('saveCert', { staff_id: 'VES001', type_code: 'CIDB', cert_no: 'X1' }, w.admin), 'VALIDASI');                                  // expiry wajib
  fail(api('saveCert', Object.assign({}, certBase, { expiry_date: '2027-02-31' }), w.admin), 'VALIDASI');
  fail(api('saveCert', Object.assign({}, certBase, { issue_date: '2027-03-01' }), w.admin), 'VALIDASI');                                  // expiry < issue
  fail(api('saveCert', Object.assign({}, certBase, { type_code: 'NOPE' }), w.admin), 'VALIDASI');
  fail(api('saveCert', Object.assign({}, certBase, { staff_id: 'VES999' }), w.admin), 'VALIDASI');
  fail(api('saveCert', Object.assign({}, certBase, { cert_no: '<script>' }), w.admin), 'VALIDASI');
  assert.equal(G.readTable_('Certs').length, 0);
  const d = ok(api('saveCert', Object.assign({}, certBase, { issue_date: '2025-02-20', detail: 'Pengurus Projek Binaan, trade 522' }), w.admin));
  assert.equal(d.cert.record_status, 'Verified'); assert.equal(d.cert.expiry_date, '2027-02-20'); assert.equal(d.cert.cert_id, 'C-000001');
  assert.equal(d.cert.has_file, false);
  assert.equal(d.cert.verified_by, G.readTable_('Users').find(u => u.login_id === 'admin@voltake.test').user_id);
  // IC: tiada nombor, tiada expiry dikehendaki
  ok(api('saveCert', { staff_id: 'VES001', type_code: 'IC', file: { mime: 'image/jpeg', name: 'ic.jpg', data: b64(JPEG) } }, w.admin));
});

test('fail: JPG/PNG/PDF kecil diterima, simpan dalam Drive private ikut struktur, dibaca balik sama', () => {
  const w = world();
  const d = ok(api('saveCert', Object.assign({}, certBase, { file: { mime: 'image/jpeg', name: 'cidb.jpg', data: b64(JPEG) } }), w.admin));
  assert.equal(d.cert.has_file, true);
  assert.equal(d.cert.file_name, 'CIDB_20270220_C-000001.jpg');
  const root = w.env.root.kids.find(k => k.name === 'Compliance-Track');
  const folder = root.kids.find(k => k.name === 'Certs').kids.find(k => k.name === 'VES001');
  assert.equal(folder.files.length, 1, 'fail dalam Compliance-Track/Certs/VES001');
  const got = ok(api('getCertFile', { cert_id: 'C-000001' }, w.admin));
  assert.equal(got.mime, 'image/jpeg'); assert.ok(Buffer.from(got.data, 'base64').equals(JPEG));
  ok(api('saveCert', Object.assign({}, certBase, { type_code: 'NIOSH', cert_no: 'NTSP-1', file: { mime: 'image/png', name: 'n.png', data: b64(PNG) } }), w.admin));
  ok(api('saveCert', Object.assign({}, certBase, { type_code: 'WAH', cert_no: 'WAH-1', file: { mime: 'application/pdf', name: 'w.pdf', data: b64(PDF_SMALL) } }), w.admin));
  assert.equal(folder.files.length, 3);
  // file_id/pautan Drive tak pernah dalam respons
  const list = JSON.stringify(ok(api('listCerts', { staff_id: 'VES001' }, w.admin)));
  assert.ok(!/file-[0-9a-f]{8}/.test(list) && !list.includes('drive.google'));
});

test('fail ditolak: .exe, jenis palsu, kandungan tak sepadan, PDF 5 MB, JPG 8 MB, base64 rosak', () => {
  const w = world();
  const bad = file => { const r = fail(api('saveCert', Object.assign({}, certBase, { file }), w.admin)); assert.ok(['VALIDASI', 'PERMINTAAN_SALAH'].includes(r.code), r.code); };
  bad({ mime: 'application/x-msdownload', name: 'a.exe', data: b64(Buffer.from('MZ....')) });
  bad({ mime: 'image/jpeg', name: 'a.jpg', data: b64(Buffer.from('MZ' + 'x'.repeat(100))) });           // exe menyamar JPG
  bad({ mime: 'application/pdf', name: 'a.pdf', data: b64(JPEG) });                                       // jenis tak sepadan
  bad({ mime: 'application/pdf', name: 'big.pdf', data: b64(Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(5 * 1024 * 1024)])) });
  bad({ mime: 'image/jpeg', name: 'big.jpg', data: b64(Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(8 * 1024 * 1024)])) });
  bad({ mime: 'image/jpeg', name: 'x.jpg', data: '!!!bukan base64!!!' });
  bad({ mime: 'image/jpeg', name: 'x.jpg', data: '' });
  bad('bukan objek');
  assert.equal(G.readTable_('Certs').length, 0, 'tiada rekod dicipta bila fail ditolak');
  assert.equal(w.env.root.kids.find(k => k.name === 'Compliance-Track').kids.find(k => k.name === 'Certs').kids.length, 0, 'tiada folder/fail dicipta');
});

test('saveCert kemas kini: fail baru, nombor/tarikh berubah, status & jenis kekal', () => {
  const w = world();
  ok(api('saveCert', Object.assign({}, certBase, { file: { mime: 'image/jpeg', name: 'a.jpg', data: b64(JPEG) } }), w.admin));
  const d = ok(api('saveCert', { cert_id: 'C-000001', type_code: 'NIOSH', staff_id: 'VES002', cert_no: 'PJ-BARU', expiry_date: '2028-01-05', file: { mime: 'image/png', name: 'b.png', data: b64(PNG) } }, w.admin));
  assert.equal(d.cert.staff_id, 'VES001'); assert.equal(d.cert.type_code, 'CIDB');    // tak boleh pindah/tukar jenis
  assert.equal(d.cert.cert_no, 'PJ-BARU'); assert.equal(d.cert.expiry_date, '2028-01-05'); assert.equal(d.cert.file_name, 'CIDB_20280105_C-000001.png');
  assert.equal(G.readTable_('Certs').length, 1);
  assert.ok(Buffer.from(ok(api('getCertFile', { cert_id: 'C-000001' }, w.admin)).data, 'base64').equals(PNG));
  fail(api('saveCert', { cert_id: 'C-999999', cert_no: 'X' }, w.admin), 'TIADA');
});

test('listCerts R-02: tiada jenis IC, tiada Rejected/Superseded; admin nampak semua', () => {
  const w = world();
  ok(api('saveCert', certBase, w.admin));
  ok(api('saveCert', { staff_id: 'VES001', type_code: 'IC', file: { mime: 'image/jpeg', name: 'i.jpg', data: b64(JPEG) } }, w.admin));
  const now = new Date();
  G.withLock_(() => G.appendObjects_('Certs', [
    { cert_id: 'C-000010', staff_id: 'VES001', type_code: 'NIOSH', cert_no: 'P1', expiry_date: new Date(2027, 5, 1), record_status: 'Pending', submitted_by: 'U', submitted_at: now },
    { cert_id: 'C-000011', staff_id: 'VES001', type_code: 'NIOSH', cert_no: 'R1', expiry_date: new Date(2027, 5, 1), record_status: 'Rejected', reject_reason: 'kabur', submitted_by: 'U', submitted_at: now },
    { cert_id: 'C-000012', staff_id: 'VES001', type_code: 'NIOSH', cert_no: 'S1', expiry_date: new Date(2026, 5, 1), record_status: 'Superseded', submitted_by: 'U', submitted_at: now }
  ]));
  const lead = ok(api('listCerts', { staff_id: 'VES001' }, w.lead)).certs;
  assert.deepEqual(lead.map(c => c.cert_id).sort(), ['C-000001', 'C-000010']);
  assert.ok(!lead.some(c => c.type_code === 'IC'));
  const admin = ok(api('listCerts', { staff_id: 'VES001' }, w.admin)).certs;
  assert.equal(admin.length, 5);
  assert.equal(ok(api('listCerts', {}, w.lead)).certs.length, 2, 'tanpa tapis staff_id pun IC tak keluar');
  fail(api('listCerts', { staff_ids: 'bukan-array' }, w.lead), 'VALIDASI');
});

test('getCertFile: R-02 tolak IC, R-03 hanya fail sendiri (staff_id dari sesi), admin IC dilog', () => {
  const w = world();
  ok(api('saveCert', Object.assign({}, certBase, { file: { mime: 'image/jpeg', name: 'a.jpg', data: b64(JPEG) } }), w.admin));                         // C-000001 VES001 CIDB
  ok(api('saveCert', { staff_id: 'VES001', type_code: 'IC', file: { mime: 'image/jpeg', name: 'i.jpg', data: b64(JPEG) } }, w.admin));                   // C-000002 VES001 IC
  ok(api('saveCert', Object.assign({}, certBase, { staff_id: 'VES002', file: { mime: 'image/jpeg', name: 'b.jpg', data: b64(JPEG) } }), w.admin));      // C-000003 VES002 CIDB
  // Lead
  ok(api('getCertFile', { cert_id: 'C-000001' }, w.lead));
  fail(api('getCertFile', { cert_id: 'C-000002' }, w.lead), 'TIDAK_DIBENARKAN');
  // Staf VES001
  ok(api('getCertFile', { cert_id: 'C-000001' }, w.staf));
  ok(api('getCertFile', { cert_id: 'C-000002' }, w.staf));                                   // IC sendiri boleh
  fail(api('getCertFile', { cert_id: 'C-000003' }, w.staf), 'TIDAK_DIBENARKAN');             // orang lain
  fail(api('getCertFile', { cert_id: 'C-000003', staff_id: 'VES002' }, w.staf), 'TIDAK_DIBENARKAN'); // staff_id dalam request diabaikan
  // "tiada" dan "ditolak" jawapan sama (tak bocor kewujudan)
  assert.equal(api('getCertFile', { cert_id: 'C-999999' }, w.staf).error, api('getCertFile', { cert_id: 'C-000003' }, w.staf).error);
  // Admin IC dilog
  const before = G.readTable_('Audit_Log').filter(l => l.action === 'view_ic').length;
  ok(api('getCertFile', { cert_id: 'C-000002' }, w.admin));
  assert.equal(G.readTable_('Audit_Log').filter(l => l.action === 'view_ic').length, before + 1);
  // cert tanpa fail
  ok(api('saveCert', Object.assign({}, certBase, { type_code: 'NIOSH', cert_no: 'N9' }), w.admin));
  fail(api('getCertFile', { cert_id: 'C-000004' }, w.admin), 'FAIL_TIADA');
});

test('listCertTypes: Lead/Staf tak nampak jenis IC sensitif', () => {
  const w = world();
  assert.ok(ok(api('listCertTypes', {}, w.admin)).cert_types.some(t => t.type_code === 'IC'));
  const lead = ok(api('listCertTypes', {}, w.lead)).cert_types;
  assert.ok(!lead.some(t => t.type_code === 'IC')); assert.ok(lead.some(t => t.type_code === 'CIDB'));
  assert.ok(!ok(api('listCertTypes', {}, w.staf)).cert_types.some(t => t.type_code === 'IC'));
});

/* ---------------- Menu tambah user ---------------- */
test('addUserFromMenu: cipta Lead, PIN sekali, user boleh login dan wajib tukar PIN', () => {
  const w = world();
  w.env.promptQueue.push('Baru@Voltake.Test', 'Pn Baru', 'lead');
  const r = G.addUserFromMenu();
  assert.ok(r.user_id);
  const pin = /PIN sementara: (\d{6})/.exec(w.env.alerts.filter(a => a.t.startsWith('PIN user')).pop().m)[1];
  const d = ok(api('login', { login_id: 'baru@voltake.test', pin }));
  assert.equal(d.user.role, 'Lead'); assert.equal(d.user.must_change_pin, true);
  w.env.promptQueue.push('baru@voltake.test', 'X', 'admin');
  assert.equal(G.addUserFromMenu(), null, 'email berganda ditolak');
  w.env.promptQueue.push('x@y.test', 'X', 'superadmin');
  assert.equal(G.addUserFromMenu(), null, 'role tak sah ditolak');
});

test('healthCheck bersih selepas Fasa 1 beroperasi', () => {
  const w = world();
  ok(api('saveCert', Object.assign({}, certBase, { file: { mime: 'image/jpeg', name: 'a.jpg', data: b64(JPEG) } }), w.admin));
  ok(api('savePersonnel', { mode: 'create', full_name: 'Baru', ic_no: '910202025678', phone: '0123456780' }, w.admin));
  assert.deepEqual(G.runHealthCheck_().errors, []);
});
