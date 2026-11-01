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
  let sel = { c: 0, r: 0 }; // the active cell (where typing goes)
  let ext = { c: 0, r: 0 }; // the opposite corner of the selected block (same as sel when one cell)
  let dragging = false; // true while the mouse button is held down on the grid
  let painted = null; // the block currently highlighted on screen
  let editing = null; // { input, c, r } while typing inside a cell

  // ---------- handy shortcuts ----------
  const $ = (id) => document.getElementById(id);
  const table = $('grid');
  const gridWrap = $('grid-wrap');
  const nameBox = $('name-box');
  const formulaBar = $('formula-bar');
  const statusBar = $('status');
  const summaryBar = $('summary');
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
    updateSummary();
  }

  // ---------- the selected block ----------
  // sel (active cell) and ext (other corner) are two corners of a rectangle.
  // When they are the same cell, one cell is selected.
  function range() {
    return {
      c1: Math.min(sel.c, ext.c),
      r1: Math.min(sel.r, ext.r),
      c2: Math.max(sel.c, ext.c),
      r2: Math.max(sel.r, ext.r),
    };
  }
  const isMulti = (g) => g.c1 !== g.c2 || g.r1 !== g.r2;

  // Run something for every cell in the selected block.
  function eachInRange(fn) {
    const g = range();
    for (let r = g.r1; r <= g.r2; r++) for (let c = g.c1; c <= g.c2; c++) fn(c, r);
  }

  // Colour the selected block green and outline its edge.
  function paint() {
    if (painted) {
      const p = painted.g;
      for (let c = p.c1; c <= p.c2; c++) colHeads[c].classList.remove('active');
      for (let r = p.r1; r <= p.r2; r++) {
        rowHeads[r].classList.remove('active');
        for (let c = p.c1; c <= p.c2; c++) tds[r][c].classList.remove('inrange', 'rt', 'rb', 'rl', 'rr');
      }
      tds[painted.a.r][painted.a.c].classList.remove('selected');
    }
    const g = range();
    for (let c = g.c1; c <= g.c2; c++) colHeads[c].classList.add('active');
    for (let r = g.r1; r <= g.r2; r++) {
      rowHeads[r].classList.add('active');
      if (!isMulti(g)) continue;
      for (let c = g.c1; c <= g.c2; c++) {
        const td = tds[r][c];
        td.classList.add('inrange');
        if (r === g.r1) td.classList.add('rt');
        if (r === g.r2) td.classList.add('rb');
        if (c === g.c1) td.classList.add('rl');
        if (c === g.c2) td.classList.add('rr');
      }
    }
    tds[sel.r][sel.c].classList.add('selected');
    painted = { g, a: { c: sel.c, r: sel.r } };
  }

  function updateBars() {
    const g = range();
    nameBox.value = isMulti(g) ? refName(g.c1, g.r1) + ':' + refName(g.c2, g.r2) : refName(sel.c, sel.r);
    formulaBar.value = sheet.getRaw(sel.c, sel.r);
    const st = styles.get(key(sel.c, sel.r)) || {};
    btnBold.classList.toggle('on', !!st.b);
    btnItalic.classList.toggle('on', !!st.i);
    if (st.bg) fillColor.value = st.bg;
  }

  const fmt = (n) => String(parseFloat(n.toPrecision(12)));

  // Bottom-right of the screen: Average / Count / Sum of the selected block.
  function updateSummary() {
    const g = range();
    if (!isMulti(g)) {
      summaryBar.textContent = '';
      return;
    }
    let count = 0; // cells that are not empty
    let nums = 0; // cells that hold a number
    let total = 0;
    eachInRange((c, r) => {
      const v = sheet.getValue(c, r);
      if (v === null) return;
      count++;
      if (typeof v === 'number') {
        nums++;
        total += v;
      }
    });
    if (count === 0) summaryBar.textContent = '';
    else if (nums === 0) summaryBar.textContent = 'Count: ' + count;
    else summaryBar.textContent = 'Average: ' + fmt(Math.round((total / nums) * 10000) / 10000) + '     Count: ' + count + '     Sum: ' + fmt(total);
  }

  function selectionChanged() {
    paint();
    updateBars();
    updateSummary();
  }

  // Click a cell: select just that one.
  function select(c, r, scroll = true) {
    c = clamp(c, 0, MAX_COLS - 1);
    r = clamp(r, 0, MAX_ROWS - 1);
    sel = { c, r };
    ext = { c, r };
    selectionChanged();
    if (scroll) scrollTo(c, r);
  }

  // Shift+click, drag or Shift+arrows: stretch the block to this cell.
  function extendTo(c, r, scroll = true) {
    c = clamp(c, 0, MAX_COLS - 1);
    r = clamp(r, 0, MAX_ROWS - 1);
    if (ext.c === c && ext.r === r) return;
    ext = { c, r };
    selectionChanged();
    if (scroll) scrollTo(c, r);
  }

  function scrollTo(c, r) {
    const td = tds[r][c];
    if (td.scrollIntoView) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function selectAll() {
    select(0, 0, false);
    extendTo(MAX_COLS - 1, MAX_ROWS - 1, false);
  }

  function move(dc, dr) {
    select(sel.c + dc, sel.r + dr);
  }

  // Empty every cell in the selected block.
  function clearRange() {
    eachInRange((c, r) => sheet.setRaw(c, r, ''));
    refreshAll();
    updateBars();
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
  // Apply a style change to every selected cell.
  function changeStyle(change) {
    eachInRange((c, r) => {
      const k = key(c, r);
      const st = Object.assign({}, styles.get(k));
      change(st);
      if (!st.b && !st.i && !st.bg) styles.delete(k);
      else styles.set(k, st);
      refreshCell(c, r);
    });
    updateBars();
  }
  // Decide from the active cell, then give the whole block the same result.
  const toggleBold = () => {
    const on = !(styles.get(key(sel.c, sel.r)) || {}).b;
    changeStyle((st) => {
      st.b = on;
    });
  };
  const toggleItalic = () => {
    const on = !(styles.get(key(sel.c, sel.r)) || {}).i;
    changeStyle((st) => {
      st.i = on;
    });
  };

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
    download('my-sheet.csv', '\uFEFF' + toCSV(rows), 'text/csv;charset=utf-8');
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
    const th = e.target.closest('th');
    if (!td && !th) return;
    e.preventDefault();
    if (editing) commitEdit(0, 0);
    gridWrap.focus({ preventScroll: true });
    if (td) {
      const c = Number(td.dataset.c);
      const r = Number(td.dataset.r);
      if (e.shiftKey) extendTo(c, r); // Shift+click stretches the block
      else select(c, r);
      dragging = true; // moving the mouse now stretches the block
    } else if (th.classList.contains('colhead')) {
      const c = colHeads.indexOf(th); // click a column letter: whole column
      select(c, 0, false);
      extendTo(c, MAX_ROWS - 1, false);
    } else if (th.classList.contains('rowhead')) {
      const r = rowHeads.indexOf(th); // click a row number: whole row
      select(0, r, false);
      extendTo(MAX_COLS - 1, r, false);
    } else {
      selectAll(); // the empty corner box
    }
  });

  table.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    if (e.buttons === 0) {
      dragging = false; // the button was let go outside the grid
      return;
    }
    const td = e.target.closest('td');
    if (td) extendTo(Number(td.dataset.c), Number(td.dataset.r));
  });

  document.addEventListener('mouseup', () => {
    dragging = false;
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
      } else if (k === 'a') {
        e.preventDefault();
        selectAll();
      }
      return;
    }

    // Arrow keys move; with Shift they stretch the selected block instead.
    const arrow = (dc, dr) => {
      e.preventDefault();
      if (e.shiftKey) extendTo(ext.c + dc, ext.r + dr);
      else move(dc, dr);
    };

    switch (e.key) {
      case 'ArrowUp':
        arrow(0, -1);
        break;
      case 'ArrowDown':
        arrow(0, 1);
        break;
      case 'ArrowLeft':
        arrow(-1, 0);
        break;
      case 'ArrowRight':
        arrow(1, 0);
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
        clearRange();
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
      // Accepts one cell (C5) or a block (A1:B3).
      const parts = nameBox.value.trim().split(':');
      const a = parseRef(parts[0]);
      const b = parts.length === 2 ? parseRef(parts[1]) : a;
      const inGrid = (p) => p && p.c >= 0 && p.r >= 0 && p.c < MAX_COLS && p.r < MAX_ROWS;
      if (parts.length <= 2 && inGrid(a) && inGrid(b)) {
        select(a.c, a.r);
        if (parts.length === 2) extendTo(b.c, b.r);
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
