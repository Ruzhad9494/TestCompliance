'use strict';
// E2E: app/index.html (Chromium sebenar) <-> Code.gs (dalam proses, melalui mock Apps Script).
// Pakej Tailwind/ikon dibekalkan secara lokal kerana CDN tak boleh dicapai dalam persekitaran ujian.
// Guna: node test/e2e.js <laluan tw.css> <folder screenshot>
process.env.TZ = 'Asia/Kuala_Lumpur';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { createEnv } = require('./mock');

const TW_CSS = fs.readFileSync(process.argv[2], 'utf8');
const SHOTS = process.argv[3]; fs.mkdirSync(SHOTS, { recursive: true });
const HTML = fs.readFileSync(path.join(__dirname, '..', '..', 'app', 'index.html'), 'utf8').replace('const API_URL = "";', 'const API_URL = "https://script.google.com/macros/s/TEST/exec";');
const G = globalThis;

// ---------- dunia backend ----------
const env = createEnv(); vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'));
G.setupSystem();
const adminPin = /PIN sementara: (\d{6})/.exec(env.alerts.find(a => a.t.startsWith('PIN admin')).m)[1];
const now = new Date();
G.withLock_(() => {
  G.appendObjects_('Personnel', [
    { staff_id: 'VES001', full_name: 'AHMAD FAKHRI BIN ZAKARIA', designation: 'ELECTRICAL CHARGEMAN', employer_type: 'Voltake', employer_name: 'V', status: 'Aktif', created_at: now, updated_at: now },
    { staff_id: 'VES002', full_name: 'SITI NUR BT RAHIM', designation: 'ELECTRICAL TECHNICIAN', employer_type: 'Voltake', employer_name: 'V', status: 'Aktif', created_at: now, updated_at: now }
  ]);
  G.appendObjects_('Personnel_Private', [{ staff_id: 'VES001', ic_no: '900101-01-1234', phone: '60123456789', updated_at: now }]);
  G.createUser_({ login_id: 'lead@voltake.test', full_name: 'LEAD UJIAN', role: 'Lead', staff_id: '', pin: '482915' });
});
G.generateStaffPins();
const pl = env.ss.getSheetByName('PIN_LIST');
const stafPin = pl.getRange(2, 4).getValues()[0][0]; // VES001

const apiLog = [];
function backend(body) { const out = G.doPost({ postData: { contents: body } }).getContent(); apiLog.push({ req: JSON.parse(body), res: out }); return out; }

let failures = 0;
async function step(name, fn) { try { await fn(); console.log('  ok   ' + name); } catch (e) { failures++; console.log('  GAGAL ' + name + '\n       ' + String(e.message).split('\n').slice(0, 4).join('\n       ')); } }

