/**
 * Compliance Track - Code.gs
 * Voltake Energy Services Sdn Bhd
 *
 * Status: FASA 1 (Fasa 0 + router doPost, login/PIN/lockout, personel, cert, fail).
 * Readiness / pack / staf self-service / dashboard dibina dalam fasa 2 dan seterusnya.
 *
 * Skrip container-bound pada spreadsheet Compliance_DB (dan Compliance_DB_TEST).
 * Rujukan skema: BSD seksyen 3. Setup: BSD seksyen 6. Migrasi: BSD seksyen 7.
 */

var APP = { VERSION: '0.2.0-fasa1', TZ: 'Asia/Kuala_Lumpur' };

var DATE_FMT = 'dd/MM/yyyy';
var DATETIME_FMT = 'dd/MM/yyyy HH:mm';
var MAX_ROWS_FORMAT = 2000; // baris yang diberi format / dropdown

/* ------------------------------------------------------------------ */
/* SKEMA (BSD seksyen 3). Jenis: t=text d=date dt=datetime n=number b=bool */
/* ------------------------------------------------------------------ */
var SCHEMA = {
  Personnel: [['staff_id','t'],['full_name','t'],['designation','t'],['employer_type','t'],['employer_name','t'],['email','t'],['status','t'],['notes','t'],['created_at','dt'],['updated_at','dt']],
  Personnel_Private: [['staff_id','t'],['ic_no','t'],['phone','t'],['updated_at','dt']],
  Users: [['user_id','t'],['login_id','t'],['full_name','t'],['role','t'],['staff_id','t'],['pin_hash','t'],['salt','t'],['must_change_pin','b'],['active','b'],['failed_count','n'],['locked_until','dt'],['last_login','dt']],
  Cert_Types: [['type_code','t'],['type_name','t'],['issuer','t'],['has_number','b'],['has_expiry','b'],['is_sensitive','b'],['pack_order','n'],['active','b']],
  Certs: [['cert_id','t'],['staff_id','t'],['type_code','t'],['cert_no','t'],['detail','t'],['issue_date','d'],['expiry_date','d'],['file_id','t'],['file_name','t'],['record_status','t'],['reject_reason','t'],['submitted_by','t'],['submitted_at','dt'],['verified_by','t'],['verified_at','dt'],['remarks','t']],
  Role_Requirements: [['designation','t'],['required_types','t'],['note','t']],
  Jobs: [['job_id','t'],['job_name','t'],['client','t'],['site','t'],['start_date','d'],['end_date','d'],['extra_required_types','t'],['status','t'],['lead_user_id','t'],['created_by','t'],['created_at','dt'],['updated_at','dt'],['notes','t']],
  Job_Personnel: [['jp_id','t'],['job_id','t'],['staff_id','t'],['job_designation','t'],['sort_order','n'],['added_by','t'],['added_at','dt']],
  Pack_Log: [['pack_id','t'],['job_id','t'],['generated_by','t'],['generated_at','dt'],['person_count','n'],['include_ic','b'],['override_reason','t'],['snapshot_json','t']],
  Config: [['key','t'],['value','t']],
  Audit_Log: [['log_id','t'],['timestamp','dt'],['user_id','t'],['action','t'],['target','t'],['detail','t']],
  Migration_Report: [['source_tab','t'],['source_row','n'],['name_in_source','t'],['result','t'],['matched_staff_id','t'],['note','t']]
};

// Tab yang dicipta oleh setupSystem (Migration_Report dicipta oleh migrasi)
var SETUP_TABS = ['Personnel','Personnel_Private','Users','Cert_Types','Certs','Role_Requirements','Jobs','Job_Personnel','Pack_Log','Config','Audit_Log'];

var ENUMS = {
  'Personnel.employer_type': ['Voltake','Luar'],
  'Personnel.status': ['Aktif','Tidak aktif'],
  'Users.role': ['Admin','Lead','Staf'],
  'Certs.record_status': ['Pending','Verified','Rejected','Superseded'],
  'Jobs.status': ['Draf','Sedia','Dihantar','Selesai']
};

var COMPANY_NAME = 'Voltake Energy Services Sdn Bhd';
var COMPANY_ADDRESS = 'No. 22 & No. 22-1, Lorong Jawi Ria 1, Taman Jawi Ria, 14200 Jawi, Pulau Pinang, Malaysia';

var CERT_TYPES_SEED = [
  { type_code:'IC', type_name:'Salinan IC (MyKad)', issuer:'JPN', has_number:false, has_expiry:false, is_sensitive:true, pack_order:1, active:true },
  { type_code:'NIOSH', type_name:'NIOSH-Tenaga Safety Passport (NTSP)', issuer:'NIOSH', has_number:true, has_expiry:true, is_sensitive:false, pack_order:2, active:true },
  { type_code:'CIDB', type_name:'CIDB Personel Binaan (Green Card)', issuer:'CIDB', has_number:true, has_expiry:true, is_sensitive:false, pack_order:3, active:true },
  { type_code:'CHARGEMAN', type_name:'Sijil Kompetensi Chargeman', issuer:'Suruhanjaya Tenaga (perlu disahkan)', has_number:true, has_expiry:true, is_sensitive:false, pack_order:4, active:true },
  { type_code:'WAH', type_name:'Working at Height', issuer:'(isi pusat latihan)', has_number:true, has_expiry:true, is_sensitive:false, pack_order:5, active:true },
  { type_code:'FIRSTAID', type_name:'First Aid / CPR', issuer:'(isi pusat latihan)', has_number:true, has_expiry:true, is_sensitive:false, pack_order:6, active:true }
];

// Andaian daripada PDF Toyo Tyre. PERLU DISAHKAN dengan client/HSE (PRD soalan terbuka no. 1)
var ROLE_REQ_SEED = [
  { designation:'*', required_types:'CIDB,NIOSH', note:'Lalai. Andaian, perlu disahkan' },
  { designation:'O&M MANAGER', required_types:'CIDB,NIOSH', note:'' },
  { designation:'B4 33KV CHARGEMAN', required_types:'CIDB,NIOSH,CHARGEMAN', note:'' },
  { designation:'ELECTRICAL ENGINEER', required_types:'CIDB,NIOSH', note:'' },
  { designation:'ELECTRICAL CHARGEMAN', required_types:'CIDB,NIOSH,CHARGEMAN', note:'' },
  { designation:'ELECTRICAL TECHNICIAN', required_types:'CIDB,NIOSH', note:'' }
];

var CONFIG_SEED = [
  ['company_name', COMPANY_NAME],
  ['company_address', COMPANY_ADDRESS],
  ['logo_file_id', ''],
  ['pack_title_template', 'DETAILS OF WORKING PERSONNEL FOR SHUTDOWN WORKS AT {SITE}'],
  ['warning_days', '60'],
  ['reminder_days', '60,30,14,7'],
  ['reminder_emails', ''],
  ['drive_root_folder_id', ''],
  ['drive_backup_folder_id', ''],
  ['counter_cert', '0'],
  ['counter_user', '0'],
  ['counter_job', '0'],
  ['counter_jp', '0'],
  ['counter_pack', '0'],
  ['counter_log', '0'],
  ['session_hours', '6']
];

/* ------------------------------------------------------------------ */
/* MENU                                                                */
/* ------------------------------------------------------------------ */
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Compliance Track')
    .addItem('1. Setup sistem', 'setupSystem')
    .addItem('2. Import data lama', 'migrateOldData')
    .addItem('3. Jana PIN staf', 'generateStaffPins')
    .addItem('4. Semak kesihatan', 'healthCheck')
    .addItem('5. Tambah user Lead/Admin', 'addUserFromMenu')
    .addToUi();
}

/* ------------------------------------------------------------------ */
/* UTIL ASAS                                                           */
/* ------------------------------------------------------------------ */
function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }
function headersOf_(tab) { return SCHEMA[tab].map(function (c) { return c[0]; }); }
function pad_(n, w) { var s = String(n); while (s.length < w) s = '0' + s; return s; }
function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }

function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function getSheet_(tab) {
  var sh = ss_().getSheetByName(tab);
  if (!sh) throw new Error('Tab "' + tab + '" tiada. Jalankan menu Compliance Track > 1. Setup sistem dahulu.');
  return sh;
}

function tryUi_() { try { return SpreadsheetApp.getUi(); } catch (e) { return null; } }

function alert_(title, msg) {
  var ui = tryUi_();
  if (msg.length > 1800) msg = msg.substring(0, 1800) + '\n...(dipotong, lihat Execution log)';
  Logger.log(title + '\n' + msg);
  if (ui) { try { ui.alert(title, msg, ui.ButtonSet.OK); } catch (e) { /* ui tak tersedia */ } }
}

function promptText_(title, msg) {
  var ui = tryUi_();
  if (!ui) return '';
  var r = ui.prompt(title, msg, ui.ButtonSet.OK_CANCEL);
  return r.getSelectedButton() === ui.Button.OK ? String(r.getResponseText()).trim() : '';
}

// Elak formula injection bila data dieksport (TRD seksyen 6)
function safeCell_(v) {
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) return "'" + v;
  return v;
}

var lockDepth_ = 0;
function withLock_(fn) {
  var lock = null;
  if (lockDepth_ === 0) { lock = LockService.getScriptLock(); lock.waitLock(30000); }
  lockDepth_++;
  try { return fn(); }
  finally { lockDepth_--; if (lock) lock.releaseLock(); }
}

function assertHeaders_(sh, tab) {
  var hdr = headersOf_(tab);
  var row = sh.getRange(1, 1, 1, hdr.length).getValues()[0];
  for (var i = 0; i < hdr.length; i++) {
    if (String(row[i]) !== hdr[i]) throw new Error('Header tab "' + tab + '" lajur ' + (i + 1) + ' sepatutnya "' + hdr[i] + '" tapi "' + row[i] + '". Jalankan semak kesihatan.');
  }
}

function readTable_(tab) {
  var sh = getSheet_(tab);
  assertHeaders_(sh, tab);
  var hdr = headersOf_(tab);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, hdr.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var empty = true;
    for (var j = 0; j < hdr.length; j++) { if (vals[i][j] !== '' && vals[i][j] !== null) { empty = false; break; } }
    if (empty) continue;
    var o = { _row: i + 2 };
    for (var k = 0; k < hdr.length; k++) o[hdr[k]] = vals[i][k];
    out.push(o);
  }
  return out;
}

