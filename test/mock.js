'use strict';
// Mock minimum untuk API Apps Script yang digunakan Code.gs. Untuk ujian logik sahaja,
// BUKAN pengganti ujian sebenar dalam Google Sheets.
const crypto = require('crypto');

function isEmpty(v) { return v === '' || v === null || v === undefined; }

class Range {
  constructor(sheet, r, c, nr, nc) { this.sh = sheet; this.r = r; this.c = c; this.nr = nr; this.nc = nc; }
  _each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r + i, this.c + j, i, j); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const v = this.sh.cells[(this.r + i) + ',' + (this.c + j)]; row.push(v === undefined ? '' : v); } out.push(row); } return out; }
  getFormulas() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.formulas[(this.r + i) + ',' + (this.c + j)] || ''); out.push(row); } return out; }
  getRichTextValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) { const l = this.sh.links[(this.r + i) + ',' + (this.c + j)]; row.push({ getLinkUrl: () => l || null }); } out.push(row); } return out; }
  setValues(vals) {
    if (vals.length !== this.nr || vals[0].length !== this.nc) throw new Error('setValues: dimensi tak sepadan');
    if (this.r + this.nr - 1 > this.sh.maxRows) throw new Error('Range di luar had baris sheet ' + this.sh.name);
    if (this.c + this.nc - 1 > this.sh.maxCols) throw new Error('Range di luar had lajur sheet ' + this.sh.name);
    this._each((r, c, i, j) => { this.sh.cells[r + ',' + c] = vals[i][j]; });
    return this;
  }
  setValue(v) { return this.setValues(Array.from({ length: this.nr }, () => Array(this.nc).fill(v))); }
  setNumberFormat(f) { this._each((r, c) => { this.sh.formats[r + ',' + c] = f; }); return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setDataValidation(rule) { this._each((r, c) => { this.sh.validations[r + ',' + c] = rule; }); return this; }
  clear() { this._each((r, c) => { delete this.sh.cells[r + ',' + c]; }); return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.cells = {}; this.formulas = {}; this.links = {}; this.formats = {}; this.validations = {}; this.maxRows = 1000; this.maxCols = 26; this.frozen = 0; this.rules = []; }
  getName() { return this.name; }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc); }
  getLastRow() { let m = 0; for (const k in this.cells) { if (!isEmpty(this.cells[k])) m = Math.max(m, +k.split(',')[0]); } return m; }
  getLastColumn() { let m = 0; for (const k in this.cells) { if (!isEmpty(this.cells[k])) m = Math.max(m, +k.split(',')[1]); } return m; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(after, n) { this.maxRows += n; }
  setFrozenRows(n) { this.frozen = n; }
  setConditionalFormatRules(r) { this.rules = r; }
  getConditionalFormatRules() { return this.rules; }
  clear() { this.cells = {}; this.formulas = {}; this.links = {}; this.formats = {}; this.validations = {}; }
  // helper ujian: isi baris terus (untuk sheet lama)
  fill(rows) { rows.forEach((row, i) => row.forEach((v, j) => { if (!isEmpty(v)) this.cells[(i + 1) + ',' + (j + 1)] = v; })); return this; }
}

class Spreadsheet {
  constructor(name, tz = 'Asia/Kuala_Lumpur') { this.name = name; this.sheets = [new Sheet('Sheet1')]; this.tz = tz; }
  getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { if (this.getSheetByName(n)) throw new Error('Sheet sudah wujud: ' + n); const s = new Sheet(n); this.sheets.push(s); return s; }
  deleteSheet(s) { if (this.sheets.length === 1) throw new Error('Tak boleh padam sheet terakhir'); this.sheets = this.sheets.filter(x => x !== s); }
  setSpreadsheetTimeZone(tz) { this.tz = tz; }
  getSpreadsheetTimeZone() { return this.tz; }
  getId() { return 'mock-ss-' + this.name; }
}

function chain(target, store) {
  const b = new Proxy({}, { get(_, prop) {
    if (prop === 'build') return () => Object.assign({}, store);
    return (...args) => { store[prop] = args; return b; };
  } });
  return b;
}

class Folder {
  constructor(name) { this.name = name; this.id = 'fld-' + crypto.randomBytes(6).toString('hex'); this.kids = []; }
  getId() { return this.id; }
  getName() { return this.name; }
  createFolder(n) { const f = new Folder(n); this.kids.push(f); return f; }
  getFoldersByName(n) { const m = this.kids.filter(k => k.name === n); let i = 0; return { hasNext: () => i < m.length, next: () => m[i++] }; }
}

function createEnv(opts = {}) {
  const env = {
    ss: new Spreadsheet('Compliance_DB'),
    alerts: [], prompts: [], promptQueue: [], triggers: [], logs: [],
    uiAvailable: opts.ui !== false, email: opts.email === undefined ? 'admin@voltake.test' : opts.email,
    root: new Folder('root'), books: {}
  };
  const ui = {
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' }, Button: { OK: 'OK', CANCEL: 'CANCEL' },
    alert: (t, m) => { env.alerts.push({ t, m }); return 'OK'; },
    prompt: (t, m) => { env.prompts.push({ t, m }); const a = env.promptQueue.shift(); return { getSelectedButton: () => (a === undefined ? 'CANCEL' : 'OK'), getResponseText: () => a || '' }; },
    createMenu: () => chain(null, {})
  };
  const g = globalThis;
  g.SpreadsheetApp = {
    getActiveSpreadsheet: () => env.ss,
    openById: id => { if (!env.books[id]) throw new Error('Tak jumpa spreadsheet ' + id); return env.books[id]; },
    getUi: () => { if (!env.uiAvailable) throw new Error('Cannot call SpreadsheetApp.getUi() from this context'); return ui; },
    newDataValidation: () => chain(null, {}),
    newConditionalFormatRule: () => chain(null, {})
  };
  g.DriveApp = { getRootFolder: () => env.root, getFolderById: id => { const find = f => f.id === id ? f : f.kids.map(find).find(Boolean); const r = find(env.root); if (!r) throw new Error('folder tiada'); return r; } };
  g.Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (a, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
    getUuid: () => crypto.randomUUID(),
    formatDate: (d, tz, pat) => {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d).map(p => [p.type, p.value]));
      return pat.replace('yyyy', parts.year).replace('MM', parts.month).replace('dd', parts.day).replace('HH', parts.hour).replace('mm', parts.minute);
    }
  };
  g.LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
  g.Session = { getActiveUser: () => ({ getEmail: () => env.email }), getEffectiveUser: () => ({ getEmail: () => env.email }) };
  g.Logger = { log: m => env.logs.push(m) };
  g.ScriptApp = {
    WeekDay: { SUNDAY: 'SUNDAY' },
    getProjectTriggers: () => env.triggers.map(t => ({ getHandlerFunction: () => t.fn })),
    newTrigger: fn => { const t = { fn }; const b = { timeBased: () => b, everyDays: () => b, atHour: () => b, inTimezone: () => b, onWeekDay: () => b, create: () => { env.triggers.push(t); return t; } }; return b; }
  };
  return env;
}

module.exports = { createEnv, Spreadsheet, Sheet };
