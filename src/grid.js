/*
 * Mini Excel - the screen ("front of house").
 *
 * This file draws the grid, listens to the mouse and keyboard, and asks the
 * engine (src/engine.js) for every answer. It never does maths itself.
 */
(function () {
  'use strict';

  const { Sheet, FormulaError, MAX_COLS, MAX_ROWS, colName, refName, parseRef, shiftFormula } = window.Engine;
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
  const DEFAULT_W = 90;
  let colWidths = new Array(MAX_COLS).fill(DEFAULT_W); // width of each column in pixels
  const cols = []; // the <col> tags that hold those widths

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
    const group = document.createElement('colgroup');
    const first = document.createElement('col');
    first.style.width = '46px';
    group.appendChild(first);
    for (let c = 0; c < MAX_COLS; c++) {
      const col = document.createElement('col');
      cols.push(col);
      group.appendChild(col);
    }
    table.appendChild(group);
    applyWidths();

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

  function applyWidths() {
    let total = 46;
    for (let c = 0; c < MAX_COLS; c++) {
      cols[c].style.width = colWidths[c] + 'px';
      total += colWidths[c];
    }
    table.style.width = total + 'px';
  }

  // ---------- undo and redo ----------
  // Before every change we keep a photo of the whole sheet. Undo brings the last photo back.
  const undoStack = [];
  const redoStack = [];
  let lastTag = '';
  let lastTime = 0;

  function snapshot() {
    return {
      raw: [...sheet.raw],
      styles: [...styles].map(([k, v]) => [k, Object.assign({}, v)]),
      widths: colWidths.slice(),
    };
  }

  function restore(snap) {
    sheet.clear();
    for (const [k, v] of snap.raw) {
      const [c, r] = k.split(',').map(Number);
      sheet.setRaw(c, r, v);
    }
    styles.clear();
    snap.styles.forEach(([k, v]) => styles.set(k, Object.assign({}, v)));
    colWidths = snap.widths.slice();
    applyWidths();
  }

  // Call this just before changing anything. A tag lets a quick series of the same change
  // (like dragging the colour picker) count as one step.
  function record(tag) {
    const now = Date.now();
    if (tag && tag === lastTag && now - lastTime < 1000) {
      lastTime = now;
      return;
    }
    lastTag = tag || '';
    lastTime = now;
    undoStack.push(snapshot());
    if (undoStack.length > 100) undoStack.shift();
    redoStack.length = 0;
  }

  function undo() {
    if (editing) commitEdit(0, 0);
    if (!undoStack.length) {
      setStatus('Nothing to undo');
      return;
    }
    redoStack.push(snapshot());
    restore(undoStack.pop());
    lastTag = '';
    clearClip();
    refreshAll();
    updateBars();
    setStatus('Undone (' + undoStack.length + ' more steps can be undone)');
  }

  function redo() {
    if (editing) commitEdit(0, 0);
    if (!redoStack.length) {
      setStatus('Nothing to redo');
      return;
    }
    undoStack.push(snapshot());
    restore(redoStack.pop());
    lastTag = '';
    clearClip();
    refreshAll();
    updateBars();
    setStatus('Redone');
  }

  // ---------- auto-save in the browser's own storage ----------
  const SAVE_KEY = 'mini-excel-autosave-v1';
  let saveTimer = null;

  function toSaveData() {
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
    const widths = {};
    colWidths.forEach((w, c) => {
      if (w !== DEFAULT_W) widths[colName(c)] = w;
    });
    return { app: 'mini-excel', version: 2, cells, cols: widths };
  }

  // Put saved data on the sheet. Returns how many cells it held.
  function applyData(data) {
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
    colWidths = new Array(MAX_COLS).fill(DEFAULT_W);
    if (data.cols && typeof data.cols === 'object') {
      for (const [name, w] of Object.entries(data.cols)) {
        const p = parseRef(name + '1');
        if (p && p.c >= 0 && p.c < MAX_COLS && typeof w === 'number') colWidths[p.c] = clamp(Math.round(w), 30, 600);
      }
    }
    applyWidths();
    return count;
  }

  function autosaveNow() {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(toSaveData()));
    } catch (e) {
      /* storage is not available (private window, full): the app still works */
    }
  }
  function scheduleAutosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(autosaveNow, 400);
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
    scheduleAutosave();
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
    record();
    eachInRange((c, r) => sheet.setRaw(c, r, ''));
    refreshAll();
    updateBars();
  }

  function setCell(c, r, text) {
    if (text !== sheet.getRaw(c, r)) record();
    sheet.setRaw(c, r, text);
    refreshAll();
  }

  // ---------- copy, cut and paste ----------
  // The app keeps its own copy of the cells (formulas and formatting). It also puts the
  // shown values on the real clipboard as tab-separated text, so other programs can
  // paste them, and so text copied elsewhere can be pasted here.
  let clip = null; // { c1, r1, cols, rows, cells: [[{ raw, st }]], cut }
  let lastCopiedText = ''; // the text we last put on the real clipboard
  let copyReachedClipboard = false; // did that really work?
  let clipPainted = null; // the block drawn with the dashed frame

  function unmarkClip() {
    if (!clipPainted) return;
    const g = clipPainted;
    for (let r = g.r1; r <= g.r2; r++)
      for (let c = g.c1; c <= g.c2; c++) tds[r][c].classList.remove('clip', 'ct', 'cb', 'cl', 'cr');
    clipPainted = null;
  }

  function markClip(g) {
    unmarkClip();
    for (let r = g.r1; r <= g.r2; r++) {
      for (let c = g.c1; c <= g.c2; c++) {
        const td = tds[r][c];
        td.classList.add('clip');
        if (r === g.r1) td.classList.add('ct');
        if (r === g.r2) td.classList.add('cb');
        if (c === g.c1) td.classList.add('cl');
        if (c === g.c2) td.classList.add('cr');
      }
    }
    clipPainted = g;
  }

  function clearClip() {
    clip = null;
    unmarkClip();
  }

  const blockName = (g) =>
    g.c1 === g.c2 && g.r1 === g.r2 ? refName(g.c1, g.r1) : refName(g.c1, g.r1) + ':' + refName(g.c2, g.r2);

  function doCopy(cut) {
    if (editing) commitEdit(0, 0); // finish typing first
    const g = range();
    const cells = [];
    const shownRows = [];
    for (let r = g.r1; r <= g.r2; r++) {
      const line = [];
      const shown = [];
      for (let c = g.c1; c <= g.c2; c++) {
        line.push({ raw: sheet.getRaw(c, r), st: Object.assign({}, styles.get(key(c, r))) });
        shown.push(sheet.display(c, r));
      }
      cells.push(line);
      shownRows.push(shown);
    }
    clip = { c1: g.c1, r1: g.r1, cols: g.c2 - g.c1 + 1, rows: g.r2 - g.r1 + 1, cells, cut: !!cut };
    lastCopiedText = toCSV(shownRows, '\t');
    copyReachedClipboard = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(lastCopiedText).then(
          () => {
            copyReachedClipboard = true;
          },
          () => {}
        );
      }
    } catch (e) {
      /* the real clipboard is not available: the app's own copy still works */
    }
    markClip(g);
    const n = clip.cols * clip.rows;
    setStatus(
      (cut ? 'Cut ' : 'Copied ') + n + (n === 1 ? ' cell' : ' cells') + ' (' + blockName(g) + '). ' +
        'Click where it should go and press Ctrl+V' + (cut ? ' to move it.' : '.')
    );
  }

  function setStyleOf(c, r, st) {
    if (st === undefined) return; // pasted text: keep the formatting already there
    if (st.b || st.i || st.bg) styles.set(key(c, r), { b: !!st.b, i: !!st.i, bg: st.bg });
    else styles.delete(key(c, r));
  }

  // Put a copied block down with its top-left corner at the selected cell.
  // One copied cell pasted onto a selected block fills the whole block.
  function pasteBlock(src) {
    record();
    const g = range();
    const fill = src.cols === 1 && src.rows === 1 && isMulti(g);
    const spots = [];
    if (fill) eachInRange((c, r) => spots.push({ c, r }));
    else spots.push({ c: g.c1, r: g.r1 });

    if (src.cut) {
      // moving: empty the old place first (the new place may overlap it)
      for (let j = 0; j < src.rows; j++) {
        for (let i = 0; i < src.cols; i++) {
          sheet.setRaw(src.c1 + i, src.r1 + j, '');
          styles.delete(key(src.c1 + i, src.r1 + j));
        }
      }
    }

    let skipped = 0;
    spots.forEach((spot) => {
      for (let j = 0; j < src.rows; j++) {
        for (let i = 0; i < src.cols; i++) {
          const c = spot.c + i;
          const r = spot.r + j;
          if (c >= MAX_COLS || r >= MAX_ROWS) {
            skipped++;
            continue;
          }
          const cell = src.cells[j][i];
          // a copied formula follows the move (=A1 one row down is =A2); a moved one keeps its names
          const raw = src.cut || src.plain ? cell.raw : shiftFormula(cell.raw, spot.c - src.c1, spot.r - src.r1);
          sheet.setRaw(c, r, raw);
          setStyleOf(c, r, cell.st);
        }
      }
    });
    refreshAll();

    const first = spots[0];
    if (!fill) {
      select(first.c, first.r);
      extendTo(Math.min(first.c + src.cols - 1, MAX_COLS - 1), Math.min(first.r + src.rows - 1, MAX_ROWS - 1));
    } else {
      updateBars();
    }
    if (src.cut) clearClip(); // a cut can be pasted once
    const n = src.cols * src.rows * spots.length - skipped;
    setStatus(
      'Pasted ' + n + (n === 1 ? ' cell' : ' cells') + ' at ' + blockName(range()) +
        (skipped ? ' (' + skipped + ' did not fit inside the grid and were left out)' : '')
    );
  }

  // Text from another program: rows are lines, cells are separated by tabs.
  function pasteText(text) {
    const rows = parseCSV(text, '\t');
    if (!rows.length) {
      setStatus('There was no text to paste');
      return;
    }
    const cols = rows.reduce((m, row) => Math.max(m, row.length), 1);
    const cells = rows.map((row) => {
      const line = [];
      for (let i = 0; i < cols; i++) line.push({ raw: row[i] === undefined ? '' : row[i], st: undefined });
      return line;
    });
    pasteBlock({ c1: 0, r1: 0, cols, rows: rows.length, cells, cut: false, plain: true });
  }

  async function doPaste() {
    if (editing) commitEdit(0, 0);
    let outside = '';
    try {
      if (navigator.clipboard && navigator.clipboard.readText) outside = await navigator.clipboard.readText();
    } catch (e) {
      outside = ''; // reading the real clipboard was not allowed: use the app's own copy
    }
    // Our own copy wins unless something newer was copied in another program.
    if (clip && (!copyReachedClipboard || outside === '' || outside === lastCopiedText)) pasteBlock(clip);
    else if (outside) pasteText(outside);
    else setStatus('Nothing to paste yet. Select some cells and press Ctrl+C first.');
  }

  // Ctrl+D / Ctrl+R: copy the top row (or left column) of the block over the rest of it.
  // With only one row (or column) selected, copy from the cell above (or to the left).
  function fillBlock(down) {
    if (editing) commitEdit(0, 0);
    const g = range();
    let srcR = g.r1;
    let srcC = g.c1;
    let startR = g.r1 + 1;
    let startC = g.c1 + 1;
    if (down && g.r1 === g.r2) {
      if (g.r1 === 0) return setStatus('There is nothing above to fill from');
      srcR = g.r1 - 1;
      startR = g.r1;
    }
    if (!down && g.c1 === g.c2) {
      if (g.c1 === 0) return setStatus('There is nothing on the left to fill from');
      srcC = g.c1 - 1;
      startC = g.c1;
    }
    record();
    let n = 0;
    for (let r = g.r1; r <= g.r2; r++) {
      for (let c = g.c1; c <= g.c2; c++) {
        if (down ? r < startR : c < startC) continue;
        const fc = down ? c : srcC;
        const fr = down ? srcR : r;
        sheet.setRaw(c, r, shiftFormula(sheet.getRaw(fc, fr), c - fc, r - fr));
        setStyleOf(c, r, Object.assign({}, styles.get(key(fc, fr))));
        n++;
      }
    }
    refreshAll();
    updateBars();
    setStatus('Filled ' + n + (n === 1 ? ' cell ' : ' cells ') + (down ? 'down' : 'to the right'));
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
    if (input.value !== sheet.getRaw(c, r)) record();
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
  function changeStyle(change, tag) {
    record(tag);
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

  // Save everything (formulas + formatting + column widths) so it can be opened again later.
  function saveFile() {
    const data = toSaveData();
    download('my-sheet.json', JSON.stringify(data, null, 2), 'application/json');
    setStatus('Saved ' + Object.keys(data.cells).length + ' cells to my-sheet.json (check your Downloads folder)');
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
    record();
    sheet.clear();
    styles.clear();
    colWidths = new Array(MAX_COLS).fill(DEFAULT_W);
    applyWidths();
    clearClip();
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
    const count = applyData(data);
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
  // Is the pointer on the right edge of a column letter? (that edge is the resize handle)
  const onEdge = (th, x) => th.classList.contains('colhead') && x > th.getBoundingClientRect().right - 6;
  let resizing = null; // { c, startX, startW, recorded }

  function fitColumn(c) {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = getComputedStyle(tds[0][c]).font;
    let widest = ctx.measureText(colName(c)).width;
    for (let r = 0; r < MAX_ROWS; r++) {
      const text = sheet.display(c, r);
      if (text) widest = Math.max(widest, ctx.measureText(text).width * ((styles.get(key(c, r)) || {}).b ? 1.1 : 1));
    }
    record();
    colWidths[c] = clamp(Math.ceil(widest) + 14, 40, 500);
    applyWidths();
    scheduleAutosave();
    setStatus('Column ' + colName(c) + ' fitted to its text (double-click the edge)');
  }

  table.addEventListener('mousemove', (e) => {
    if (resizing) return;
    const th = e.target.closest && e.target.closest('th.colhead');
    table.style.cursor = th && onEdge(th, e.clientX) ? 'col-resize' : '';
  });

  document.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    if (!resizing.recorded) {
      record();
      resizing.recorded = true;
    }
    colWidths[resizing.c] = clamp(resizing.startW + e.clientX - resizing.startX, 30, 600);
    applyWidths();
  });
  document.addEventListener('mouseup', () => {
    if (resizing) {
      if (resizing.recorded) {
        scheduleAutosave();
        setStatus('Column ' + colName(resizing.c) + ' is now ' + colWidths[resizing.c] + ' pixels wide');
      }
      resizing = null;
      table.style.cursor = '';
    }
  });

  table.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'INPUT') return; // clicking inside the cell editor
    const td = e.target.closest('td');
    const th = e.target.closest('th');
    if (!td && !th) return;
    e.preventDefault();
    if (th && onEdge(th, e.clientX)) {
      const c = colHeads.indexOf(th);
      resizing = { c, startX: e.clientX, startW: colWidths[c], recorded: false };
      return;
    }
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

  // Phones: a quick second tap on the same cell starts typing (a finger has no double-click).
  let touchStart = null;
  let lastTap = { t: 0, c: -1, r: -1 };
  table.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      touchStart = e.touches.length === 1 ? { x: t.clientX, y: t.clientY } : null;
    },
    { passive: true }
  );
  table.addEventListener(
    'touchend',
    (e) => {
      const td = e.target.closest && e.target.closest('td');
      const t = e.changedTouches[0];
      const moved = !touchStart || Math.abs(t.clientX - touchStart.x) > 10 || Math.abs(t.clientY - touchStart.y) > 10;
      touchStart = null;
      if (!td || e.target.tagName === 'INPUT' || moved) return; // scrolling is not a tap
      const c = Number(td.dataset.c);
      const r = Number(td.dataset.r);
      const now = Date.now();
      if (now - lastTap.t < 450 && lastTap.c === c && lastTap.r === r) {
        e.preventDefault();
        lastTap = { t: 0, c: -1, r: -1 };
        select(c, r);
        startEdit();
      } else {
        lastTap = { t: now, c, r };
      }
    },
    { passive: false }
  );

  table.addEventListener('dblclick', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const head = e.target.closest('th.colhead');
    if (head && onEdge(head, e.clientX)) {
      fitColumn(colHeads.indexOf(head));
      return;
    }
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
      } else if (k === 'c') {
        e.preventDefault();
        doCopy(false);
      } else if (k === 'x') {
        e.preventDefault();
        doCopy(true);
      } else if (k === 'v') {
        e.preventDefault();
        doPaste();
      } else if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        redo();
      } else if (k === 'd') {
        e.preventDefault();
        fillBlock(true);
      } else if (k === 'r') {
        e.preventDefault();
        fillBlock(false);
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
      case 'Escape':
        e.preventDefault();
        if (clip) {
          clearClip();
          setStatus('Copy cancelled');
        }
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
    }, 'fill')
  );
  fillColor.addEventListener('change', () => gridWrap.focus({ preventScroll: true }));
  $('btn-nofill').addEventListener('click', () =>
    changeStyle((st) => {
      delete st.bg;
    })
  );
  $('btn-undo').addEventListener('click', undo);
  $('btn-redo').addEventListener('click', redo);
  $('btn-filldown').addEventListener('click', () => fillBlock(true));
  $('btn-fillright').addEventListener('click', () => fillBlock(false));
  $('btn-cut').addEventListener('click', () => doCopy(true));
  $('btn-copy').addEventListener('click', () => doCopy(false));
  $('btn-paste').addEventListener('click', doPaste);
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
  let restored = 0;
  try {
    const saved = JSON.parse(window.localStorage.getItem(SAVE_KEY) || 'null');
    if (saved && typeof saved.cells === 'object' && saved.cells) restored = applyData(saved);
  } catch (e) {
    restored = 0; // nothing saved yet, or it could not be read: start empty
  }
  refreshAll();
  select(0, 0);
  gridWrap.focus({ preventScroll: true });
  setStatus(
    restored
      ? 'Welcome back - your last sheet was restored (' + restored + ' cells). It saves itself as you work.'
      : window.matchMedia && window.matchMedia('(pointer: coarse)').matches
      ? 'Tap a cell to select it, tap it again quickly to type. Start with = for a formula.'
      : 'Ready - click a cell and type. Start with = for a formula, for example =SUM(A1:A3)'
  );
})();