function appendObjects_(tab, objs) {
  if (!objs.length) return;
  var sh = getSheet_(tab);
  assertHeaders_(sh, tab);
  var hdr = headersOf_(tab);
  var rows = objs.map(function (o) {
    return hdr.map(function (h) { var v = o[h]; return safeCell_(v === undefined || v === null ? '' : v); });
  });
  var start = Math.max(sh.getLastRow(), 1) + 1;
  var need = start + rows.length - 1;
  if (sh.getMaxRows() < need) sh.insertRowsAfter(sh.getMaxRows(), need - sh.getMaxRows());
  sh.getRange(start, 1, rows.length, hdr.length).setValues(rows);
}

function fmtDate_(d, fmt, tz) { return Utilities.formatDate(d, tz || APP.TZ, fmt); }

/* ---- Config & counter ---- */
function getConfig_(key) {
  var rows = readTable_('Config');
  for (var i = 0; i < rows.length; i++) if (rows[i].key === key) return String(rows[i].value);
  return '';
}

function setConfig_(key, value) {
  var sh = getSheet_('Config');
  var last = sh.getLastRow();
  var data = last >= 2 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === key) { sh.getRange(i + 2, 2).setValue(String(value)); return; }
  }
  appendObjects_('Config', [{ key: key, value: String(value) }]);
}

// Mesti dipanggil dalam withLock_
function nextId_(counterKey, prefix, width) {
  var sh = getSheet_('Config');
  var last = sh.getLastRow();
  var data = last >= 2 ? sh.getRange(2, 1, last - 1, 2).getValues() : [];
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] === counterKey) {
      var n = (Number(data[i][1]) || 0) + 1;
      sh.getRange(i + 2, 2).setValue(String(n));
      return prefix + pad_(n, width);
    }
  }
  throw new Error('Config "' + counterKey + '" tiada. Jalankan Setup sistem.');
}

/* ---- Audit ---- */
function actorUserId_() {
  try {
    var email = (Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '').toLowerCase();
    if (email) {
      var users = readTable_('Users');
      for (var i = 0; i < users.length; i++) if (String(users[i].login_id).toLowerCase() === email) return users[i].user_id;
    }
  } catch (e) { /* abaikan */ }
  return 'SYSTEM';
}

// detail: ringkas, tanpa PIN, tanpa IC penuh
function audit_(userId, action, target, detail) {
  withLock_(function () {
    appendObjects_('Audit_Log', [{ log_id: nextId_('counter_log', 'L-', 6), timestamp: new Date(), user_id: userId, action: action, target: target || '', detail: detail || '' }]);
  });
}

/* ---- PIN ---- */
function hashPin_(salt, pin) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + pin, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function newSalt_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }

function isWeakPin_(pin) {
  if (pin === '000000' || pin === '123456' || pin === '654321') return true;
  return /^(\d)\1{5}$/.test(pin);
}

function randomPin_() {
  for (var t = 0; t < 50; t++) {
    var n = parseInt(Utilities.getUuid().replace(/-/g, '').substring(0, 8), 16) % 1000000;
    var pin = pad_(n, 6);
    if (!isWeakPin_(pin)) return pin;
  }
  throw new Error('Gagal jana PIN rawak');
}

// Mesti dalam withLock_
function createUser_(u) {
  var salt = newSalt_();
  var obj = {
    user_id: nextId_('counter_user', 'U-', 6),
    login_id: String(u.login_id).toLowerCase(),
    full_name: u.full_name,
    role: u.role,
    staff_id: u.staff_id || '',
    pin_hash: hashPin_(salt, u.pin),
    salt: salt,
    must_change_pin: true,
    active: true,
    failed_count: 0,
    locked_until: '',
    last_login: ''
  };
  appendObjects_('Users', [obj]);
  return obj;
}

/* ------------------------------------------------------------------ */
/* 1. SETUP SISTEM (BSD seksyen 6). Idempotent.                        */
/* ------------------------------------------------------------------ */
function setupSystem() {
  return withLock_(function () {
    var ss = ss_();
    var created = [], skipped = [], warnings = [];

    try { ss.setSpreadsheetTimeZone(APP.TZ); } catch (e) { warnings.push('Tak dapat set timezone sheet'); }

    // Langkah 1-5: tab, header, format, validasi, conditional formatting
    SETUP_TABS.forEach(function (tab) {
      var sh = ss.getSheetByName(tab);
      if (sh) { skipped.push('Tab ' + tab + ' (sudah ada)'); }
      else { sh = ss.insertSheet(tab); created.push('Tab ' + tab); }
      var okHeader = ensureHeaders_(sh, tab);
      if (!okHeader) { warnings.push('Header tab ' + tab + ' tak sepadan dengan BSD. Format tak dikemas kini. Jalankan Semak kesihatan'); return; }
      formatSheet_(sh, tab);
    });
    removeDefaultSheet_(ss);
    applyValidations_(ss);
    applyCertsConditionalFormatting_(ss.getSheetByName('Certs'));

    // Langkah 6: seed
    var added;
    added = seedRows_('Cert_Types', 'type_code', CERT_TYPES_SEED, false);
    (added ? created : skipped).push('Seed Cert_Types (' + added + ' baru)');
    added = seedRows_('Role_Requirements', 'designation', ROLE_REQ_SEED, true);
    (added ? created : skipped).push('Seed Role_Requirements (' + added + ' baru)');
    added = seedConfig_();
    (added ? created : skipped).push('Seed Config (' + added + ' baru)');

    // Langkah 7: folder Drive
    var driveInfo = ensureDriveFolders_();
    created = created.concat(driveInfo.created);
    skipped = skipped.concat(driveInfo.skipped);

    // Langkah 8: admin pertama
    var adminMsg = ensureFirstAdmin_();
    (adminMsg.created ? created : skipped).push(adminMsg.text);
    if (adminMsg.warning) warnings.push(adminMsg.warning);

    // Langkah 9: trigger
    ['dailyReminder', 'weeklyBackup'].forEach(function (fn) {
      var r = ensureTrigger_(fn);
      (r ? created : skipped).push('Trigger ' + fn + (r ? '' : ' (sudah ada)'));
    });

    audit_(actorUserId_(), 'setup', 'setupSystem', 'dicipta ' + created.length + ', dilangkau ' + skipped.length);

    // Langkah 10: ringkasan
    var msg = 'DICIPTA:\n- ' + (created.join('\n- ') || '(tiada)') + '\n\nDILANGKAU:\n- ' + (skipped.join('\n- ') || '(tiada)');
    if (warnings.length) msg += '\n\nAMARAN:\n- ' + warnings.join('\n- ');
    alert_('Setup sistem siap (' + APP.VERSION + ')', msg);
    return { created: created, skipped: skipped, warnings: warnings };
  });
}

function ensureHeaders_(sh, tab) {
  var hdr = headersOf_(tab);
  var existing = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, hdr.length).getValues()[0] : [];
  var rowEmpty = existing.every(function (v) { return v === '' || v === null || v === undefined; });
  var matches = !rowEmpty && hdr.every(function (h, i) { return String(existing[i]) === h; });
  if (!rowEmpty && !matches) return false;
  var r = sh.getRange(1, 1, 1, hdr.length);
  r.setValues([hdr]);
  r.setFontWeight('bold');
  r.setBackground('#e2e8f0');
  sh.setFrozenRows(1);
  return true;
}

function formatSheet_(sh, tab) {
  var rows = Math.max(Math.min(sh.getMaxRows(), MAX_ROWS_FORMAT) - 1, 1);
  SCHEMA[tab].forEach(function (c, i) {
    var fmt = { t: '@', d: DATE_FMT, dt: DATETIME_FMT, n: '0' }[c[1]];
    if (fmt) sh.getRange(2, i + 1, rows, 1).setNumberFormat(fmt);
  });
}

function removeDefaultSheet_(ss) {
  ['Sheet1', 'Sheet 1', 'Helaian1', 'Helaian 1'].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() === 0 && sh.getLastColumn() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

function applyValidations_(ss) {
  function dd(tab, col, rule) {
    var sh = ss.getSheetByName(tab);
    var idx = headersOf_(tab).indexOf(col) + 1;
    var rows = Math.max(Math.min(sh.getMaxRows(), MAX_ROWS_FORMAT) - 1, 1);
    sh.getRange(2, idx, rows, 1).setDataValidation(rule);
  }
  Object.keys(ENUMS).forEach(function (k) {
    var p = k.split('.');
    dd(p[0], p[1], SpreadsheetApp.newDataValidation().requireValueInList(ENUMS[k], true).setAllowInvalid(false).build());
  });
  var ct = ss.getSheetByName('Cert_Types');
  var codeRange = ct.getRange(2, 1, Math.max(Math.min(ct.getMaxRows(), MAX_ROWS_FORMAT) - 1, 1), 1);
  dd('Certs', 'type_code', SpreadsheetApp.newDataValidation().requireValueInRange(codeRange, true).setAllowInvalid(false).build());
}

function applyCertsConditionalFormatting_(sh) {
  var col = headersOf_('Certs').indexOf('expiry_date') + 1;
  var L = colLetter_(col);
  var rows = Math.max(Math.min(sh.getMaxRows(), MAX_ROWS_FORMAT) - 1, 1);
  var range = sh.getRange(2, col, rows, 1);
  var red = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(' + L + '2<>"",' + L + '2<TODAY())').setBackground('#FFF1F2').setFontColor('#BE123C').setRanges([range]).build();
  var yellow = SpreadsheetApp.newConditionalFormatRule()
    .whenFormulaSatisfied('=AND(' + L + '2<>"",' + L + '2>=TODAY(),' + L + '2<=TODAY()+60)').setBackground('#FFFBEB').setFontColor('#B45309').setRanges([range]).build();
  sh.setConditionalFormatRules([red, yellow]);
}

function seedRows_(tab, keyField, seeds, caseInsensitive) {
  var existing = readTable_(tab).map(function (r) { var k = String(r[keyField]); return caseInsensitive ? k.toUpperCase() : k; });
  var toAdd = seeds.filter(function (s) { var k = String(s[keyField]); return existing.indexOf(caseInsensitive ? k.toUpperCase() : k) < 0; });
  appendObjects_(tab, toAdd);
  return toAdd.length;
}

function seedConfig_() {
  var existing = readTable_('Config').map(function (r) { return r.key; });
  var toAdd = CONFIG_SEED.filter(function (p) { return existing.indexOf(p[0]) < 0; }).map(function (p) { return { key: p[0], value: p[1] }; });
  appendObjects_('Config', toAdd);
  return toAdd.length;
}

function findOrCreateFolder_(parent, name) {
  var it = parent.getFoldersByName(name);
  if (it.hasNext()) return { folder: it.next(), created: false };
  return { folder: parent.createFolder(name), created: true };
}

function ensureDriveFolders_() {
  var created = [], skipped = [];
  var root = DriveApp.getRootFolder();
  var rootRes = null;
  var rootId = getConfig_('drive_root_folder_id');
  if (rootId) { try { rootRes = { folder: DriveApp.getFolderById(rootId), created: false }; } catch (e) { rootRes = null; } }
  if (!rootRes) rootRes = findOrCreateFolder_(root, 'Compliance-Track');
  (rootRes.created ? created : skipped).push('Folder Compliance-Track' + (rootRes.created ? '' : ' (sudah ada)'));
  setConfig_('drive_root_folder_id', rootRes.folder.getId());

  var certs = findOrCreateFolder_(rootRes.folder, 'Certs');
  (certs.created ? created : skipped).push('Folder Certs' + (certs.created ? '' : ' (sudah ada)'));
  var backup = findOrCreateFolder_(rootRes.folder, 'Backup');
  (backup.created ? created : skipped).push('Folder Backup' + (backup.created ? '' : ' (sudah ada)'));
  setConfig_('drive_backup_folder_id', backup.folder.getId());
  return { created: created, skipped: skipped };
}

/**
 * Admin pertama. PIN dipaparkan SEKALI dalam dialog, kemudian baru disimpan.
 * Jika dialog tak tersedia (skrip dijalankan bila spreadsheet tak dibuka), admin TIDAK dicipta
 * supaya PIN tak hilang. Jalankan semula dari menu.
 */
function ensureFirstAdmin_() {
  var admins = readTable_('Users').filter(function (u) { return u.role === 'Admin' && isTrue_(u.active); });
  if (admins.length) return { created: false, text: 'User Admin (sudah ada)' };

  var email = (Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || '').toLowerCase();
  var ui = tryUi_();
  if (!ui) return { created: false, text: 'User Admin (belum dicipta)', warning: 'Dialog tak tersedia, admin belum dicipta. Buka spreadsheet dan jalankan semula dari menu Compliance Track > 1. Setup sistem' };
  if (!email) email = promptText_('Email admin', 'Email akaun tak dapat dikesan. Taip email untuk login admin:').toLowerCase();
  if (!email) return { created: false, text: 'User Admin (belum dicipta)', warning: 'Email admin tiada, admin belum dicipta' };

  var pin = randomPin_();
  ui.alert('PIN admin (HANYA SEKALI)', 'Login: ' + email + '\nPIN sementara: ' + pin + '\n\nTulis dalam tempat selamat sekarang. Ia tak akan dipaparkan lagi. Anda wajib tukar PIN pada login pertama.', ui.ButtonSet.OK);
  createUser_({ login_id: email, full_name: 'Admin', role: 'Admin', staff_id: '', pin: pin });
  return { created: true, text: 'User Admin (' + email + ')' };
}

function ensureTrigger_(fn) {
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === fn; });
  if (has) return false;
  var b = ScriptApp.newTrigger(fn).timeBased();
  if (fn === 'dailyReminder') b.everyDays(1).atHour(8).inTimezone(APP.TZ).create();
  else b.onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(2).inTimezone(APP.TZ).create();
  return true;
}