(async () => {
  const browser = await chromium.launch();
  async function newPage(viewport) {
    const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 800 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', e => page.errors.push(e.message));
    await page.route('http://app.test/', r => r.fulfill({ contentType: 'text/html', body: HTML }));
    await page.route('https://cdn.tailwindcss.com/**', r => r.fulfill({ contentType: 'application/javascript', body: 'window.tailwind={};(function(){var s=document.createElement("style");s.textContent=' + JSON.stringify(TW_CSS) + ';document.head.append(s)})();' }));
    await page.route('https://unpkg.com/**', r => r.fulfill({ contentType: 'application/javascript', body: '' }));
    await page.route('https://fonts.g*/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('https://script.google.com/macros/s/TEST/exec', r => {
      if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' } });
      r.fulfill({ contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: backend(r.request().postData()) });
    });
    await page.goto('http://app.test/');
    return page;
  }
  const login = async (page, id, pin) => { await page.fill('#login_id', id); await page.fill('#login_pin', pin); await page.click('button[type=submit]'); };
  const changePin = async (page, oldPin, newPin) => { await page.fill('#old_pin', oldPin); await page.fill('#new_pin', newPin); await page.fill('#new_pin2', newPin); await page.click('button[type=submit]'); };
  const text = page => page.evaluate(() => document.body.innerText);

  /* ================= ADMIN, desktop ================= */
  console.log('Admin (desktop 1280x800)');
  const page = await newPage();
  await step('login: paparan awal ada tajuk dan borang', async () => {
    await page.waitForSelector('#login_id');
    assert.match(await text(page), /Compliance Track/);
    await page.screenshot({ path: path.join(SHOTS, '01-login.png') });
  });
  await step('PIN salah: mesej generik', async () => {
    await login(page, 'admin@voltake.test', '000001');
    await page.waitForSelector('[role=alert]:not([hidden])');
    assert.match(await page.textContent('[role=alert]:not([hidden])'), /Email atau PIN salah/);
  });
  await step('login pertama: dipaksa tukar PIN, halaman lain tak boleh dibuka', async () => {
    await login(page, 'admin@voltake.test', adminPin);
    await page.waitForSelector('#old_pin');
    assert.match(await text(page), /login pertama/i);
    await page.evaluate(() => { location.hash = '#/tetapan'; });
    await page.waitForSelector('#old_pin');
    await page.screenshot({ path: path.join(SHOTS, '02-tukar-pin.png') });
  });
  await step('tukar PIN: PIN lemah dan tak sama ditolak, PIN baru diterima', async () => {
    await changePin(page, adminPin, '123456');
    await page.waitForSelector('[role=alert]:not([hidden])');
    assert.match(await page.textContent('[role=alert]:not([hidden])'), /terlalu mudah/);
    await page.fill('#new_pin', '739104'); await page.fill('#new_pin2', '739105'); await page.click('button[type=submit]');
    assert.match(await page.textContent('[role=alert]:not([hidden])'), /tak sama/);
    await changePin(page, adminPin, '739104');
    await page.waitForSelector('#psearch');
    assert.match(await text(page), /AHMAD FAKHRI/);
    await page.screenshot({ path: path.join(SHOTS, '03-senarai-personel.png') });
  });
  await step('navigasi admin: Personel dan Tetapan', async () => {
    const nav = await page.textContent('nav[aria-label="Menu utama"]');
    assert.match(nav, /Personel/); assert.match(nav, /Tetapan/);
  });
  await step('carian menapis senarai', async () => {
    await page.fill('#psearch', 'siti');
    const t = await page.textContent('#plist');
    assert.match(t, /SITI NUR/); assert.doesNotMatch(t, /AHMAD/);
    await page.fill('#psearch', 'zzzz');
    assert.match(await page.textContent('#plist'), /Tiada personel dijumpai/);
    await page.fill('#psearch', '');
  });
  await step('Tetapan > Personel baru: borang, validasi server dipaparkan, simpan berjaya', async () => {
    await page.click('nav[aria-label="Menu utama"] >> text=Tetapan');
    await page.waitForSelector('#btn-new-person');
    await page.click('#btn-new-person');
    await page.waitForSelector('#f_full_name');
    assert.equal(await page.inputValue('#f_staff_id'), 'VES003');
    await page.fill('#f_full_name', 'muhammad hakim'); await page.fill('#f_ic_no', '900101-01-1234'); // IC berganda
    await page.click('form button[type=submit]');
    await page.waitForSelector('form [role=alert]:not([hidden])');
    assert.match(await page.textContent('form [role=alert]:not([hidden])'), /sudah didaftarkan/);
    await page.fill('#f_ic_no', '910202025678'); await page.fill('#f_phone', '012-345 6789'); await page.fill('#f_designation', 'electrical technician');
    await page.screenshot({ path: path.join(SHOTS, '04-borang-personel.png') });
    await page.click('form button[type=submit]');
    await page.waitForSelector('#f_full_name', { state: 'detached' });
    await page.waitForFunction(() => document.querySelector('#plist') && /MUHAMMAD HAKIM/.test(document.querySelector('#plist').innerText));
    const p = G.readTable_('Personnel_Private').find(x => x.staff_id === 'VES003');
    assert.equal(p.ic_no, '910202-02-5678'); assert.equal(p.phone, '60123456789');
  });
  await step('edit personel: IC sedia ada dimuat (dan dilog), tak berubah jika tak disentuh', async () => {
    const before = G.readTable_('Audit_Log').filter(l => l.action === 'view_ic').length;
    await page.click('[aria-label="Edit AHMAD FAKHRI BIN ZAKARIA"]');
    await page.waitForSelector('#f_ic_no');
    assert.equal(await page.inputValue('#f_ic_no'), '900101-01-1234');
    assert.equal(G.readTable_('Audit_Log').filter(l => l.action === 'view_ic').length, before + 1);
    await page.fill('#f_designation', 'B4 33KV CHARGEMAN');
    await page.click('form button[type=submit]');
    await page.waitForSelector('#f_full_name', { state: 'detached' });
    assert.equal(G.readTable_('Personnel').find(x => x.staff_id === 'VES001').designation, 'B4 33KV CHARGEMAN');
    assert.equal(G.readTable_('Personnel_Private').find(x => x.staff_id === 'VES001').ic_no, '900101-01-1234');
    const lastSave = apiLog.filter(a => a.req.action === 'savePersonnel').pop().req.params;
    assert.ok(!('ic_no' in lastSave) && !('phone' in lastSave), 'IC/telefon tak dihantar bila tak diubah');
  });
  await step('XSS: nama berbahaya dipaparkan sebagai teks, skrip tak jalan', async () => {
    const r = JSON.parse(backend(JSON.stringify({ action: 'savePersonnel', token: apiLog.filter(a => a.req.action === 'login' && JSON.parse(a.res).ok).pop() && JSON.parse(apiLog.filter(a => a.req.action === 'login' && JSON.parse(a.res).ok).pop().res).data.token, params: { mode: 'create', full_name: '<img src=x onerror=window.__xss=1>', designation: '<b>tebal</b>' } })));
    assert.equal(r.ok, true, JSON.stringify(r));
    await page.evaluate(() => { location.hash = '#/personel'; });
    await page.waitForSelector('#plist');
    await page.reload(); await page.waitForSelector('#plist');
    assert.match(await page.textContent('#plist'), /<IMG SRC=X ONERROR=WINDOW\.__XSS=1>/);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.locator('#plist img').count(), 0);
  });

  await step('profil: Tambah cert, upload imej dikecilkan, simpan', async () => {
    await page.goto('http://app.test/#/personel/VES001'); await page.reload();
    await page.waitForSelector('#btn-add-cert');
    assert.match(await text(page), /Belum ada cert/);
    await page.click('#btn-add-cert'); await page.waitForSelector('#c_type');
    assert.equal(await page.inputValue('#c_type'), 'NIOSH', 'lalai bukan IC (jenis sensitif)');
    await page.selectOption('#c_type', 'CIDB');
    await page.fill('#c_no', 'PJ-T-6-B-0144-2025'); await page.fill('#c_expiry', '2027-02-20'); await page.fill('#c_detail', 'Pengurus Projek Binaan, trade 522');
    // imej 3000x2000 dijana dalam pelayar, mesti dikecilkan <=1600px dan jadi JPEG
    const big = await page.evaluate(async () => { const c = document.createElement('canvas'); c.width = 3000; c.height = 2000; const x = c.getContext('2d'); x.fillStyle = '#245'; x.fillRect(0, 0, 3000, 2000); x.fillStyle = '#fc0'; for (let i = 0; i < 400; i++) x.fillRect((i * 37) % 3000, (i * 91) % 2000, 60, 60); const b = await new Promise(r => c.toBlob(r, 'image/png')); return Array.from(new Uint8Array(await b.arrayBuffer())); });
    await page.setInputFiles('#c_file', { name: 'cidb.png', mimeType: 'image/png', buffer: Buffer.from(big) });
    await page.click('form button[type=submit]');
    await page.waitForSelector('#c_type', { state: 'detached' });
    await page.waitForSelector('[data-cert]');
    const sent = apiLog.filter(a => a.req.action === 'saveCert').pop().req.params.file;
    assert.equal(sent.mime, 'image/jpeg'); assert.ok(sent.name.endsWith('.jpg'));
    const bytes = Buffer.from(sent.data, 'base64'); assert.ok(bytes.length < 3 * 1024 * 1024, 'saiz ' + bytes.length);
    const dim = await page.evaluate(async b64 => { const i = new Image(); i.src = 'data:image/jpeg;base64,' + b64; await i.decode(); return [i.width, i.height]; }, sent.data);
    assert.deepEqual(dim, [1600, 1067]);
    const t = await text(page); assert.match(t, /PJ-T-6-B-0144-2025/); assert.match(t, /20\/02\/2027/);
    await page.screenshot({ path: path.join(SHOTS, '05-profil-cert.png') });
  });
  await step('fail ditolak di browser: .exe dan PDF 5 MB; tiada panggilan saveCert dibuat', async () => {
    const calls = apiLog.filter(a => a.req.action === 'saveCert').length;
    await page.click('#btn-add-cert'); await page.waitForSelector('#c_type');
    await page.selectOption('#c_type', 'NIOSH'); await page.fill('#c_no', 'N-1'); await page.fill('#c_expiry', '2027-05-05');
    await page.setInputFiles('#c_file', { name: 'x.pdf', mimeType: 'application/pdf', buffer: Buffer.concat([Buffer.from('%PDF-1.4'), Buffer.alloc(5 * 1024 * 1024)]) });
    await page.click('form button[type=submit]');
    await page.waitForSelector('form [role=alert]:not([hidden])');
    assert.match(await page.textContent('form [role=alert]:not([hidden])'), /PDF terlalu besar/);
    await page.setInputFiles('#c_file', { name: 'a.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') });
    await page.click('form button[type=submit]');
    await page.waitForFunction(() => /tak dibenarkan/.test(document.querySelector('form [role=alert]').textContent));
    assert.equal(apiLog.filter(a => a.req.action === 'saveCert').length, calls);
  });
  await step('validasi server dipaparkan (tarikh tamat wajib), kemudian simpan NIOSH tanpa fail', async () => {
    await page.setInputFiles('#c_file', []);
    await page.fill('#c_expiry', '');
    await page.click('form button[type=submit]');
    await page.waitForFunction(() => /Tarikh tamat wajib/.test(document.querySelector('form [role=alert]').textContent));
    await page.fill('#c_expiry', '2027-05-05');
    await page.click('form button[type=submit]');
    await page.waitForSelector('#c_type', { state: 'detached' });
    await page.waitForFunction(() => document.querySelectorAll('[data-cert]').length === 2);
  });
  await step('IC: borang sembunyi nombor/tarikh tamat (has_number/has_expiry false)', async () => {
    await page.click('#btn-add-cert'); await page.waitForSelector('#c_type');
    await page.selectOption('#c_type', 'IC');
    assert.equal(await page.isVisible('#c_no'), false); assert.equal(await page.isVisible('#c_expiry'), false);
    await page.keyboard.press('Escape'); await page.waitForSelector('#c_type', { state: 'detached' });
  });
  await step('Lihat fail: modal pratonton imej melalui getCertFile', async () => {
    await page.click('[data-cert] >> text=Lihat fail');
    await page.waitForSelector('[role=dialog] img');
    await page.screenshot({ path: path.join(SHOTS, '06-pratonton-fail.png') });
    await page.keyboard.press('Escape'); await page.waitForSelector('[role=dialog]', { state: 'detached' });
  });
  await step('tiada pautan Drive atau file_id dalam mana-mana respons API', async () => {
    const all = apiLog.map(a => a.res).join('\n');
    assert.ok(!/drive\.google|file-[0-9a-f]{12}/.test(all.replace(/"data":"[^"]{200,}"/g, '')));
  });
  await step('tema gelap boleh ditukar dan diingat', async () => {
    await page.click('[aria-label="Tukar tema"]');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
    await page.screenshot({ path: path.join(SHOTS, '07-gelap.png') });
    await page.click('[aria-label="Tukar tema"]');
  });
  await step('logout menghapus sesi; token lama ditolak server', async () => {
    const tok = await page.evaluate(() => sessionStorage.getItem('ct_token'));
    await page.click('#btn-logout'); await page.waitForSelector('#login_id');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('ct_token')), null);
    const r = JSON.parse(backend(JSON.stringify({ action: 'listPersonnel', token: tok, params: {} })));
    assert.equal(r.code, 'SESI_TAMAT');
  });
  assert.deepEqual(page.errors, [], 'ralat JS dalam halaman: ' + page.errors.join(' | '));

  /* ================= LEAD ================= */
  console.log('Lead');
  const lp = await newPage();
  const mark = apiLog.length;
  await step('Lead: login pertama tukar PIN, kemudian senarai tanpa Tetapan', async () => {
    await login(lp, 'lead@voltake.test', '482915'); await lp.waitForSelector('#old_pin');
    await changePin(lp, '482915', '270381'); await lp.waitForSelector('#psearch');
    const nav = await lp.textContent('nav[aria-label="Menu utama"]');
    assert.match(nav, /Personel/); assert.doesNotMatch(nav, /Tetapan/);
  });
  await step('Lead: URL #/tetapan dihalakan semula, tiada butang edit/tambah', async () => {
    await lp.evaluate(() => { location.hash = '#/tetapan'; });
    await lp.waitForSelector('#plist');
    assert.match(await lp.evaluate(() => location.hash), /#\/personel$/);
    assert.equal(await lp.locator('[aria-label^="Edit "]').count(), 0);
    assert.equal(await lp.locator('#btn-new-person').count(), 0);
  });
  await step('Lead: profil tanpa Tambah cert, IC/telefon/email tak muncul dalam halaman', async () => {
    await lp.click('text=AHMAD FAKHRI'); await lp.waitForSelector('[data-cert]');
    assert.equal(await lp.locator('#btn-add-cert').count(), 0);
    const t = await text(lp);
    assert.match(t, /PJ-T-6-B-0144-2025/);
    ['900101-01-1234', '60123456789', '0123456789'].forEach(s => assert.ok(!t.includes(s)));
    await lp.screenshot({ path: path.join(SHOTS, '08-lead-profil.png') });
  });
  await step('Lead: tiada ic_no/phone dalam MANA-MANA respons rangkaian sesi ini', async () => {
    const all = apiLog.slice(mark).map(a => a.res).join('\n');
    ['ic_no', 'phone', '900101-01-1234', '60123456789', 'drive.google'].forEach(s => assert.ok(!all.includes(s), 'bocor: ' + s));
  });
  await step('Lead: tak boleh buka fail IC (jenis IC tak dalam senarai)', async () => {
    const t = await text(lp); assert.doesNotMatch(t, /Salinan IC/);
  });
  assert.deepEqual(lp.errors, [], 'ralat JS: ' + lp.errors.join(' | '));

  /* ================= STAF ================= */
  console.log('Staf');
  const sp = await newPage();
  await step('Staf: login, tukar PIN, hanya halaman Cert saya; URL admin dihalakan semula', async () => {
    await login(sp, 'ves001', stafPin); await sp.waitForSelector('#old_pin');
    await changePin(sp, stafPin, '815263'); await sp.waitForSelector('text=Cert saya');
    const nav = await sp.textContent('nav[aria-label="Menu utama"]');
    assert.match(nav, /Cert saya/); assert.doesNotMatch(nav, /Personel|Tetapan/);
    for (const h of ['#/tetapan', '#/personel', '#/personel/VES001']) {
      await sp.evaluate(x => { location.hash = x; }, h); await sp.waitForTimeout(150);
      assert.match(await sp.evaluate(() => location.hash), /#\/cert-saya$/);
    }
  });
  await step('Staf: token staf dihalang server untuk action admin walaupun dipanggil terus', async () => {
    const tok = await sp.evaluate(() => sessionStorage.getItem('ct_token'));
    for (const a of ['savePersonnel', 'listPersonnel', 'listCerts', 'saveCert', 'getPersonnel']) {
      const r = JSON.parse(backend(JSON.stringify({ action: a, token: tok, params: { mode: 'create', full_name: 'X' } })));
      assert.equal(r.code, 'TIDAK_DIBENARKAN', a + ' -> ' + r.code);
    }
  });
  await step('Staf: 5 PIN salah dikunci, mesej kunci dipaparkan', async () => {
    const p2 = await newPage();
    for (let i = 0; i < 5; i++) { await login(p2, 'ves002', '111112'); await p2.waitForSelector('[role=alert]:not([hidden])'); await p2.waitForTimeout(80); }
    assert.match(await p2.textContent('[role=alert]:not([hidden])'), /dikunci 15 minit/);
  });
  assert.deepEqual(sp.errors, [], 'ralat JS: ' + sp.errors.join(' | '));

  /* ================= MOBILE ================= */
  console.log('Mobile (375x812)');
  const mp = await newPage({ width: 375, height: 812 });
  await step('mobile: login tiada skrol mendatar, bar navigasi bawah, sasaran sentuh >= 44px', async () => {
    const noScroll = async () => assert.ok(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'skrol mendatar');
    await noScroll(); await mp.screenshot({ path: path.join(SHOTS, '09-mobile-login.png') });
    await login(mp, 'admin@voltake.test', '739104'); await mp.waitForSelector('#psearch');
    await noScroll();
    const bottom = mp.locator('nav[aria-label="Menu utama"].fixed');
    assert.equal(await bottom.isVisible(), true);
    assert.equal(await mp.locator('aside, nav.hidden').first().isVisible().catch(() => false), false);
    await mp.screenshot({ path: path.join(SHOTS, '10-mobile-senarai.png') });
    const small = await mp.evaluate(() => [...document.querySelectorAll('button, a, input, select')].filter(e => e.offsetParent !== null).map(e => { const r = e.getBoundingClientRect(); return { t: (e.getAttribute('aria-label') || e.textContent || e.id || e.tagName).slice(0, 25), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.h < 44 && x.h > 0));
    assert.deepEqual(small.filter(x => !/^\s*$/.test(x.t)), [], 'sasaran < 44px');
    await mp.goto('http://app.test/#/personel/VES001'); await mp.reload(); await mp.waitForSelector('[data-cert]');
    await noScroll(); await mp.screenshot({ path: path.join(SHOTS, '11-mobile-profil.png') });
    await mp.click('#btn-add-cert'); await mp.waitForSelector('#c_type'); await noScroll();
    await mp.screenshot({ path: path.join(SHOTS, '12-mobile-modal.png') });
  });
  assert.deepEqual(mp.errors, [], 'ralat JS: ' + mp.errors.join(' | '));

  await browser.close();
  console.log(failures ? '\n' + failures + ' langkah GAGAL' : '\nSemua langkah E2E lulus');
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
