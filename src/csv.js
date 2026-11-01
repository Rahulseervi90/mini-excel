/*
 * Mini Excel - CSV reading and writing.
 * CSV is the simplest spreadsheet file: one line per row, cells split by commas.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Csv = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // "a,b\n1,2" -> [["a","b"],["1","2"]]   (handles "quoted, text" and "" inside quotes)
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // byte-order mark from Excel
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"' && field === '') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
    if (field !== '' || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  // [["a","b"],["1","x,y"]] -> 'a,b\r\n1,"x,y"'
  function toCSV(rows) {
    const quote = (s) => (/[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
    return rows.map((row) => row.map((v) => quote(String(v))).join(',')).join('\r\n');
  }

  return { parseCSV, toCSV };
});