// Dibina dalam Fasa 5. Trigger dipasang awal supaya tak perlu setup semula.
function dailyReminder() { Logger.log('dailyReminder: belum dilaksanakan (Fasa 5)'); }
function weeklyBackup() { Logger.log('weeklyBackup: belum dilaksanakan (Fasa 5)'); }

/* ------------------------------------------------------------------ */
/* PARSING & PADANAN (fungsi tulen, diuji di Node)                     */
/* ------------------------------------------------------------------ */
var CONNECTORS_ = ['BIN', 'BINTI', 'BT', 'BTE', 'B', 'A/L', 'A/P', 'ANAK', 'S/O', 'D/O'];

function normName_(s) {
  return String(s === null || s === undefined ? '' : s).replace(/[ ​]/g, ' ').toUpperCase().replace(/\s+/g, ' ').trim();
}

function coreName_(s) {
  return normName_(s).replace(/[.,'’]/g, ' ').split(/\s+/).filter(function (t) { return t && CONNECTORS_.indexOf(t) < 0; }).join(' ');
}

/** Pulang {type:'exact'|'fuzzy'|'ambiguous'|'none', person, candidates} */
function matchPerson_(name, people) {
  var n = normName_(name);
  if (!n) return { type: 'none', candidates: [] };
  var exact = people.filter(function (p) { return normName_(p.full_name) === n; });
  if (exact.length === 1) return { type: 'exact', person: exact[0], candidates: exact };
  if (exact.length > 1) return { type: 'ambiguous', candidates: exact };
  var core = coreName_(n);
  var fuzzy = core ? people.filter(function (p) { return coreName_(p.full_name) === core; }) : [];
  if (fuzzy.length === 1) return { type: 'fuzzy', person: fuzzy[0], candidates: fuzzy };
  if (fuzzy.length > 1) return { type: 'ambiguous', candidates: fuzzy };
  return { type: 'none', candidates: [] };
}

/**
 * Tukar nilai sel kepada Date sebenar (tengah malam zon skrip). Tak meneka.
 * Terima: Date, "DD/MM/YYYY" (juga - atau .), "YYYY-MM-DD". Selain itu 'bad'.
 * srcTz: timezone spreadsheet sumber supaya Date tak anjak sehari.
 */
function parseDateAny_(v, srcTz) {
  if (v === '' || v === null || v === undefined) return { state: 'empty', date: null };
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return { state: 'bad', date: null };
    var iso = Utilities.formatDate(v, srcTz || APP.TZ, 'yyyy-MM-dd').split('-');
    return mkDate_(+iso[0], +iso[1], +iso[2]);
  }
  var s = String(v).replace(/[ ​]/g, ' ').trim();
  if (!s) return { state: 'empty', date: null };
  var m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  if (m) return mkDate_(+m[3], +m[2], +m[1]);
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return mkDate_(+m[1], +m[2], +m[3]);
  return { state: 'bad', date: null };
}

function mkDate_(y, mo, d) {
  if (y < 2000 || y > 2100) return { state: 'bad', date: null };
  var dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return { state: 'bad', date: null };
  return { state: 'ok', date: dt };
}

/** Ambil ID fail Drive daripada pautan. Pautan folder TIDAK diterima. */
function extractFileId_(s) {
  s = String(s === null || s === undefined ? '' : s);
  var m = /\/d\/([A-Za-z0-9_-]{15,})/.exec(s) || /[?&]id=([A-Za-z0-9_-]{15,})/.exec(s);
  return m ? m[1] : '';
}

/** Untuk ID spreadsheet yang ditampal admin: URL atau ID kosong */
function extractSheetId_(s) {
  s = String(s || '').trim();
  var id = extractFileId_(s);
  if (id) return id;
  return /^[A-Za-z0-9_-]{25,}$/.test(s) ? s : '';
}

function headerKey_(h) { return String(h === null || h === undefined ? '' : h).toLowerCase().replace(/[^a-z0-9]/g, ''); }

/* ------------------------------------------------------------------ */
/* 2. IMPORT DATA LAMA (BSD seksyen 7). Baca sahaja pada sheet lama.   */
/* ------------------------------------------------------------------ */
var OLD_CERT_COLS_ = {
  id: ['id', 'staffid'],
  name: ['name', 'nama', 'fullname'],
  types: {
    CIDB: { date: ['cidb'], file: ['cidbcert'] },
    NIOSH: { date: ['niosh'], file: ['nioshcert'] },
    WAH: { date: ['workingatheight', 'wah'], file: ['wahcert', 'workingatheightcert'] },
    FIRSTAID: { date: ['firstaid'], file: ['firstaidcert'] }
  }
};
var OLD_CHARGEMAN_COLS_ = {
  site: ['solarfarm', 'site'],
  name: ['chargemanname', 'name', 'nama'],
  no: ['competencyno', 'competencynumber', 'competencyno'],
  expiry: ['expirydate', 'expiry'],
  doc: ['document', 'doc', 'file']
};

function migrateOldData() {
  var input = promptText_('Import data lama', 'Tampal ID atau URL spreadsheet lama (hanya dibaca, tak diubah). Disarankan guna salinan dahulu:');
  if (!input) { alert_('Import dibatalkan', 'Tiada ID spreadsheet diberi.'); return null; }
  var id = extractSheetId_(input);
  if (!id) { alert_('Import dibatalkan', 'ID atau URL spreadsheet tak sah.'); return null; }
  var oldSs;
  try { oldSs = SpreadsheetApp.openById(id); }
  catch (e) { alert_('Import gagal', 'Tak dapat buka spreadsheet lama: ' + e.message); return null; }
  var res = runMigration_(oldSs);
  var msg = 'Baris sumber dengan data cert: ' + res.sourceItems + '\n' +
    'Cert dicipta: ' + res.created + '\n' +
    'Cert sudah ada (dilangkau): ' + res.skippedDuplicate + '\n' +
    'Cert tak boleh dicipta (tarikh tak terbaca & tiada fail, atau jenis tak sah): ' + res.unreadable + '\n' +
    'Semakan: ' + res.created + ' + ' + res.skippedDuplicate + ' + ' + res.unreadable + ' = ' + (res.created + res.skippedDuplicate + res.unreadable) + ' (sepatutnya ' + res.sourceItems + ')\n' +
    'Personel baru: ' + res.newPersonnel + ' (daripada itu Luar: ' + res.newOutsiders + ')\n' +
    'Cert ditanda Pending (tiada tarikh tamat): ' + res.pendingNoExpiry + '\n' +
    'Baris Perlu semak dalam Migration_Report: ' + res.needReview + '\n\n' +
    'Seterusnya: semak tab Migration_Report, jalankan 4. Semak kesihatan, buka 3 personel rawak dan banding dengan sheet lama.';
  alert_('Import siap', msg);
  return res;
}

// Baca tab lama: nilai + pautan (formula HYPERLINK, rich text, atau teks URL)
function readOldTab_(sh) {
  var last = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (last < 1 || lastCol < 1) return { keys: [], rawHeaders: [], rows: [] };
  var rng = sh.getRange(1, 1, last, lastCol);
  var vals = rng.getValues();
  var formulas = [], rich = [];
  try { formulas = rng.getFormulas(); } catch (e) { formulas = []; }
  try { rich = rng.getRichTextValues(); } catch (e) { rich = []; }
  var rawHeaders = vals[0].map(function (h) { return String(h); });
  var keys = rawHeaders.map(headerKey_);
  var rows = [];
  for (var i = 1; i < vals.length; i++) {
    var cells = vals[i].map(function (v, j) {
      var f = formulas[i] && formulas[i][j] ? String(formulas[i][j]) : '';
      var link = '';
      var fm = /HYPERLINK\(\s*"([^"]+)"/i.exec(f);
      if (fm) link = fm[1];
      if (!link && rich[i] && rich[i][j]) { try { link = rich[i][j].getLinkUrl() || ''; } catch (e) { /* abaikan */ } }
      return { v: v, link: link };
    });
    rows.push({ rowNum: i + 1, cells: cells });
  }
  return { keys: keys, rawHeaders: rawHeaders, rows: rows };
}

