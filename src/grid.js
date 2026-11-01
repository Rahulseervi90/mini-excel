/*
 * Mini Excel - the screen ("front of house").
 *
 * This file draws the grid, listens to the mouse and keyboard, and asks the
 * engine (src/engine.js) for every answer. It never does maths itself.
 */
(function () {
  'use strict';

  const { Sheet, FormulaError, MAX_COLS, MAX_ROWS, colName, refName, parseRef } = window.Engine;
  const { parseCSV, toCSV } = window.Csv;

  // ---------- the app's memory ----------
  const sheet = new Sheet(); // what is typed in each cell
  const styles = new Map(); // "c,r" -> { b: bold, i: italic, bg: fill color }
  const tds = []; // tds[row][col] -> the <td> on screen
  const colHeads = [];
  const rowHeads = [];
  let sel = { c: 0, r: 0 }; // the selected cell
  let editing = null; // { input, c, r } while typing inside a cell

  // ---------- handy shortcuts ----------
  const $ = (id) => document.getElementById(id);
  const table = $('grid');
  const gridWrap = $('grid-wrap');
  const nameBox = $('name-box');
  const formulaBar = $('formula-bar');
  const statusBar = $('status');
  const fileInput = $('file-input');
  const btnBold = $('btn-bold');
  const btnItalic = $('btn-italic');
  const fillColor = $('fill-color');

  const key = (c, r) => c + ',' + r;
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const setStatus = (msg) => {
    statusBar.textContent = msg;
  };

  // ---------- draw the empty grid once ----------
  function build() {
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'corner';
    headRow.appendChild(corner);
    for (let c = 0; c < MAX_COLS; c++) {
      const th = document.createElement('th');
      th.className = 'colhead';
      th.textContent = colName(c);
      headRow.appendChild(th);
      colHeads.push(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let r = 0; r < MAX_ROWS; r++) {
      const tr = document.createElement('tr');
      const rh = document.createElement('th');
      rh.className = 'rowhead';
      rh.textContent = r + 1;
      tr.appendChild(rh);
      rowHeads.push(rh);
      tds[r] = [];
      for (let c = 0; c < MAX_COLS; c++) {
        const td = document.createElement('td');
        td.dataset.c = c;
        td.dataset.r = r;
        tr.appendChild(td);
        tds[r][c] = td;
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  // ---------- update what is shown ----------
  function refreshCell(c, r) {
    if (editing && editing.c === c && editing.r === r) return; // don't disturb typing
    const td = tds[r][c];
    const v = sheet.getValue(c, r);
    const text = sheet.display(c, r);
    if (td.firstElementChild || td.textContent !== text) td.textContent = text;
    td.classList.remove('editing');
    td.classList.toggle('num', typeof v === 'number');
    td.classList.toggle('err', v instanceof FormulaError);
    const st = styles.get(key(c, r)) || {};
    td.classList.toggle('b', !!st.b);
    td.classList.toggle('i', !!st.i);
    td.style.backgroundColor = st.bg || '';
  }

  // Any change can affect other cells (=A1+B1), so we redraw them all.
  function refreshAll() {
    for (let r = 0; r < MAX_ROWS; r++) for (let c = 0; c < MAX_COLS; c++) refreshCell(c, r);
  }

  function updateBars() {
    nameBox.value = refName(sel.c, sel.r);
    formulaBar.value = sheet.getRaw(sel.c, sel.r);
    const st = styles.get(key(sel.c, sel.r)) || {};
    btnBold.classList.toggle('on', !!st.b);
    btnItalic.classList.toggle('on', !!st.i);
    if (st.bg) fillColor.value = st.bg;
  }

  function select(c, r) {
    c = clamp(c, 0, MAX_COLS - 1);
    r = clamp(r, 0, MAX_ROWS - 1);
    tds[sel.r][sel.c].classList.remove('selected');
    colHeads[sel.c].classList.remove('active');
    rowHeads[sel.r].classList.remove('active');
    sel = { c, r };
    const td = tds[r][c];
    td.classList.add('selected');
    colHeads[c].classList.add('active');
    rowHeads[r].classList.add('active');
    if (td.scrollIntoView) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    updateBars();
  }

  function move(dc, dr) {
    select(sel.c + dc, sel.r + dr);
  }

  function setCell(c, r, text) {
    sheet.setRaw(c, r, text);
    refreshAll();
  }

  // ---------- typing inside a cell ----------
  function startEdit(initialText) {
    if (editing) return;
    const { c, r } = sel;
    const td = tds[r][c];
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cell-editor';
    input.spellcheck = false;
    input.value = initialText !== undefined ? initialText : sheet.getRaw(c, r);
    td.textContent = '';
    td.classList.add('editing');
    td.appendChild(input);
    editing = { input, c, r };
    formulaBar.value = input.value;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit(0, e.shiftKey ? -1 : 1);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        commitEdit(e.shiftKey ? -1 : 1, 0);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    });
    input.addEventListener('input', () => {
      formulaBar.value = input.value;
    });
    input.addEventListener('blur', () => {
      if (editing && editing.input === input) commitEdit(0, 0);
    });
  }

  // Keep what was typed, then move the selection by (dc, dr).
  function commitEdit(dc, dr) {
    if (!editing) return;
    const { input, c, r } = editing;
    editing = null; // set first, so the blur event below does nothing
    sheet.setRaw(c, r, input.value);
    refreshAll();
    select(c + dc, r + dr);
    gridWrap.focus({ preventScroll: true });
  }

  function cancelEdit() {
    if (!editing) return;
    const { c, r } = editing;
    editing = null;
    refreshCell(c, r);
    updateBars();
    gridWrap.focus({ preventScroll: true });
  }

  // ---------- formatting ----------
  function changeStyle(change) {
    const k = key(sel.c, sel.r);
    const st = Object.assign({}, styles.get(k));
    change(st);
    if (!st.b && !st.i && !st.bg) styles.delete(k);
    else styles.set(k, st);
    refreshCell(sel.c, sel.r);
    updateBars();
  }
  const toggleBold = () =>
    changeStyle((st) => {
      st.b = !st.b;
    });
  const toggleItalic = () =>
    changeStyle((st) => {
      st.i = !st.i;
    });

  // ---------- files ----------
  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Save everything (formulas + formatting) so it can be opened again later.
  function saveFile() {
    const cells = {};
    const keys = new Set([...sheet.raw.keys(), ...styles.keys()]);
    for (const k of keys) {
      const [c, r] = k.split(',').map(Number);
      const entry = {};
      const raw = sheet.getRaw(c, r);
      if (raw) entry.v = raw;
      const st = styles.get(k);
      if (st && st.b) entry.b = 1;
      if (st && st.i) entry.i = 1;
      if (st && st.bg) entry.bg = st.bg;
      cells[refName(c, r)] = entry;
    }
    const data = { app: 'mini-excel', version: 1, cells };
    download('my-sheet.json', JSON.stringify(data, null, 2), 'application/json');
    setStatus('Saved ' + keys.size + ' cells to my-sheet.json (check your Downloads folder)');
  }

  // CSV only holds the shown values (no formulas, no formatting).
  function exportCSV() {
    let maxC = -1;
    let maxR = -1;
    for (const k of sheet.raw.keys()) {
      const [c, r] = k.split(',').map(Number);
      maxC = Math.max(maxC, c);
      maxR = Math.max(maxR, r);
    }
    if (maxC < 0) {
      setStatus('Nothing to export yet');
      return;
    }
    const rows = [];
    for (let r = 0; r <= maxR; r++) {
      const row = [];
      for (let c = 0; c <= maxC; c++) row.push(sheet.display(c, r));
      rows.push(row);
    }
    download('my-sheet.csv', '﻿' + toCSV(rows), 'text/csv;charset=utf-8');
    setStatus('Exported my-sheet.csv (check your Downloads folder)');
  }

  function resetSheet() {
    sheet.clear();
    styles.clear();
  }

  function finishLoading(message) {
    refreshAll();
    select(0, 0);
    gridWrap.focus({ preventScroll: true });
    setStatus(message);
  }

  function loadCSV(text, name) {
    const rows = parseCSV(text);
    resetSheet();
    let skipped = false;
    let count = 0;
    rows.forEach((row, r) => {
      row.forEach((value, c) => {
        if (value === '') return;
        if (r >= MAX_ROWS || c >= MAX_COLS) {
          skipped = true;
          return;
        }
        sheet.setRaw(c, r, value);
        count++;
      });
    });
    finishLoading(
      'Opened ' + name + ' (' + count + ' cells)' + (skipped ? ' - some data was outside the grid and was skipped' : '')
    );
  }

  function loadJSON(text, name) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }
    if (!data || typeof data.cells !== 'object' || data.cells === null) {
      setStatus('That file is not a Mini Excel .json file');
      return;
    }
    resetSheet();
    let count = 0;
    for (const [ref, entry] of Object.entries(data.cells)) {
      const p = parseRef(ref);
      if (!p || p.c < 0 || p.r < 0 || p.c >= MAX_COLS || p.r >= MAX_ROWS || !entry) continue;
      if (entry.v) sheet.setRaw(p.c, p.r, String(entry.v));
      const st = {};
      if (entry.b) st.b = true;
      if (entry.i) st.i = true;
      if (typeof entry.bg === 'string' && /^#[0-9a-fA-F]{6}$/.test(entry.bg)) st.bg = entry.bg;
      if (st.b || st.i || st.bg) styles.set(key(p.c, p.r), st);
      count++;
    }
    finishLoading('Opened ' + name + ' (' + count + ' cells)');
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    file
      .text()
      .then((text) => {
        if (/\.csv$/i.test(file.name)) loadCSV(text, file.name);
        else loadJSON(text, file.name);
      })
      .catch((e) => setStatus('Could not read that file: ' + e.message));
    fileInput.value = ''; // so the same file can be opened again
  });

  // ---------- mouse ----------
  table.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'INPUT') return; // clicking inside the cell editor
    const td = e.target.closest('td');
    if (!td) return;
    e.preventDefault();
    if (editing) commitEdit(0, 0);
    select(Number(td.dataset.c), Number(td.dataset.r));
    gridWrap.focus({ preventScroll: true });
  });

  table.addEventListener('dblclick', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const td = e.target.closest('td');
    if (!td) return;
    select(Number(td.dataset.c), Number(td.dataset.r));
    startEdit();
  });

  // ---------- keyboard (when you are not typing inside a box) ----------
  document.addEventListener('keydown', (e) => {
    const tag = e.target && e.target.tagName;
    if (editing || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'b') {
        e.preventDefault();
        toggleBold();
      } else if (k === 'i') {
        e.preventDefault();
        toggleItalic();
      } else if (k === 's') {
        e.preventDefault();
        saveFile();
      } else if (k === 'o') {
        e.preventDefault();
        fileInput.click();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        move(0, -1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        move(0, 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        move(-1, 0);
        break;
      case 'ArrowRight':
        e.preventDefault();
        move(1, 0);
        break;
      case 'Tab':
        e.preventDefault();
        move(e.shiftKey ? -1 : 1, 0);
        break;
      case 'Enter':
        e.preventDefault();
        move(0, e.shiftKey ? -1 : 1);
        break;
      case 'PageDown':
        e.preventDefault();
        move(0, 20);
        break;
      case 'PageUp':
        e.preventDefault();
        move(0, -20);
        break;
      case 'Home':
        e.preventDefault();
        select(0, sel.r);
        break;
      case 'F2':
        e.preventDefault();
        startEdit();
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        setCell(sel.c, sel.r, '');
        updateBars();
        break;
      default:
        // Typing a letter or number starts editing the selected cell.
        if (e.key.length === 1 && !e.altKey) {
          e.preventDefault();
          startEdit(e.key);
        }
    }
  });

  // ---------- formula bar and name box ----------
  formulaBar.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      setCell(sel.c, sel.r, formulaBar.value);
      move(0, 1);
      gridWrap.focus({ preventScroll: true });
    } else if (e.key === 'Escape') {
      e.preventDefault();
      updateBars();
      gridWrap.focus({ preventScroll: true });
    }
  });

  nameBox.addEventListener('focus', () => nameBox.select());
  nameBox.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const p = parseRef(nameBox.value.trim());
      if (p && p.c >= 0 && p.r >= 0 && p.c < MAX_COLS && p.r < MAX_ROWS) {
        select(p.c, p.r);
        gridWrap.focus({ preventScroll: true });
      } else {
        setStatus('"' + nameBox.value + '" is outside the grid (A1 to ' + refName(MAX_COLS - 1, MAX_ROWS - 1) + ')');
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      updateBars();
      gridWrap.focus({ preventScroll: true });
    }
  });

  // ---------- toolbar ----------
  // Keep the keyboard focus where it is when a toolbar button is clicked.
  $('toolbar').addEventListener('mousedown', (e) => {
    if (e.target.tagName !== 'INPUT') e.preventDefault();
  });

  btnBold.addEventListener('click', toggleBold);
  btnItalic.addEventListener('click', toggleItalic);
  fillColor.addEventListener('input', () =>
    changeStyle((st) => {
      st.bg = fillColor.value;
    })
  );
  fillColor.addEventListener('change', () => gridWrap.focus({ preventScroll: true }));
  $('btn-nofill').addEventListener('click', () =>
    changeStyle((st) => {
      delete st.bg;
    })
  );
  $('btn-save').addEventListener('click', saveFile);
  $('btn-csv').addEventListener('click', exportCSV);
  $('btn-open').addEventListener('click', () => fileInput.click());
  $('btn-new').addEventListener('click', () => {
    if (!window.confirm('Start a new empty sheet? Anything not saved will be lost.')) return;
    resetSheet();
    finishLoading('New sheet');
  });

  // ---------- start ----------
  build();
  refreshAll();
  select(0, 0);
  gridWrap.focus({ preventScroll: true });
  setStatus('Ready - click a cell and type. Start with = for a formula, for example =SUM(A1:A3)');
})();
