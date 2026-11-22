/*
 * Mini Excel - charts.
 * Two jobs, both plain functions with no screen code (so they can be tested with npm test):
 *   chartData(rows, options)      turns a block of cell values into labels + number series
 *   chartSVG(type, data, options) draws them as a picture (SVG text): 'column', 'line' or 'pie'
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Chart = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const COLORS = ['#217346', '#2f80ed', '#e07b00', '#9b51e0', '#d93f3f', '#00a3a3', '#7a8b00', '#8a5a44'];
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const isText = (v) => typeof v === 'string' && v.trim() !== '';

  // rows: a list of rows, each a list of cell values (number, text, or null for empty).
  // options.labels: true = first column holds the names, false = it does not, undefined = guess.
  function chartData(rows, options) {
    options = options || {};
    const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
    if (!rows.length || !cols) return { labels: [], series: [], header: false, labelsFromFirst: false };

    const col = (c, from) => rows.slice(from).map((r) => (r[c] === undefined ? null : r[c]));

    // A header row: every column that holds numbers starts with a piece of text.
    let header = false;
    if (rows.length > 1) {
      const numericCols = [];
      for (let c = 0; c < cols; c++) if (col(c, 1).some(isNum)) numericCols.push(c);
      header = numericCols.length > 0 && numericCols.every((c) => isText(rows[0][c]));
    }
    const from = header ? 1 : 0;

    // The first column is names when it holds text only (and there is something else to draw).
    let labelsFromFirst;
    if (cols < 2) labelsFromFirst = false;
    else if (typeof options.labels === 'boolean') labelsFromFirst = options.labels;
    else {
      const first = col(0, from);
      labelsFromFirst = first.some(isText) && !first.some(isNum);
    }

    const count = rows.length - from;
    const labels = [];
    for (let i = 0; i < count; i++) {
      const v = labelsFromFirst ? rows[from + i][0] : null;
      labels.push(v === null || v === undefined || v === '' ? String(i + 1) : String(v));
    }
    const series = [];
    for (let c = labelsFromFirst ? 1 : 0; c < cols; c++) {
      const head = header ? rows[0][c] : null;
      series.push({
        name: isText(head) ? String(head) : 'Series ' + (series.length + 1),
        values: col(c, from).map((v) => (isNum(v) ? v : 0)),
      });
    }
    return { labels, series, header, labelsFromFirst };
  }

  const esc = (t) =>
    String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const cut = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

  // A pleasant axis: [min, max, step] with round numbers.
  function niceScale(lo, hi, ticks) {
    if (lo === hi) {
      hi = lo + 1;
      if (lo > 0) lo = 0;
    }
    const raw = (hi - lo) / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
    return { min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step, step };
  }
  const short = (n) => {
    const a = Math.abs(n);
    if (a >= 1e9) return parseFloat((n / 1e9).toPrecision(3)) + 'B';
    if (a >= 1e6) return parseFloat((n / 1e6).toPrecision(3)) + 'M';
    if (a >= 1e4) return parseFloat((n / 1e3).toPrecision(3)) + 'k';
    return String(parseFloat(n.toPrecision(6)));
  };

  function chartSVG(type, data, options) {
    options = options || {};
    const W = options.width || 640;
    const H = options.height || 400;
    const title = options.title || '';
    const font = "font-family=\"'Segoe UI', system-ui, sans-serif\"";
    let out = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
      '" role="img" aria-label="' + esc(title || type + ' chart') + '">';
    out += '<rect width="' + W + '" height="' + H + '" fill="#ffffff"/>';
    if (title) out += '<text x="' + W / 2 + '" y="26" text-anchor="middle" font-size="17" font-weight="600" fill="#222" ' + font + '>' + esc(title) + '</text>';

    const n = data.labels.length;
    const any = data.series.length && n;
    if (!any) {
      return out + '<text x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle" font-size="14" fill="#666" ' + font + '>Nothing to draw. Select numbers first.</text></svg>';
    }

    const top = title ? 48 : 20;
    const legendNeeded = type === 'pie' ? true : data.series.length > 1;

    if (type === 'pie') {
      const vals = data.series[0].values.map((v) => (v > 0 ? v : 0));
      const total = vals.reduce((a, b) => a + b, 0);
      if (total <= 0) return out + '<text x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle" font-size="14" fill="#666" ' + font + '>Nothing to draw: the numbers are zero or negative.</text></svg>';
      const legendW = Math.min(200, W * 0.32);
      const cx = (W - legendW) / 2;
      const cy = top + (H - top - 12) / 2;
      const rad = Math.min((W - legendW) / 2 - 16, (H - top - 12) / 2);
      let ang = -Math.PI / 2;
      vals.forEach((v, i) => {
        if (v === 0) return;
        const part = (v / total) * Math.PI * 2;
        const color = COLORS[i % COLORS.length];
        if (part >= Math.PI * 2 - 1e-9) out += '<circle cx="' + cx + '" cy="' + cy + '" r="' + rad + '" fill="' + color + '"/>';
        else {
          const x1 = cx + rad * Math.cos(ang);
          const y1 = cy + rad * Math.sin(ang);
          const x2 = cx + rad * Math.cos(ang + part);
          const y2 = cy + rad * Math.sin(ang + part);
          out += '<path d="M' + cx + ',' + cy + ' L' + x1.toFixed(2) + ',' + y1.toFixed(2) + ' A' + rad + ',' + rad + ' 0 ' + (part > Math.PI ? 1 : 0) + ' 1 ' + x2.toFixed(2) + ',' + y2.toFixed(2) + ' Z" fill="' + color + '" stroke="#fff" stroke-width="2"/>';
        }
        if (part > 0.25) {
          const mid = ang + part / 2;
          out += '<text x="' + (cx + rad * 0.62 * Math.cos(mid)).toFixed(1) + '" y="' + (cy + rad * 0.62 * Math.sin(mid) + 4).toFixed(1) + '" text-anchor="middle" font-size="12" font-weight="600" fill="#fff" ' + font + '>' + Math.round((v / total) * 100) + '%</text>';
        }
        ang += part;
      });
      const rowH = 20;
      const lx = W - legendW + 4;
      let ly = Math.max(top, cy - (Math.min(n, 12) * rowH) / 2);
      data.labels.slice(0, 12).forEach((label, i) => {
        out += '<rect x="' + lx + '" y="' + ly + '" width="12" height="12" rx="2" fill="' + COLORS[i % COLORS.length] + '"/>';
        out += '<text x="' + (lx + 18) + '" y="' + (ly + 10.5) + '" font-size="12" fill="#333" ' + font + '>' + esc(cut(label, 18)) + '</text>';
        ly += rowH;
      });
      return out + '</svg>';
    }

    // column and line charts
    const left = 58;
    const right = 16;
    const legendH = legendNeeded ? 24 : 0;
    const rotate = n > 8;
    const bottom = (rotate ? 70 : 42) + legendH;
    const px0 = left;
    const px1 = W - right;
    const py0 = top;
    const py1 = H - bottom;
    let lo = 0;
    let hi = 0;
    data.series.forEach((s) => s.values.forEach((v) => {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }));
    if (type === 'line') {
      lo = Infinity;
      hi = -Infinity;
      data.series.forEach((s) => s.values.forEach((v) => {
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }));
      if (lo > 0 && lo < (hi - lo) * 3) lo = 0; // start at zero unless the numbers are far from it
    }
    const sc = niceScale(lo, hi, 5);
    const y = (v) => py1 - ((v - sc.min) / (sc.max - sc.min)) * (py1 - py0);
    for (let t = sc.min; t <= sc.max + sc.step / 2; t += sc.step) {
      const yy = y(t).toFixed(1);
      out += '<line x1="' + px0 + '" x2="' + px1 + '" y1="' + yy + '" y2="' + yy + '" stroke="#e2e2e2"/>';
      out += '<text x="' + (px0 - 8) + '" y="' + (Number(yy) + 4) + '" text-anchor="end" font-size="11" fill="#555" ' + font + '>' + short(t) + '</text>';
    }
    const zero = y(0).toFixed(1);
    out += '<line x1="' + px0 + '" x2="' + px1 + '" y1="' + zero + '" y2="' + zero + '" stroke="#888"/>';
    out += '<line x1="' + px0 + '" x2="' + px0 + '" y1="' + py0 + '" y2="' + py1 + '" stroke="#888"/>';

    const slot = (px1 - px0) / n;
    const every = Math.max(1, Math.ceil(n / 24)); // many labels: show every few
    data.labels.forEach((label, i) => {
      if (i % every) return;
      const x = px0 + slot * (i + 0.5);
      const ty = py1 + 16;
      if (rotate) out += '<text transform="translate(' + x.toFixed(1) + ',' + ty + ') rotate(-35)" text-anchor="end" font-size="11" fill="#444" ' + font + '>' + esc(cut(label, 14)) + '</text>';
      else out += '<text x="' + x.toFixed(1) + '" y="' + ty + '" text-anchor="middle" font-size="11" fill="#444" ' + font + '>' + esc(cut(label, 12)) + '</text>';
    });

    if (type === 'line') {
      data.series.forEach((s, si) => {
        const color = COLORS[si % COLORS.length];
        const pts = s.values.map((v, i) => (px0 + slot * (i + 0.5)).toFixed(1) + ',' + y(v).toFixed(1));
        out += '<polyline fill="none" stroke="' + color + '" stroke-width="2.5" stroke-linejoin="round" points="' + pts.join(' ') + '"/>';
        s.values.forEach((v, i) => {
          out += '<circle cx="' + (px0 + slot * (i + 0.5)).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="3.5" fill="' + color + '"/>';
        });
      });
    } else {
      const group = slot * 0.78;
      const bw = group / data.series.length;
      data.series.forEach((s, si) => {
        const color = COLORS[si % COLORS.length];
        s.values.forEach((v, i) => {
          const x = px0 + slot * i + (slot - group) / 2 + bw * si;
          const y1 = y(Math.max(v, 0));
          const y2 = y(Math.min(v, 0));
          out += '<rect x="' + x.toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + Math.max(1, bw - 2).toFixed(1) + '" height="' + Math.max(0.5, y2 - y1).toFixed(1) + '" rx="2" fill="' + color + '"/>';
        });
      });
    }

    if (legendNeeded) {
      let lx = px0;
      const ly = H - 14;
      data.series.forEach((s, si) => {
        const name = cut(s.name, 16);
        out += '<rect x="' + lx + '" y="' + (ly - 10) + '" width="12" height="12" rx="2" fill="' + COLORS[si % COLORS.length] + '"/>';
        out += '<text x="' + (lx + 17) + '" y="' + ly + '" font-size="12" fill="#333" ' + font + '>' + esc(name) + '</text>';
        lx += 30 + name.length * 6.6;
      });
    }
    return out + '</svg>';
  }

  return { chartData, chartSVG, COLORS };
});