function colIdx_(keys, aliases) {
  for (var a = 0; a < aliases.length; a++) { var i = keys.indexOf(aliases[a]); if (i >= 0) return i; }
  return -1;
}

function cellText_(c) { return c ? String(c.v === null || c.v === undefined ? '' : c.v).trim() : ''; }

function cellFileId_(c) {
  if (!c) return '';
  return extractFileId_(c.link) || extractFileId_(c.v);
}

function findTabCI_(ss, name) {
  var all = ss.getSheets();
  for (var i = 0; i < all.length; i++) if (String(all[i].getName()).trim().toLowerCase() === name.toLowerCase()) return all[i];
  return null;
}

function nextStaffId_(people) {
  var max = 0;
  people.forEach(function (p) { var m = /^VES(\d+)$/.exec(String(p.staff_id)); if (m) max = Math.max(max, +m[1]); });
  return 'VES' + pad_(max + 1, 3);
}

function runMigration_(oldSs) {
  return withLock_(function () {
    var now = new Date();
    var srcTz = APP.TZ;
    try { srcTz = oldSs.getSpreadsheetTimeZone() || APP.TZ; } catch (e) { /* guna lalai */ }

    var people = readTable_('Personnel');
    var existingCerts = readTable_('Certs');
    var typeCodes = readTable_('Cert_Types').map(function (t) { return t.type_code; });

    var dupKeys = {};
    function certKey_(staff, type, expiry, fileId, detail) {
      return [staff, type, expiry ? Utilities.formatDate(expiry, APP.TZ, 'yyyy-MM-dd') : '', fileId, detail || ''].join('|');
    }
    existingCerts.forEach(function (c) {
      if (c.verified_by === 'MIGRASI') {
        var exp = Object.prototype.toString.call(c.expiry_date) === '[object Date]' ? c.expiry_date : null;
        dupKeys[certKey_(c.staff_id, c.type_code, exp, c.file_id, c.detail)] = true;
      }
    });

    var report = [];
    var newPeople = [], newCerts = [];
    var stats = { sourceItems: 0, created: 0, skippedDuplicate: 0, unreadable: 0, newPersonnel: 0, newOutsiders: 0, pendingNoExpiry: 0, needReview: 0 };

    function addReport_(tab, row, name, result, staffId, note) {
      if (result === 'Perlu semak') stats.needReview++;
      report.push({ source_tab: tab, source_row: row, name_in_source: name, result: result, matched_staff_id: staffId || '', note: note || '' });
    }

    // helper: cipta 1 cert, tangani duplikasi dan tarikh. Pulang nota (string) atau ''.
    function makeCert_(staffId, typeCode, expiryRes, rawExpiry, fileId, certNo, detail, extraRemark) {
      var notes = [];
      var hasExpiry = true;
      var d = expiryRes.state === 'ok' ? expiryRes.date : null;
      if (expiryRes.state === 'bad') notes.push(typeCode + ': tarikh tak boleh dibaca "' + rawExpiry + '"');
      if (typeCodes.indexOf(typeCode) < 0) { stats.unreadable++; notes.push(typeCode + ': jenis cert tiada dalam Cert_Types, dilangkau'); return notes.join('; '); }
      if (!d && !fileId) { stats.unreadable++; if (expiryRes.state !== 'bad') notes.push(typeCode + ': tiada tarikh dan tiada fail'); notes.push(typeCode + ': cert tak dicipta'); return notes.join('; '); }
      var key = certKey_(staffId, typeCode, d, fileId, detail);
      if (dupKeys[key]) { stats.skippedDuplicate++; return notes.join('; '); }
      dupKeys[key] = true;
      var remarks = 'Migrasi dari ' + (extraRemark || 'Cert tab') + ', belum disemak ulang';
      var status = 'Verified';
      if (hasExpiry && !d) {
        // Verified tanpa tarikh tamat melanggar skema (expiry wajib). Tahan sebagai Pending sehingga admin isi tarikh.
        status = 'Pending';
        stats.pendingNoExpiry++;
        remarks += '. Tarikh tamat tiada/tak terbaca, ditahan Pending';
        notes.push(typeCode + ': ditanda Pending (tiada tarikh tamat)');
      }
      newCerts.push({
        cert_id: nextId_('counter_cert', 'C-', 6), staff_id: staffId, type_code: typeCode, cert_no: certNo || '', detail: detail || '',
        issue_date: '', expiry_date: d || '', file_id: fileId || '', file_name: '', record_status: status, reject_reason: '',
        submitted_by: 'MIGRASI', submitted_at: now, verified_by: status === 'Verified' ? 'MIGRASI' : '', verified_at: status === 'Verified' ? now : '', remarks: remarks
      });
      stats.created++;
      return notes.join('; ');
    }
    // verified_by untuk Pending: kosong. Tapi dupKeys perlu kenal rekod Pending juga (rujuk MIGRASI submitted_by)
    existingCerts.forEach(function (c) {
      if (c.submitted_by === 'MIGRASI' && c.verified_by !== 'MIGRASI') {
        var exp = Object.prototype.toString.call(c.expiry_date) === '[object Date]' ? c.expiry_date : null;
        dupKeys[certKey_(c.staff_id, c.type_code, exp, c.file_id, c.detail)] = true;
      }
    });

    // ---------- Tab Cert ----------
    var certSh = findTabCI_(oldSs, 'Cert');
    if (!certSh) {
      addReport_('Cert', 0, '', 'Perlu semak', '', 'Tab "Cert" tak dijumpai dalam sheet lama');
    } else {
      var t = readOldTab_(certSh);
      var iId = colIdx_(t.keys, OLD_CERT_COLS_.id), iName = colIdx_(t.keys, OLD_CERT_COLS_.name);
      if (iId < 0 || iName < 0) {
        addReport_('Cert', 1, '', 'Perlu semak', '', 'Lajur ID atau NAME tak dijumpai. Header sebenar: ' + t.rawHeaders.join(' | '));
      } else {
        var typeCols = {};
        Object.keys(OLD_CERT_COLS_.types).forEach(function (code) {
          typeCols[code] = { date: colIdx_(t.keys, OLD_CERT_COLS_.types[code].date), file: colIdx_(t.keys, OLD_CERT_COLS_.types[code].file) };
        });
        t.rows.forEach(function (row) {
          var id = cellText_(row.cells[iId]).toUpperCase();
          var name = normName_(cellText_(row.cells[iName]));
          if (!id && !name && row.cells.every(function (c) { return cellText_(c) === ''; })) return; // baris kosong
          // kira item cert dalam baris (untuk semakan jumlah)
          var items = [];
          Object.keys(typeCols).forEach(function (code) {
            var dc = typeCols[code].date >= 0 ? row.cells[typeCols[code].date] : null;
            var fc = typeCols[code].file >= 0 ? row.cells[typeCols[code].file] : null;
            var raw = cellText_(dc);
            var fid = cellFileId_(fc);
            var rawFile = cellText_(fc);
            if (raw !== '' || rawFile !== '' || (fc && fc.link)) items.push({ code: code, dc: dc, fc: fc, raw: raw, fid: fid, rawFile: rawFile });
          });
          stats.sourceItems += items.length;

          if (!id || !/^VES\d{3,}$/.test(id) || !name) {
            stats.unreadable += items.length;
            addReport_('Cert', row.rowNum, name, 'Perlu semak', '', 'Baris dilangkau: ID "' + id + '" kosong/format salah atau nama kosong. ' + items.length + ' item cert tak diimport');
            return;
          }
          var notes = [], isNew = false;
          var person = people.filter(function (p) { return p.staff_id === id; })[0];
          if (!person) {
            person = { staff_id: id, full_name: name, designation: '', employer_type: 'Voltake', employer_name: COMPANY_NAME, email: '', status: 'Aktif', notes: 'Migrasi: designation belum diisi', created_at: now, updated_at: now };
            people.push(person); newPeople.push(person); stats.newPersonnel++; isNew = true;
            notes.push('designation kosong, isi oleh admin');
          } else if (normName_(person.full_name) !== name) {
            notes.push('nama berbeza daripada Personnel: "' + person.full_name + '" vs "' + name + '"');
          }
          items.forEach(function (it) {
            var er = parseDateAny_(it.dc ? it.dc.v : '', srcTz);
            if (it.rawFile !== '' && !it.fid) notes.push(it.code + ': pautan fail tak dikenali "' + it.rawFile.substring(0, 60) + '"');
            var n = makeCert_(id, it.code, er, it.raw, it.fid, '', '', 'Cert tab');
            if (n) notes.push(n);
          });
          var review = notes.filter(function (n) { return n.indexOf('designation kosong') < 0; }).length > 0;
          addReport_('Cert', row.rowNum, name, review ? 'Perlu semak' : (isNew ? 'Baru' : 'Dipadan'), id, notes.join('; '));
        });
      }
    }

    // ---------- Tab Chargeman License ----------
    var cmSh = findTabCI_(oldSs, 'Chargeman License');
    if (!cmSh) {
      addReport_('Chargeman License', 0, '', 'Perlu semak', '', 'Tab "Chargeman License" tak dijumpai dalam sheet lama');
    } else {
      var ct = readOldTab_(cmSh);
      var cSite = colIdx_(ct.keys, OLD_CHARGEMAN_COLS_.site), cName = colIdx_(ct.keys, OLD_CHARGEMAN_COLS_.name),
        cNo = colIdx_(ct.keys, OLD_CHARGEMAN_COLS_.no), cExp = colIdx_(ct.keys, OLD_CHARGEMAN_COLS_.expiry), cDoc = colIdx_(ct.keys, OLD_CHARGEMAN_COLS_.doc);
      if (cName < 0) {
        addReport_('Chargeman License', 1, '', 'Perlu semak', '', 'Lajur Chargeman Name tak dijumpai. Header sebenar: ' + ct.rawHeaders.join(' | '));
      } else {
        // Lajur NRIC (mungkin tersembunyi) sengaja TIDAK diimport
        var sensitive = ct.rawHeaders.filter(function (h) { var k = headerKey_(h); return k.indexOf('nric') >= 0 || k === 'ic' || k.indexOf('icno') >= 0 || k.indexOf('mykad') >= 0; });
        if (sensitive.length) addReport_('Chargeman License', 1, '', 'Perlu semak', '', 'Lajur sensitif dijumpai (' + sensitive.join(', ') + ') dan TIDAK diimport. Admin putuskan sama ada masuk Personnel_Private.ic_no');
        ct.rows.forEach(function (row) {
          var rawName = cellText_(row.cells[cName]);
          var site = cSite >= 0 ? cellText_(row.cells[cSite]) : '';
          var no = cNo >= 0 ? cellText_(row.cells[cNo]) : '';
          var rawExp = cExp >= 0 ? cellText_(row.cells[cExp]) : '';
          var docCell = cDoc >= 0 ? row.cells[cDoc] : null;
          var fid = cellFileId_(docCell), rawDoc = cellText_(docCell);
          var hasData = rawName || site || no || rawExp || rawDoc;
          if (!hasData) return;
          // semua lajur bukan-sensitif dikira sebagai item
          var isItem = !!(rawExp || rawDoc || no);
          if (isItem) stats.sourceItems++;
          if (!rawName) {
            if (isItem) stats.unreadable++;
            addReport_('Chargeman License', row.rowNum, '', 'Perlu semak', '', 'Nama kosong, baris dilangkau' + (isItem ? ', 1 item cert tak diimport' : ''));
            return;
          }
          var name = normName_(rawName), notes = [], result, staffId;
          var m = matchPerson_(name, people);
          if (m.type === 'exact') { result = 'Dipadan'; staffId = m.person.staff_id; }
          else if (m.type === 'fuzzy') { result = 'Perlu semak'; staffId = m.person.staff_id; notes.push('padanan hampir: "' + name + '" vs "' + m.person.full_name + '"'); }
          else {
            var np = { staff_id: nextStaffId_(people), full_name: name, designation: '', employer_type: 'Luar', employer_name: '', email: '', status: 'Aktif', notes: 'Migrasi dari Chargeman License, personel luar, designation belum diisi', created_at: now, updated_at: now };
            people.push(np); newPeople.push(np); stats.newPersonnel++; stats.newOutsiders++;
            result = 'Perlu semak'; staffId = np.staff_id;
            notes.push(m.type === 'ambiguous' ? 'beberapa padanan (' + m.candidates.map(function (c) { return c.staff_id; }).join(', ') + '), personel Luar baru dicipta' : 'tiada padanan, personel Luar baru dicipta');
          }
          if (rawDoc && !fid) notes.push('pautan fail tak dikenali "' + rawDoc.substring(0, 60) + '"');
          if (isItem) {
            var er = parseDateAny_(cExp >= 0 ? row.cells[cExp].v : '', srcTz);
            var n = makeCert_(staffId, 'CHARGEMAN', er, rawExp, fid, no, site ? 'Site: ' + site : '', 'Chargeman License tab');
            if (n) { notes.push(n); result = 'Perlu semak'; }
          }
          addReport_('Chargeman License', row.rowNum, name, result, staffId, notes.join('; '));
        });
      }
    }

    // ---------- Tulis ----------
    appendObjects_('Personnel', newPeople);
    appendObjects_('Certs', newCerts);
    writeMigrationReport_(report);
    audit_(actorUserId_(), 'migrate', 'migrateOldData', 'cert dicipta ' + stats.created + ', dilangkau ' + stats.skippedDuplicate + ', personel baru ' + stats.newPersonnel + ', perlu semak ' + stats.needReview);
    return stats;
  });
}

