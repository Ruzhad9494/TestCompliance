# apps-script/

`Code.gs` = backend Compliance Track (Google Apps Script, container-bound pada spreadsheet `Compliance_DB`).
Status semasa: **Fasa 0** (setup, import data lama, jana PIN staf, semak kesihatan).

## Cara run (Fasa 0)
1. Cipta spreadsheet kosong `Compliance_DB_TEST` (jangan Publish to web).
2. Extensions > Apps Script. Padam kod lama, tampal `Code.gs`. Dalam Project Settings, tick "Show appsscript.json" dan tampal `appsscript.json` (timeZone Asia/Kuala_Lumpur).
3. Muat semula spreadsheet. Menu **Compliance Track** akan muncul.
4. **1. Setup sistem** (benarkan akses kali pertama). Catat PIN admin yang keluar sekali. Run kali kedua untuk sahkan tiada data hilang.
5. **2. Import data lama**: tampal ID/URL sheet lama (guna salinan dahulu). Semak tab `Migration_Report`.
6. **4. Semak kesihatan** mesti "Bersih".

Run dari menu, bukan butang Run dalam editor, supaya dialog PIN boleh dipaparkan.

## Ujian lokal (mock, tanpa Google)
```
cd apps-script && npm test
```
Mock hanya menguji logik. Ia bukan pengganti ujian sebenar dalam Google Sheets.