function writeMigrationReport_(rows) {
  var ss = ss_();
  var sh = ss.getSheetByName('Migration_Report');
  if (!sh) sh = ss.insertSheet('Migration_Report');
  sh.clear();
  var hdr = headersOf_('Migration_Report');
  var hr = sh.getRange(1, 1, 1, hdr.length);
  hr.setValues([hdr]); hr.setFontWeight('bold'); hr.setBackground('#e2e8f0'); sh.setFrozenRows(1);
  formatSheet_(sh, 'Migration_Report');
  appendObjects_('Migration_Report', rows);
}

/* ------------------------------------------------------------------ */
/* 3. JANA PIN STAF                                                    */
/* ------------------------------------------------------------------ */
function generateStaffPins() {
  var ui = tryUi_();
  if (!ui) { alert_('Jana PIN staf', 'Jalankan dari menu dalam spreadsheet supaya PIN_LIST boleh dilihat.'); return null; }
  var res = runGeneratePins_();
  alert_('Jana PIN staf', 'PIN dicipta untuk ' + res.created + ' staf. Dilangkau (sudah ada user): ' + res.hasUser + ', bukan Voltake/tidak aktif: ' + res.skippedOther + '.\n\n' +
    'Buka helaian PIN_LIST, salin PIN dan hantar SECARA INDIVIDU (WhatsApp peribadi, bukan kumpulan). Kemudian PADAM helaian PIN_LIST. PIN tak disimpan plain text di tempat lain dan tak boleh dijana semula (guna reset PIN).');
  return res;
}

function runGeneratePins_() {
  return withLock_(function () {
    var people = readTable_('Personnel');
    var users = readTable_('Users');
    var hasUser = {};
    users.forEach(function (u) { if (u.staff_id) hasUser[String(u.staff_id)] = true; });
    var res = { created: 0, hasUser: 0, skippedOther: 0 };
    var out = [];
    people.forEach(function (p) {
      if (p.status !== 'Aktif' || p.employer_type !== 'Voltake') { res.skippedOther++; return; }
      if (hasUser[String(p.staff_id)]) { res.hasUser++; return; }
      var pin = randomPin_();
      createUser_({ login_id: String(p.staff_id).toLowerCase(), full_name: p.full_name, role: 'Staf', staff_id: p.staff_id, pin: pin });
      out.push([p.staff_id, p.full_name, String(p.staff_id).toLowerCase(), pin, 'Wajib tukar PIN pada login pertama']);
      res.created++;
    });
    var ss = ss_();
    var sh = ss.getSheetByName('PIN_LIST');
    if (!sh) sh = ss.insertSheet('PIN_LIST');
    sh.clear();
    var head = [['staff_id', 'full_name', 'login_id', 'PIN', 'catatan']];
    sh.getRange(1, 1, 1, 5).setValues(head).setFontWeight('bold');
    if (out.length) {
      if (sh.getMaxRows() < out.length + 1) sh.insertRowsAfter(sh.getMaxRows(), out.length + 1 - sh.getMaxRows());
      sh.getRange(2, 1, out.length, 5).setNumberFormat('@'); // kekalkan sifar di depan
      sh.getRange(2, 1, out.length, 5).setValues(out);
    }
    audit_(actorUserId_(), 'generate_pins', 'PIN_LIST', 'dicipta ' + res.created);
    return res;
  });
}

/* ------------------------------------------------------------------ */
/* 4. SEMAK KESIHATAN                                                  */
/* ------------------------------------------------------------------ */
function healthCheck() {
  var res = runHealthCheck_();
  var msg = res.errors.length ? 'RALAT (' + res.errors.length + '):\n- ' + res.errors.slice(0, 40).join('\n- ') + (res.errors.length > 40 ? '\n- ...' : '') : 'Bersih. Tiada ralat.';
  if (res.info.length) msg += '\n\nMAKLUMAT:\n- ' + res.info.join('\n- ');
  alert_('Semak kesihatan', msg);
  return res;
}

function runHealthCheck_() {
  var errors = [], info = [];
  var ss = ss_();
  var ok = {};
  // 1. Header
  SETUP_TABS.forEach(function (tab) {
    var sh = ss.getSheetByName(tab);
    if (!sh) { errors.push('Tab ' + tab + ' tiada'); return; }
    var hdr = headersOf_(tab);
    var row = sh.getLastRow() >= 1 ? sh.getRange(1, 1, 1, hdr.length).getValues()[0] : [];
    var bad = hdr.filter(function (h, i) { return String(row[i]) !== h; });
    if (bad.length) errors.push('Header tab ' + tab + ' tak sepadan (lajur: ' + bad.join(', ') + ')');
    else ok[tab] = true;
  });
  var T = {};
  Object.keys(ok).forEach(function (tab) { T[tab] = readTable_(tab); });

  // 2. Tarikh mesti tarikh sebenar (bukan text/nombor)
  Object.keys(T).forEach(function (tab) {
    SCHEMA[tab].forEach(function (c) {
      if (c[1] !== 'd' && c[1] !== 'dt') return;
      T[tab].forEach(function (r) {
        var v = r[c[0]];
        if (v !== '' && v !== null && Object.prototype.toString.call(v) !== '[object Date]') errors.push(tab + ' baris ' + r._row + ': ' + c[0] + ' bukan tarikh sebenar ("' + String(v).substring(0, 30) + '")');
      });
    });
  });

  var people = T.Personnel || [], certs = T.Certs || [], types = T.Cert_Types || [];
  var staffIds = {}, dupIds = {};
  people.forEach(function (p) {
    var id = String(p.staff_id);
    if (staffIds[id]) dupIds[id] = true;
    staffIds[id] = true;
    if (!/^VES\d{3,}$/.test(id)) errors.push('Personnel baris ' + p._row + ': staff_id "' + id + '" bukan format VES###');
    if (ENUMS['Personnel.status'].indexOf(p.status) < 0) errors.push('Personnel baris ' + p._row + ': status "' + p.status + '" tak sah');
    if (ENUMS['Personnel.employer_type'].indexOf(p.employer_type) < 0) errors.push('Personnel baris ' + p._row + ': employer_type "' + p.employer_type + '" tak sah');
  });
  Object.keys(dupIds).forEach(function (id) { errors.push('Personnel: staff_id "' + id + '" berganda'); });
  var noDesig = people.filter(function (p) { return !String(p.designation).trim(); }).length;
  if (noDesig) info.push(noDesig + ' personel belum ada designation (admin isi dalam S-10/sheet)');

  // 3. Certs
  var typeMap = {};
  types.forEach(function (t) { typeMap[t.type_code] = t; });
  var pendingNoExp = 0, migratedNoNo = 0;
  certs.forEach(function (c) {
    if (!staffIds[String(c.staff_id)]) errors.push('Certs baris ' + c._row + ' (' + c.cert_id + '): staff_id "' + c.staff_id + '" tiada dalam Personnel (orphan)');
    var t = typeMap[c.type_code];
    if (!t) errors.push('Certs baris ' + c._row + ' (' + c.cert_id + '): type_code "' + c.type_code + '" tak sah');
    if (ENUMS['Certs.record_status'].indexOf(c.record_status) < 0) errors.push('Certs baris ' + c._row + ': record_status "' + c.record_status + '" tak sah');
    var hasExp = c.expiry_date !== '' && c.expiry_date !== null;
    if (t && isTrue_(t.has_expiry) && !hasExp) {
      if (c.record_status === 'Verified') errors.push('Certs baris ' + c._row + ' (' + c.cert_id + '): Verified tapi tiada expiry_date');
      else if (c.record_status === 'Pending' && c.submitted_by === 'MIGRASI') pendingNoExp++;
    }
    if (c.issue_date && hasExp && Object.prototype.toString.call(c.issue_date) === '[object Date]' && Object.prototype.toString.call(c.expiry_date) === '[object Date]' && c.expiry_date < c.issue_date) errors.push('Certs baris ' + c._row + ': expiry_date sebelum issue_date');
    if (t && isTrue_(t.has_number) && !String(c.cert_no).trim() && c.submitted_by === 'MIGRASI') migratedNoNo++;
    if (c.record_status === 'Rejected' && !String(c.reject_reason).trim()) errors.push('Certs baris ' + c._row + ': Rejected tanpa reject_reason');
  });
  if (pendingNoExp) info.push(pendingNoExp + ' cert migrasi ditahan Pending kerana tiada tarikh tamat (admin isi dan lulus)');
  if (migratedNoNo) info.push(migratedNoNo + ' cert migrasi tiada cert_no (sheet lama tak simpan nombor)');
  var migrated = certs.filter(function (c) { return c.verified_by === 'MIGRASI'; }).length;
  if (migrated) info.push(migrated + ' cert Verified oleh MIGRASI, belum disemak ulang oleh admin');

  // 4. Users, Personnel_Private, Role_Requirements
  var logins = {};
  (T.Users || []).forEach(function (u) {
    var l = String(u.login_id).toLowerCase();
    if (logins[l]) errors.push('Users: login_id "' + l + '" berganda');
    logins[l] = true;
    if (ENUMS['Users.role'].indexOf(u.role) < 0) errors.push('Users baris ' + u._row + ': role "' + u.role + '" tak sah');
    if (u.role === 'Staf' && !u.staff_id) errors.push('Users baris ' + u._row + ': role Staf tanpa staff_id');
    if (u.staff_id && !staffIds[String(u.staff_id)]) errors.push('Users baris ' + u._row + ': staff_id "' + u.staff_id + '" tiada dalam Personnel');
  });
  if (T.Users && !T.Users.some(function (u) { return u.role === 'Admin' && isTrue_(u.active); })) errors.push('Tiada user Admin aktif');
  (T.Personnel_Private || []).forEach(function (p) {
    if (!staffIds[String(p.staff_id)]) errors.push('Personnel_Private baris ' + p._row + ': staff_id tiada dalam Personnel');
    if (p.ic_no && !/^\d{6}-\d{2}-\d{4}$/.test(String(p.ic_no))) errors.push('Personnel_Private baris ' + p._row + ': format ic_no salah');
  });
  (T.Role_Requirements || []).forEach(function (r) {
    String(r.required_types).split(',').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (code) {
      if (!typeMap[code]) errors.push('Role_Requirements "' + r.designation + '": type_code "' + code + '" tak sah');
    });
  });
  if (T.Role_Requirements && !T.Role_Requirements.some(function (r) { return r.designation === '*'; })) errors.push('Role_Requirements tiada baris lalai "*"');

  // 5. Config
  if (T.Config) {
    var keys = T.Config.map(function (r) { return r.key; });
    CONFIG_SEED.forEach(function (p) { if (keys.indexOf(p[0]) < 0) errors.push('Config: key "' + p[0] + '" tiada'); });
  }
  return { ok: errors.length === 0, errors: errors, info: info };
}

/* ================================================================== */
/* FASA 1: API (router, auth, personel, cert, fail)                    */
/* Rujukan: TRD seksyen 5-6, BSD seksyen 4-5                           */
/* ================================================================== */
var SESSION_TTL_ = 21600;           // 6 jam, had CacheService
var MAX_FAILED_ = 5;
var LOCK_MINUTES_ = 15;
var MAX_FILE_BYTES_ = 3 * 1024 * 1024;
var MAX_B64_CHARS_ = 4400000;       // ~3.3 MB binari
var ALLOWED_MIME_ = { 'image/jpeg': 'jpg', 'image/png': 'png', 'application/pdf': 'pdf' };

var PERS_FIELDS_LEAD_ = ['staff_id', 'full_name', 'designation', 'employer_type', 'employer_name', 'status'];
var PERS_FIELDS_ADMIN_ = PERS_FIELDS_LEAD_.concat(['email', 'notes', 'created_at', 'updated_at']);
var CERT_FIELDS_ = ['cert_id', 'staff_id', 'type_code', 'cert_no', 'detail', 'issue_date', 'expiry_date', 'file_name', 'record_status', 'reject_reason', 'submitted_by', 'submitted_at', 'verified_by', 'verified_at', 'remarks'];

function AppError_(code, message) { var e = new Error(message); e.appCode = code; return e; }
function isDate_(v) { return Object.prototype.toString.call(v) === '[object Date]'; }

/* ---------------- Router ---------------- */
function doGet() { return json_({ ok: true, app: 'Compliance Track', version: APP.VERSION }); }

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// action -> { roles: null (awam) | [..], fn, allowMustChange }
var ACTIONS_ = {
  login:          { roles: null, fn: apiLogin_ },
  logout:         { roles: ['Admin', 'Lead', 'Staf'], fn: apiLogout_, allowMustChange: true },
  getMe:          { roles: ['Admin', 'Lead', 'Staf'], fn: apiGetMe_, allowMustChange: true },
  changePin:      { roles: ['Admin', 'Lead', 'Staf'], fn: apiChangePin_, allowMustChange: true },
  listCertTypes:  { roles: ['Admin', 'Lead', 'Staf'], fn: apiListCertTypes_ },
  listPersonnel:  { roles: ['Admin', 'Lead'], fn: apiListPersonnel_ },
  getPersonnel:   { roles: ['Admin'], fn: apiGetPersonnel_ },
  savePersonnel:  { roles: ['Admin'], fn: apiSavePersonnel_ },
  listCerts:      { roles: ['Admin', 'Lead'], fn: apiListCerts_ },
  saveCert:       { roles: ['Admin'], fn: apiSaveCert_ },
  getCertFile:    { roles: ['Admin', 'Lead', 'Staf'], fn: apiGetCertFile_ }
};

function doPost(e) {
  var res;
  try {
    var raw = e && e.postData && e.postData.contents;
    if (!raw || raw.length > 6000000) throw AppError_('PERMINTAAN_SALAH', 'Permintaan tak sah');
    var req;
    try { req = JSON.parse(raw); } catch (x) { throw AppError_('PERMINTAAN_SALAH', 'Permintaan tak sah'); }
    var def = Object.prototype.hasOwnProperty.call(ACTIONS_, req.action) ? ACTIONS_[req.action] : null;
    if (!def) throw AppError_('ACTION_TIADA', 'Action tak dikenali');
    var ctx = { session: null, params: (req.params && typeof req.params === 'object' && !Array.isArray(req.params)) ? req.params : {} };
    if (def.roles) ctx.session = requireRole_(req.token, def.roles, !!def.allowMustChange, req.action);
    res = { ok: true, data: def.fn(ctx) };
  } catch (err) {
    if (err && err.appCode) res = { ok: false, code: err.appCode, error: err.message };
    else { Logger.log('RALAT: ' + (err && err.stack ? err.stack : err)); res = { ok: false, code: 'RALAT_SERVER', error: 'Ralat server. Cuba lagi' }; }
  }
  return json_(res);
}

/* ---------------- Sesi & role ---------------- */
function tokenKey_(token) { return 'tok_' + hashPin_('', token); }

function newToken_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }

// Role dan status aktif dibaca semula daripada Users setiap request (bukan daripada cache)
function requireRole_(token, roles, allowMustChange, actionName) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 200) throw AppError_('SESI_TAMAT', 'Sesi tamat, login semula');
  var cache = CacheService.getScriptCache();
  var key = tokenKey_(token);
  var raw = cache.get(key);
  if (!raw) throw AppError_('SESI_TAMAT', 'Sesi tamat, login semula');
  var uid = JSON.parse(raw).user_id;
  var user = readTable_('Users').filter(function (u) { return u.user_id === uid; })[0];
  if (!user || !isTrue_(user.active)) { cache.remove(key); throw AppError_('SESI_TAMAT', 'Sesi tamat, login semula'); }
  var s = { user_id: user.user_id, login_id: user.login_id, full_name: user.full_name, role: user.role, staff_id: String(user.staff_id || ''), must_change_pin: isTrue_(user.must_change_pin), key: key };
  if (s.must_change_pin && !allowMustChange) throw AppError_('PIN_PERLU_TUKAR', 'Sila tukar PIN dahulu');
  if (roles.indexOf(s.role) < 0) {
    audit_(s.user_id, 'akses_ditolak', actionName || '', 'role ' + s.role);
    throw AppError_('TIDAK_DIBENARKAN', 'Anda tak dibenarkan');
  }
  return s;
}

function userInfo_(s) { return { user_id: s.user_id, full_name: s.full_name, role: s.role, staff_id: s.staff_id, login_id: s.login_id, must_change_pin: s.must_change_pin }; }

function lockedNow_(user) { return isDate_(user.locked_until) && user.locked_until.getTime() > Date.now(); }

// Tambah kiraan gagal; kunci selepas 5. Mesti dalam withLock_.
function registerFail_(user) {
  var n = (Number(user.failed_count) || 0) + 1;
  if (n >= MAX_FAILED_) {
    updateRowCells_('Users', user._row, { failed_count: 0, locked_until: new Date(Date.now() + LOCK_MINUTES_ * 60000) });
    audit_(user.user_id, 'akaun_dikunci', user.user_id, MAX_FAILED_ + ' PIN salah');
    return true;
  }
  updateRowCells_('Users', user._row, { failed_count: n });
  return false;
}

function pinOk_(user, pin) { return hashPin_(String(user.salt), String(pin)) === String(user.pin_hash); }

function apiLogin_(ctx) {
  var p = ctx.params;
  var loginId = String(p.login_id === undefined || p.login_id === null ? '' : p.login_id).trim().toLowerCase();
  var pin = String(p.pin === undefined || p.pin === null ? '' : p.pin);
  var generic = AppError_('LOGIN_GAGAL', 'Email atau PIN salah');
  var locked = AppError_('AKAUN_DIKUNCI', 'Akaun dikunci ' + LOCK_MINUTES_ + ' minit. Cuba lagi kemudian');
  if (!loginId || loginId.length > 200 || !/^\d{6}$/.test(pin)) throw generic;

  return withLock_(function () {
    var user = readTable_('Users').filter(function (u) { return String(u.login_id).toLowerCase() === loginId; })[0];
    if (!user || !isTrue_(user.active)) { audit_('SYSTEM', 'login_gagal', loginId.substring(0, 60), 'pengguna tiada/tak aktif'); throw generic; }
    if (lockedNow_(user)) { audit_(user.user_id, 'login_gagal', user.user_id, 'akaun dikunci'); throw locked; }
    if (!pinOk_(user, pin)) {
      var nowLocked = registerFail_(user);
      audit_(user.user_id, 'login_gagal', user.user_id, 'PIN salah');
      throw nowLocked ? locked : generic;
    }
    updateRowCells_('Users', user._row, { failed_count: 0, locked_until: '', last_login: new Date() });
    var token = newToken_();
    CacheService.getScriptCache().put(tokenKey_(token), JSON.stringify({ user_id: user.user_id }), SESSION_TTL_);
    audit_(user.user_id, 'login', user.user_id, user.role);
    var s = { user_id: user.user_id, login_id: user.login_id, full_name: user.full_name, role: user.role, staff_id: String(user.staff_id || ''), must_change_pin: isTrue_(user.must_change_pin) };
    return { token: token, user: userInfo_(s), expires_in: SESSION_TTL_ };
  });
}

function apiLogout_(ctx) { CacheService.getScriptCache().remove(ctx.session.key); return { done: true }; }
function apiGetMe_(ctx) { return { user: userInfo_(ctx.session) }; }

function apiChangePin_(ctx) {
  var oldPin = String(ctx.params.old_pin === undefined ? '' : ctx.params.old_pin);
  var newPin = String(ctx.params.new_pin === undefined ? '' : ctx.params.new_pin);
  if (!/^\d{6}$/.test(newPin)) throw AppError_('VALIDASI', 'PIN baru mesti 6 digit');
  if (isWeakPin_(newPin)) throw AppError_('VALIDASI', 'PIN baru terlalu mudah diteka');
  if (newPin === oldPin) throw AppError_('VALIDASI', 'PIN baru mesti berbeza daripada PIN lama');
  return withLock_(function () {
    var user = readTable_('Users').filter(function (u) { return u.user_id === ctx.session.user_id; })[0];
    if (!user) throw AppError_('SESI_TAMAT', 'Sesi tamat, login semula');
    if (lockedNow_(user)) throw AppError_('AKAUN_DIKUNCI', 'Akaun dikunci ' + LOCK_MINUTES_ + ' minit. Cuba lagi kemudian');
    if (!pinOk_(user, oldPin)) {
      var nowLocked = registerFail_(user);
      throw AppError_(nowLocked ? 'AKAUN_DIKUNCI' : 'PIN_LAMA_SALAH', nowLocked ? 'Akaun dikunci ' + LOCK_MINUTES_ + ' minit' : 'PIN lama salah');
    }
    var salt = newSalt_();
    updateRowCells_('Users', user._row, { pin_hash: hashPin_(salt, newPin), salt: salt, must_change_pin: false, failed_count: 0 });
    audit_(user.user_id, 'change_pin', user.user_id, '');
    return { done: true };
  });
}

/* ---------------- Util data ---------------- */
function updateRowCells_(tab, rowNum, obj) {
  var sh = getSheet_(tab), hdr = headersOf_(tab);
  Object.keys(obj).forEach(function (k) {
    var idx = hdr.indexOf(k);
    if (idx < 0) throw new Error('Medan ' + k + ' tiada dalam ' + tab);
    sh.getRange(rowNum, idx + 1).setValue(safeCell_(obj[k]));
  });
}

function typeOf_(tab, field) {
  var c = SCHEMA[tab].filter(function (x) { return x[0] === field; })[0];
  return c ? c[1] : 't';
}

// Date -> teks supaya selamat dalam JSON: tarikh yyyy-MM-dd, datetime yyyy-MM-dd HH:mm
function ser_(tab, row, fields) {
  var out = {};
  fields.forEach(function (f) {
    var v = row[f];
    if (isDate_(v)) v = Utilities.formatDate(v, APP.TZ, typeOf_(tab, f) === 'dt' ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
    out[f] = (v === undefined || v === null) ? '' : v;
  });
  return out;
}

function vStr_(v, label, max, required) {
  v = (v === undefined || v === null) ? '' : String(v);
  v = v.replace(/[\u0000-\u001F\u007F​]/g, ' ').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
  if (required && !v) throw AppError_('VALIDASI', label + ' wajib diisi');
  if (v.length > max) throw AppError_('VALIDASI', label + ' terlalu panjang (maksimum ' + max + ' aksara)');
  return v;
}

function vEnum_(v, label, list, dflt) {
  v = vStr_(v, label, 40, false) || dflt;
  if (list.indexOf(v) < 0) throw AppError_('VALIDASI', label + ' tak sah');
  return v;
}

function vDate_(v, label, required) {
  v = vStr_(v, label, 20, false);
  if (!v) { if (required) throw AppError_('VALIDASI', label + ' wajib diisi'); return null; }
  var r = parseDateAny_(v);
  if (r.state !== 'ok') throw AppError_('VALIDASI', label + ' bukan tarikh yang sah');
  return r.date;
}

function normIc_(v) {
  var d = String(v).replace(/[\s-]/g, '');
  if (!/^\d{12}$/.test(d)) throw AppError_('VALIDASI', 'Format IC mesti ######-##-####');
  return d.substring(0, 6) + '-' + d.substring(6, 8) + '-' + d.substring(8);
}

function normPhone_(v) {
  var d = String(v).replace(/[\s\-()+]/g, '');
  if (!/^\d+$/.test(d)) throw AppError_('VALIDASI', 'No. telefon tak sah');
  if (d.charAt(0) === '0') d = '6' + d;
  if (!/^60\d{8,10}$/.test(d)) throw AppError_('VALIDASI', 'No. telefon mesti nombor Malaysia (contoh 0123456789)');
  return d;
}

function certTypeMap_() {
  var m = {};
  readTable_('Cert_Types').forEach(function (t) { m[t.type_code] = t; });
  return m;
}

/* ---------------- Cert_Types ---------------- */
function apiListCertTypes_(ctx) {
  var types = readTable_('Cert_Types').filter(function (t) { return isTrue_(t.active); });
  if (ctx.session.role !== 'Admin') types = types.filter(function (t) { return !isTrue_(t.is_sensitive); }); // jenis IC tak didedah kepada Lead/Staf
  types.sort(function (a, b) { return Number(a.pack_order) - Number(b.pack_order); });
  return { cert_types: types.map(function (t) { return { type_code: t.type_code, type_name: t.type_name, issuer: t.issuer, has_number: isTrue_(t.has_number), has_expiry: isTrue_(t.has_expiry), is_sensitive: isTrue_(t.is_sensitive), pack_order: Number(t.pack_order) }; }) };
}

/* ---------------- Personel ---------------- */
function apiListPersonnel_(ctx) {
  var admin = ctx.session.role === 'Admin';
  var rows = readTable_('Personnel');
  if (!admin) rows = rows.filter(function (p) { return p.status === 'Aktif'; });
  rows.sort(function (a, b) { return String(a.full_name).localeCompare(String(b.full_name)); });
  var out = { personnel: rows.map(function (p) { return ser_('Personnel', p, admin ? PERS_FIELDS_ADMIN_ : PERS_FIELDS_LEAD_); }) };
  if (admin) out.next_staff_id = nextStaffId_(readTable_('Personnel'));
  return out;
}

function apiGetPersonnel_(ctx) {
  var id = vStr_(ctx.params.staff_id, 'staff_id', 20, true).toUpperCase();
  var p = readTable_('Personnel').filter(function (x) { return x.staff_id === id; })[0];
  if (!p) throw AppError_('TIADA', 'Personel tak dijumpai');
  var out = { personnel: ser_('Personnel', p, PERS_FIELDS_ADMIN_) };
  if (ctx.params.include_private === true) {
    var pr = readTable_('Personnel_Private').filter(function (x) { return x.staff_id === id; })[0] || {};
    out.private = { ic_no: pr.ic_no || '', phone: pr.phone || '' };
    if (out.private.ic_no) audit_(ctx.session.user_id, 'view_ic', id, 'Personnel_Private');
  }
  return out;
}

function apiSavePersonnel_(ctx) {
  var p = ctx.params;
  var create = p.mode === 'create';
  return withLock_(function () {
    var all = readTable_('Personnel');
    var id = vStr_(p.staff_id, 'staff_id', 20, false).toUpperCase();
    if (create && !id) id = nextStaffId_(all);
    if (!/^VES\d{3,}$/.test(id)) throw AppError_('VALIDASI', 'ID staf mesti format VES### (contoh VES007)');
    var existing = all.filter(function (x) { return x.staff_id === id; })[0];
    if (create && existing) throw AppError_('VALIDASI', 'ID staf ' + id + ' sudah wujud');
    if (!create && !existing) throw AppError_('TIADA', 'Personel tak dijumpai');

    var employerType = vEnum_(p.employer_type, 'Jenis majikan', ENUMS['Personnel.employer_type'], existing ? existing.employer_type : 'Voltake');
    var employerName = vStr_(p.employer_name, 'Nama majikan', 120, false);
    if (!employerName && employerType === 'Voltake') employerName = COMPANY_NAME;
    var email = vStr_(p.email, 'Email', 120, false).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw AppError_('VALIDASI', 'Format email tak sah');
    var rec = {
      staff_id: id,
      full_name: vStr_(p.full_name, 'Nama penuh', 120, true).toUpperCase(),
      designation: vStr_(p.designation, 'Designation', 100, false).toUpperCase(),
      employer_type: employerType,
      employer_name: employerName,
      email: email,
      status: vEnum_(p.status, 'Status', ENUMS['Personnel.status'], existing ? existing.status : 'Aktif'),
      notes: vStr_(p.notes, 'Catatan', 500, false),
      updated_at: new Date()
    };

    // Data peribadi: hanya diubah bila medan dihantar
    var priv = readTable_('Personnel_Private');
    var prow = priv.filter(function (x) { return x.staff_id === id; })[0];
    var ic, phone;
    if (p.ic_no !== undefined) {
      var rawIc = vStr_(p.ic_no, 'IC', 20, false);
      ic = rawIc ? normIc_(rawIc) : '';
      if (ic && priv.some(function (x) { return x.ic_no === ic && x.staff_id !== id; })) throw AppError_('VALIDASI', 'No. IC ini sudah didaftarkan untuk personel lain');
    }
    if (p.phone !== undefined) {
      var rawPh = vStr_(p.phone, 'Telefon', 25, false);
      phone = rawPh ? normPhone_(rawPh) : '';
    }

    if (create) { rec.created_at = new Date(); appendObjects_('Personnel', [rec]); }
    else updateRowCells_('Personnel', existing._row, rec);

    if (ic !== undefined || phone !== undefined) {
      var privRec = { staff_id: id, ic_no: ic !== undefined ? ic : (prow ? prow.ic_no : ''), phone: phone !== undefined ? phone : (prow ? prow.phone : ''), updated_at: new Date() };
      if (prow) updateRowCells_('Personnel_Private', prow._row, privRec);
      else if (privRec.ic_no || privRec.phone) appendObjects_('Personnel_Private', [privRec]);
    }
    audit_(ctx.session.user_id, 'save_personnel', id, (create ? 'baru' : 'kemas kini') + (ic !== undefined || phone !== undefined ? ' (data peribadi diubah)' : ''));
    return { staff_id: id };
  });
}

/* ---------------- Cert ---------------- */
function apiListCerts_(ctx) {
  var admin = ctx.session.role === 'Admin';
  var ids = null;
  if (ctx.params.staff_ids !== undefined) {
    if (!Array.isArray(ctx.params.staff_ids) || ctx.params.staff_ids.length > 100) throw AppError_('VALIDASI', 'staff_ids tak sah');
    ids = ctx.params.staff_ids.map(function (x) { return String(x).toUpperCase(); });
  } else if (ctx.params.staff_id !== undefined) ids = [String(ctx.params.staff_id).toUpperCase()];
  var types = certTypeMap_();
  var rows = readTable_('Certs');
  if (ids) rows = rows.filter(function (c) { return ids.indexOf(c.staff_id) >= 0; });
  if (!admin) {
    rows = rows.filter(function (c) {
      var t = types[c.type_code];
      return (c.record_status === 'Verified' || c.record_status === 'Pending') && t && !isTrue_(t.is_sensitive);
    });
  }
  return { certs: rows.map(function (c) { var o = ser_('Certs', c, CERT_FIELDS_); o.has_file = !!c.file_id; if (!admin) { o.reject_reason = ''; } return o; }) };
}

function certFolder_(staffId) {
  var rootId = getConfig_('drive_root_folder_id');
  if (!rootId) throw AppError_('RALAT_SERVER', 'Folder Drive belum disetup');
  var certs = findOrCreateFolder_(DriveApp.getFolderById(rootId), 'Certs').folder;
  return findOrCreateFolder_(certs, staffId).folder;
}

function sniffMime_(bytes) {
  var b = function (i) { return bytes[i] & 0xff; };
  if (bytes.length > 3 && b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF) return 'image/jpeg';
  if (bytes.length > 7 && b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47) return 'image/png';
  if (bytes.length > 4 && b(0) === 0x25 && b(1) === 0x50 && b(2) === 0x44 && b(3) === 0x46) return 'application/pdf';
  return '';
}

// Sahkan fail: jenis dibenarkan, saiz, dan kandungan sebenar sepadan jenis
function decodeUpload_(file) {
  if (!file || typeof file !== 'object') throw AppError_('VALIDASI', 'Fail tak sah');
  var mime = String(file.mime || '');
  if (!Object.prototype.hasOwnProperty.call(ALLOWED_MIME_, mime)) throw AppError_('VALIDASI', 'Jenis fail tak dibenarkan. Hanya JPG, PNG atau PDF');
  var b64 = String(file.data || '');
  if (!b64) throw AppError_('VALIDASI', 'Fail kosong');
  if (b64.length > MAX_B64_CHARS_) throw AppError_('VALIDASI', 'Fail terlalu besar. Maksimum 3 MB');
  var bytes;
  try { bytes = Utilities.base64Decode(b64); } catch (e) { throw AppError_('VALIDASI', 'Fail rosak'); }
  if (bytes.length > MAX_FILE_BYTES_) throw AppError_('VALIDASI', 'Fail terlalu besar. Maksimum 3 MB');
  if (sniffMime_(bytes) !== mime) throw AppError_('VALIDASI', 'Kandungan fail tak sepadan dengan jenisnya');
  return { bytes: bytes, mime: mime, ext: ALLOWED_MIME_[mime] };
}

function apiSaveCert_(ctx) {
  var p = ctx.params;
  var up = p.file ? decodeUpload_(p.file) : null;   // semak fail sebelum sentuh apa-apa
  return withLock_(function () {
    var editing = !!p.cert_id;
    var existing = null;
    if (editing) {
      existing = readTable_('Certs').filter(function (c) { return c.cert_id === String(p.cert_id); })[0];
      if (!existing) throw AppError_('TIADA', 'Cert tak dijumpai');
    }
    var staffId = editing ? existing.staff_id : vStr_(p.staff_id, 'staff_id', 20, true).toUpperCase();
    var typeCode = editing ? existing.type_code : vStr_(p.type_code, 'Jenis cert', 30, true).toUpperCase();
    if (!readTable_('Personnel').some(function (x) { return x.staff_id === staffId; })) throw AppError_('VALIDASI', 'Personel tak dijumpai');
    var type = certTypeMap_()[typeCode];
    if (!type || (!editing && !isTrue_(type.active))) throw AppError_('VALIDASI', 'Jenis cert tak sah');

    var certNo = vStr_(p.cert_no, 'Nombor cert', 60, false);
    if (certNo && !/^[A-Za-z0-9 \-\/._()#]+$/.test(certNo)) throw AppError_('VALIDASI', 'Nombor cert mengandungi aksara tak dibenarkan');
    if (isTrue_(type.has_number) && !certNo) throw AppError_('VALIDASI', 'Nombor cert wajib untuk ' + type.type_name);
    var issue = vDate_(p.issue_date, 'Tarikh keluaran', false);
    var expiry = isTrue_(type.has_expiry) ? vDate_(p.expiry_date, 'Tarikh tamat', true) : null;
    if (issue && expiry && expiry.getTime() < issue.getTime()) throw AppError_('VALIDASI', 'Tarikh tamat mesti selepas atau sama dengan tarikh keluaran');
    var rec = {
      cert_no: certNo, detail: vStr_(p.detail, 'Butiran', 200, false),
      issue_date: issue || '', expiry_date: expiry || '', remarks: vStr_(p.remarks, 'Catatan', 300, false)
    };

    var now = new Date();
    var certId = editing ? existing.cert_id : nextId_('counter_cert', 'C-', 6);
    if (up) {
      var expTxt = expiry ? Utilities.formatDate(expiry, APP.TZ, 'yyyyMMdd') : 'NA';
      var fname = typeCode + '_' + expTxt + '_' + certId + '.' + up.ext;
      var f = certFolder_(staffId).createFile(Utilities.newBlob(up.bytes, up.mime, fname));
      rec.file_id = f.getId(); rec.file_name = fname;   // fail lama kekal dalam Drive
    }
    if (editing) {
      updateRowCells_('Certs', existing._row, rec);
    } else {
      rec.cert_id = certId; rec.staff_id = staffId; rec.type_code = typeCode;
      rec.record_status = 'Verified'; rec.reject_reason = '';
      rec.submitted_by = ctx.session.user_id; rec.submitted_at = now;
      rec.verified_by = ctx.session.user_id; rec.verified_at = now;
      appendObjects_('Certs', [rec]);
    }
    audit_(ctx.session.user_id, 'save_cert', certId, (editing ? 'kemas kini ' : 'baru ') + typeCode + ' ' + staffId);
    var saved = readTable_('Certs').filter(function (c) { return c.cert_id === certId; })[0];
    var out = ser_('Certs', saved, CERT_FIELDS_); out.has_file = !!saved.file_id;
    return { cert: out };
  });
}

function apiGetCertFile_(ctx) {
  var s = ctx.session;
  var id = vStr_(ctx.params.cert_id, 'cert_id', 20, true);
  var cert = readTable_('Certs').filter(function (c) { return c.cert_id === id; })[0];
  var deny = AppError_('TIDAK_DIBENARKAN', 'Anda tak dibenarkan');
  if (!cert) throw deny;                                   // jawapan sama untuk "tiada" dan "ditolak"
  var type = certTypeMap_()[cert.type_code];
  var sensitive = !!(type && isTrue_(type.is_sensitive));
  if (s.role === 'Staf') {
    if (!s.staff_id || cert.staff_id !== s.staff_id) throw deny;   // staff_id daripada sesi
  } else if (s.role === 'Lead') {
    if (sensitive || (cert.record_status !== 'Verified' && cert.record_status !== 'Pending')) throw deny;
  }
  if (!cert.file_id) throw AppError_('FAIL_TIADA', 'Fail tak dijumpai');
  var blob;
  try { blob = DriveApp.getFileById(String(cert.file_id)).getBlob(); } catch (e) { throw AppError_('FAIL_TIADA', 'Fail tak dapat dibuka'); }
  if (sensitive) audit_(s.user_id, 'view_ic', cert.cert_id, 'fail ' + cert.type_code);
  var mime = blob.getContentType();
  return { name: String(cert.file_name || blob.getName() || 'fail'), mime: ALLOWED_MIME_[mime] ? mime : 'application/octet-stream', data: Utilities.base64Encode(blob.getBytes()) };
}

/* ---------------- Menu: tambah user Lead/Admin (sementara sehingga S-10 Fasa 4) ---------------- */
function addUserFromMenu() {
  var ui = tryUi_();
  if (!ui) { alert_('Tambah user', 'Jalankan dari menu dalam spreadsheet.'); return null; }
  var email = promptText_('Tambah user (1/3)', 'Email user:').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { alert_('Tambah user', 'Email tak sah. Dibatalkan.'); return null; }
  var name = promptText_('Tambah user (2/3)', 'Nama penuh:');
  if (!name) { alert_('Tambah user', 'Nama kosong. Dibatalkan.'); return null; }
  var roleIn = promptText_('Tambah user (3/3)', 'Role: taip Lead atau Admin').toLowerCase();
  var role = roleIn === 'admin' ? 'Admin' : (roleIn === 'lead' ? 'Lead' : '');
  if (!role) { alert_('Tambah user', 'Role mesti Lead atau Admin. Dibatalkan.'); return null; }
  if (readTable_('Users').some(function (u) { return String(u.login_id).toLowerCase() === email; })) { alert_('Tambah user', 'Email ini sudah ada. Dibatalkan.'); return null; }
  var pin = randomPin_();
  ui.alert('PIN user (HANYA SEKALI)', 'Login: ' + email + '\nRole: ' + role + '\nPIN sementara: ' + pin + '\n\nHantar kepada user secara peribadi. User wajib tukar PIN pada login pertama.', ui.ButtonSet.OK);
  var u = withLock_(function () {
    var created = createUser_({ login_id: email, full_name: name.toUpperCase(), role: role, staff_id: '', pin: pin });
    audit_(actorUserId_(), 'save_user', created.user_id, role);
    return created;
  });
  return { user_id: u.user_id };
}
