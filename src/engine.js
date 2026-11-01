/*
 * Mini Excel - the formula engine ("the kitchen").
 *
 * This file knows nothing about the screen. It only stores what is typed
 * into cells and works out the answers. That is why it can be tested
 * on its own:  npm test
 *
 * Cells are numbered from 0:  A1 is (c=0, r=0),  B3 is (c=1, r=2).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(); // Node (tests)
  else root.Engine = factory(); // browser / Electron window
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_COLS = 26; // A..Z
  const MAX_ROWS = 200;

  // ---------- small helpers ----------

  class FormulaError {
    constructor(code) {
      this.code = code; // e.g. '#DIV/0!'
    }
    toString() {
      return this.code;
    }
  }
  const err = (code) => new FormulaError(code);

  // 0 -> "A", 25 -> "Z", 26 -> "AA"
  function colName(c) {
    let s = '';
    c += 1;
    while (c > 0) {
      const m = (c - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      c = Math.floor((c - 1) / 26);
    }
    return s;
  }

  // "A" -> 0, "Z" -> 25, "AA" -> 26
  function colIndex(letters) {
    let n = 0;
    for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  // "B3" or "$B$3" -> { c: 1, r: 2 }   (or null if it is not a cell name)
  function parseRef(text) {
    const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(text);
    if (!m) return null;
    return { c: colIndex(m[1]), r: parseInt(m[2], 10) - 1 };
  }

  function refName(c, r) {
    return colName(c) + (r + 1);
  }

  // A cell range such as A1:B3 arrives inside functions as one of these.
  class Range {
    constructor(values) {
      this.values = values; // flat list of the cell values
    }
  }

  // Turn a Range of exactly one cell into that value; anything else is an error.
  function sc(a) {
    if (a instanceof Range) {
      if (a.values.length === 1) return a.values[0];
      throw err('#VALUE!');
    }
    if (a === undefined) throw err('#ERROR!');
    return a;
  }

  const NUMBER_RE = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

  function toNumber(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (typeof v === 'string') {
      const s = v.trim();
      if (NUMBER_RE.test(s)) return parseFloat(s);
      throw err('#VALUE!');
    }
    throw err('#VALUE!');
  }

  function fmtNumber(n) {
    // 0.1 + 0.2 should show 0.3, not 0.30000000000000004
    return String(parseFloat(n.toPrecision(12)));
  }

  function toText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return fmtNumber(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  }

  function toBool(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') {
      const s = v.trim().toUpperCase();
      if (s === 'TRUE') return true;
      if (s === 'FALSE') return false;
    }
    throw err('#VALUE!');
  }

  // Keep results finite: 1e999 or sqrt(-1) become #NUM!
  function fin(x) {
    if (!Number.isFinite(x)) throw err('#NUM!');
    return x;
  }

  // -1, 0 or 1. Numbers < text < TRUE/FALSE, like Excel. Text ignores capitals.
  function compareValues(a, b) {
    if (a === null) a = typeof b === 'string' ? '' : typeof b === 'boolean' ? false : 0;
    if (b === null) b = typeof a === 'string' ? '' : typeof a === 'boolean' ? false : 0;
    const rank = (v) => (typeof v === 'number' ? 1 : typeof v === 'string' ? 2 : 3);
    if (rank(a) !== rank(b)) return rank(a) < rank(b) ? -1 : 1;
    if (typeof a === 'string') {
      a = a.toLowerCase();
      b = b.toLowerCase();
    }
    return a < b ? -1 : a > b ? 1 : 0;
  }

  // What a typed (non-formula) cell means: number, TRUE/FALSE, or text.
  function literalFromText(raw) {
    if (raw[0] === "'") return raw.slice(1); // 'abc forces text
    const s = raw.trim();
    if (NUMBER_RE.test(s)) return parseFloat(s);
    if (/^true$/i.test(s)) return true;
    if (/^false$/i.test(s)) return false;
    return raw;
  }

  // ---------- step 1: cut the formula text into pieces ("tokens") ----------

  function tokenize(src) {
    const tokens = [];
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (/\s/.test(ch)) {
        i++;
        continue;
      }
      if (/[0-9.]/.test(ch)) {
        const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
        if (!m) throw err('#ERROR!');
        tokens.push({ t: 'num', v: parseFloat(m[0]) });
        i += m[0].length;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        let s = '';
        let closed = false;
        while (j < src.length) {
          if (src[j] === '"') {
            if (src[j + 1] === '"') {
              s += '"';
              j += 2;
              continue;
            }
            closed = true;
            break;
          }
          s += src[j++];
        }
        if (!closed) throw err('#ERROR!');
        tokens.push({ t: 'str', v: s });
        i = j + 1;
        continue;
      }
      if (/[A-Za-z_$]/.test(ch)) {
        const m = /^[A-Za-z_$][A-Za-z0-9_$.]*/.exec(src.slice(i));
        tokens.push({ t: 'id', v: m[0] });
        i += m[0].length;
        continue;
      }
      const two = src.slice(i, i + 2);
      if (two === '<=' || two === '>=' || two === '<>') {
        tokens.push({ t: 'op', v: two });
        i += 2;
        continue;
      }
      if ('+-*/^&=<>(),:%'.includes(ch)) {
        tokens.push({ t: 'op', v: ch });
        i++;
        continue;
      }
      throw err('#ERROR!');
    }
    return tokens;
  }

  // ---------- step 2: build a "tree" that shows the order of the maths ----------
  // Lowest priority first:  compare  <  &  <  + -  <  * /  <  ^  <  -x  <  %

  function parse(src) {
    const tokens = tokenize(src);
    let p = 0;
    const peek = () => tokens[p];
    const isOp = (v) => p < tokens.length && tokens[p].t === 'op' && tokens[p].v === v;
    const next = () => tokens[p++];

    function parseComparison() {
      let left = parseConcat();
      while (peek() && peek().t === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(peek().v)) {
        const op = next().v;
        left = { t: 'bin', op, l: left, r: parseConcat() };
      }
      return left;
    }
    function parseConcat() {
      let left = parseAdditive();
      while (isOp('&')) {
        next();
        left = { t: 'bin', op: '&', l: left, r: parseAdditive() };
      }
      return left;
    }
    function parseAdditive() {
      let left = parseMultiplicative();
      while (isOp('+') || isOp('-')) {
        const op = next().v;
        left = { t: 'bin', op, l: left, r: parseMultiplicative() };
      }
      return left;
    }
    function parseMultiplicative() {
      let left = parsePower();
      while (isOp('*') || isOp('/')) {
        const op = next().v;
        left = { t: 'bin', op, l: left, r: parsePower() };
      }
      return left;
    }
    function parsePower() {
      let left = parseUnary();
      while (isOp('^')) {
        next();
        left = { t: 'bin', op: '^', l: left, r: parseUnary() };
      }
      return left;
    }
    function parseUnary() {
      if (isOp('-') || isOp('+')) {
        const op = next().v;
        return { t: 'un', op, e: parseUnary() };
      }
      return parsePostfix();
    }
    function parsePostfix() {
      let e = parsePrimary();
      while (isOp('%')) {
        next();
        e = { t: 'pct', e };
      }
      return e;
    }
    function parsePrimary() {
      const tok = next();
      if (!tok) throw err('#ERROR!');
      if (tok.t === 'num') return { t: 'num', v: tok.v };
      if (tok.t === 'str') return { t: 'str', v: tok.v };
      if (tok.t === 'op' && tok.v === '(') {
        const e = parseComparison();
        if (!isOp(')')) throw err('#ERROR!');
        next();
        return e;
      }
      if (tok.t === 'id') {
        if (isOp('(')) {
          next();
          const name = tok.v.toUpperCase();
          const args = [];
          if (isOp(')')) {
            next();
            return { t: 'fn', name, args };
          }
          for (;;) {
            args.push(parseComparison());
            if (isOp(',')) {
              next();
              continue;
            }
            if (isOp(')')) {
              next();
              break;
            }
            throw err('#ERROR!');
          }
          return { t: 'fn', name, args };
        }
        const up = tok.v.toUpperCase();
        if (up === 'TRUE') return { t: 'bool', v: true };
        if (up === 'FALSE') return { t: 'bool', v: false };
        const ref = parseRef(tok.v);
        if (ref) {
          if (isOp(':')) {
            next();
            const t2 = next();
            const ref2 = t2 && t2.t === 'id' ? parseRef(t2.v) : null;
            if (!ref2) throw err('#ERROR!');
            return {
              t: 'range',
              c1: Math.min(ref.c, ref2.c),
              r1: Math.min(ref.r, ref2.r),
              c2: Math.max(ref.c, ref2.c),
              r2: Math.max(ref.r, ref2.r),
            };
          }
          return { t: 'ref', c: ref.c, r: ref.r };
        }
        throw err('#NAME?');
      }
      throw err('#ERROR!');
    }

    const ast = parseComparison();
    if (p < tokens.length) throw err('#ERROR!');
    return ast;
  }

  // ---------- the built-in functions ----------
  // Each one receives a list of arguments. A cell range arrives as a Range.

  const N = (a) => toNumber(sc(a)); // argument as a number

  function chk(args, min, max = Infinity) {
    if (args.length < min || args.length > max) throw err('#ERROR!');
  }

  function flat(args) {
    const out = [];
    for (const a of args) {
      if (a instanceof Range) for (const v of a.values) out.push(v);
      else out.push(a);
    }
    return out;
  }

  // Numbers for SUM/AVERAGE/...: inside a range only real numbers count.
  function nums(args) {
    chk(args, 1);
    const out = [];
    for (const a of args) {
      if (a instanceof Range) {
        for (const v of a.values) if (typeof v === 'number') out.push(v);
      } else {
        out.push(toNumber(a));
      }
    }
    return out;
  }
  const sum = (list) => list.reduce((x, y) => x + y, 0);

  function bools(args) {
    chk(args, 1);
    const out = [];
    for (const a of args) {
      if (a instanceof Range) {
        for (const v of a.values) if (typeof v === 'boolean' || typeof v === 'number') out.push(toBool(v));
      } else {
        out.push(toBool(a));
      }
    }
    if (!out.length) throw err('#VALUE!');
    return out;
  }

  // Criteria for COUNTIF / SUMIF:  5   ">5"   "<>apple"   "apple"
  function makeCriteria(crit) {
    let op = '=';
    let operand = crit;
    if (typeof crit === 'string') {
      const m = /^(<=|>=|<>|<|>|=)?([\s\S]*)$/.exec(crit);
      op = m[1] || '=';
      operand = m[2];
      if (operand.trim() !== '' && !isNaN(Number(operand))) operand = Number(operand);
    } else if (typeof crit === 'boolean') {
      operand = crit ? 'TRUE' : 'FALSE';
    }
    return (v) => {
      if (v === null) return op === '<>';
      const sameKind = typeof operand === 'number' ? typeof v === 'number' : typeof v === 'string';
      if (!sameKind) return op === '<>';
      let a = v;
      let b = operand;
      if (typeof a === 'string') {
        a = a.toLowerCase();
        b = String(b).toLowerCase();
      }
      switch (op) {
        case '=': return a === b;
        case '<>': return a !== b;
        case '<': return a < b;
        case '>': return a > b;
        case '<=': return a <= b;
        default: return a >= b;
      }
    };
  }

  function roundTo(x, digits) {
    const sign = x < 0 ? -1 : 1;
    const abs = Math.abs(x);
    if (digits >= 0) {
      const m = Math.pow(10, digits);
      return (sign * Math.round(Number((abs * m).toPrecision(15)))) / m;
    }
    const m = Math.pow(10, -digits);
    return sign * Math.round(Number((abs / m).toPrecision(15))) * m;
  }

  const F = {
    // maths
    SUM: (a) => sum(nums(a)),
    AVERAGE: (a) => {
      const n = nums(a);
      if (!n.length) throw err('#DIV/0!');
      return sum(n) / n.length;
    },
    MIN: (a) => {
      const n = nums(a);
      return n.length ? Math.min(...n) : 0;
    },
    MAX: (a) => {
      const n = nums(a);
      return n.length ? Math.max(...n) : 0;
    },
    PRODUCT: (a) => {
      const n = nums(a);
      return n.length ? n.reduce((x, y) => x * y, 1) : 0;
    },
    MEDIAN: (a) => {
      const n = nums(a).sort((x, y) => x - y);
      if (!n.length) throw err('#NUM!');
      const mid = Math.floor(n.length / 2);
      return n.length % 2 ? n[mid] : (n[mid - 1] + n[mid]) / 2;
    },
    COUNT: (a) => {
      chk(a, 1);
      let n = 0;
      for (const x of a) {
        if (x instanceof Range) n += x.values.filter((v) => typeof v === 'number').length;
        else {
          try {
            toNumber(x);
            n++;
          } catch (e) {
            /* not a number - not counted */
          }
        }
      }
      return n;
    },
    COUNTA: (a) => {
      chk(a, 1);
      return flat(a).filter((v) => v !== null).length;
    },
    ABS: (a) => (chk(a, 1, 1), Math.abs(N(a[0]))),
    SQRT: (a) => {
      chk(a, 1, 1);
      const x = N(a[0]);
      if (x < 0) throw err('#NUM!');
      return Math.sqrt(x);
    },
    POWER: (a) => (chk(a, 2, 2), Math.pow(N(a[0]), N(a[1]))),
    MOD: (a) => {
      chk(a, 2, 2);
      const n = N(a[0]);
      const d = N(a[1]);
      if (d === 0) throw err('#DIV/0!');
      return n - d * Math.floor(n / d);
    },
    INT: (a) => (chk(a, 1, 1), Math.floor(N(a[0]))),
    ROUND: (a) => (chk(a, 1, 2), roundTo(N(a[0]), a.length > 1 ? Math.trunc(N(a[1])) : 0)),
    PI: (a) => (chk(a, 0, 0), Math.PI),

    // text
    CONCAT: (a) => (chk(a, 1), flat(a).map((v) => toText(v)).join('')),
    CONCATENATE: (a) => (chk(a, 1), flat(a).map((v) => toText(v)).join('')),
    LEN: (a) => (chk(a, 1, 1), toText(sc(a[0])).length),
    UPPER: (a) => (chk(a, 1, 1), toText(sc(a[0])).toUpperCase()),
    LOWER: (a) => (chk(a, 1, 1), toText(sc(a[0])).toLowerCase()),
    TRIM: (a) => (chk(a, 1, 1), toText(sc(a[0])).trim().replace(/\s+/g, ' ')),
    LEFT: (a) => {
      chk(a, 1, 2);
      const n = a.length > 1 ? Math.trunc(N(a[1])) : 1;
      if (n < 0) throw err('#VALUE!');
      return toText(sc(a[0])).slice(0, n);
    },
    RIGHT: (a) => {
      chk(a, 1, 2);
      const n = a.length > 1 ? Math.trunc(N(a[1])) : 1;
      if (n < 0) throw err('#VALUE!');
      return n === 0 ? '' : toText(sc(a[0])).slice(-n);
    },

    // logic  (IF and IFERROR are special - see evalFn)
    AND: (a) => bools(a).every((x) => x),
    OR: (a) => bools(a).some((x) => x),
    NOT: (a) => (chk(a, 1, 1), !toBool(sc(a[0]))),

    // counting with a condition
    COUNTIF: (a) => {
      chk(a, 2, 2);
      if (!(a[0] instanceof Range)) throw err('#VALUE!');
      const test = makeCriteria(sc(a[1]));
      return a[0].values.filter((v) => test(v)).length;
    },
    SUMIF: (a) => {
      chk(a, 2, 3);
      if (!(a[0] instanceof Range)) throw err('#VALUE!');
      const test = makeCriteria(sc(a[1]));
      const sumRange = a.length > 2 ? a[2] : a[0];
      if (!(sumRange instanceof Range)) throw err('#VALUE!');
      let total = 0;
      a[0].values.forEach((v, i) => {
        const s = sumRange.values[i];
        if (test(v) && typeof s === 'number') total += s;
      });
      return total;
    },
  };

  // ---------- the sheet: stores cells and works out answers ----------

  class Sheet {
    constructor() {
      this.raw = new Map(); // "c,r" -> exactly what the user typed
      this.cache = new Map(); // "c,r" -> already worked-out answer
      this.visiting = new Set(); // cells being worked out right now (spots loops)
      this.asts = new Map(); // formula text -> parsed tree
    }

    static key(c, r) {
      return c + ',' + r;
    }

    // Save what the user typed ('' empties the cell).
    setRaw(c, r, text) {
      const k = Sheet.key(c, r);
      text = text === undefined || text === null ? '' : String(text);
      if (text === '') this.raw.delete(k);
      else this.raw.set(k, text);
      this.cache.clear(); // any change can affect any formula
    }

    getRaw(c, r) {
      return this.raw.get(Sheet.key(c, r)) || '';
    }

    clear() {
      this.raw.clear();
      this.cache.clear();
    }

    // Answer for the screen: a number, text, true/false, null (empty) or a FormulaError.
    getValue(c, r) {
      try {
        return this.cellValue(c, r);
      } catch (e) {
        if (e instanceof FormulaError) return e;
        throw e;
      }
    }

    // The text the screen shows in the cell.
    display(c, r) {
      const v = this.getValue(c, r);
      if (v === null) return '';
      if (v instanceof FormulaError) return v.code;
      return toText(v);
    }

    // ----- inside the kitchen -----

    cellValue(c, r) {
      const k = Sheet.key(c, r);
      const hit = this.cache.get(k);
      if (hit) {
        if (hit.error) throw hit.error;
        return hit.value;
      }
      const raw = this.raw.get(k);
      if (raw === undefined) return null; // empty cell
      if (this.visiting.has(k)) throw err('#CIRC!');
      this.visiting.add(k);
      try {
        const value = this.compute(raw);
        this.cache.set(k, { value });
        return value;
      } catch (e) {
        if (e instanceof FormulaError) this.cache.set(k, { error: e });
        throw e;
      } finally {
        this.visiting.delete(k);
      }
    }

    compute(raw) {
      if (raw[0] !== '=' || raw.length < 2) return literalFromText(raw);
      let entry = this.asts.get(raw);
      if (!entry) {
        try {
          entry = { ast: parse(raw.slice(1)) };
        } catch (e) {
          if (!(e instanceof FormulaError)) throw e;
          entry = { error: e };
        }
        this.asts.set(raw, entry);
      }
      if (entry.error) throw entry.error;
      let v = this.evalNode(entry.ast);
      if (v instanceof Range) v = sc(v);
      return v === null ? 0 : v; // =A5 with A5 empty shows 0
    }

    checkBounds(c, r) {
      if (c < 0 || r < 0 || c >= MAX_COLS || r >= MAX_ROWS) throw err('#REF!');
    }

    evalNode(n) {
      switch (n.t) {
        case 'num':
        case 'str':
        case 'bool':
          return n.v;
        case 'ref':
          this.checkBounds(n.c, n.r);
          return this.cellValue(n.c, n.r);
        case 'range': {
          this.checkBounds(n.c1, n.r1);
          this.checkBounds(n.c2, n.r2);
          const values = [];
          for (let r = n.r1; r <= n.r2; r++) for (let c = n.c1; c <= n.c2; c++) values.push(this.cellValue(c, r));
          return new Range(values);
        }
        case 'un': {
          const v = toNumber(sc(this.evalNode(n.e)));
          return n.op === '-' ? -v : v;
        }
        case 'pct':
          return toNumber(sc(this.evalNode(n.e))) / 100;
        case 'bin':
          return this.evalBinary(n);
        case 'fn':
          return this.evalFn(n);
        default:
          throw err('#ERROR!');
      }
    }

    evalBinary(n) {
      const l = sc(this.evalNode(n.l));
      const r = sc(this.evalNode(n.r));
      switch (n.op) {
        case '+': return fin(toNumber(l) + toNumber(r));
        case '-': return fin(toNumber(l) - toNumber(r));
        case '*': return fin(toNumber(l) * toNumber(r));
        case '/': {
          const d = toNumber(r);
          if (d === 0) throw err('#DIV/0!');
          return fin(toNumber(l) / d);
        }
        case '^': return fin(Math.pow(toNumber(l), toNumber(r)));
        case '&': return toText(l) + toText(r);
        case '=': return compareValues(l, r) === 0;
        case '<>': return compareValues(l, r) !== 0;
        case '<': return compareValues(l, r) < 0;
        case '>': return compareValues(l, r) > 0;
        case '<=': return compareValues(l, r) <= 0;
        case '>=': return compareValues(l, r) >= 0;
        default: throw err('#ERROR!');
      }
    }

    evalFn(n) {
      // IF only works out the branch it needs (so IF(B1=0,0,A1/B1) is safe)
      if (n.name === 'IF') {
        chk(n.args, 2, 3);
        if (toBool(sc(this.evalNode(n.args[0])))) return this.evalNode(n.args[1]);
        return n.args.length === 3 ? this.evalNode(n.args[2]) : false;
      }
      if (n.name === 'IFERROR') {
        chk(n.args, 2, 2);
        try {
          return sc(this.evalNode(n.args[0]));
        } catch (e) {
          if (e instanceof FormulaError) return this.evalNode(n.args[1]);
          throw e;
        }
      }
      const fn = F[n.name];
      if (!fn) throw err('#NAME?');
      const args = n.args.map((a) => {
        const v = this.evalNode(a);
        return a.t === 'ref' ? new Range([v]) : v; // a single cell counts as a 1-cell range
      });
      const out = fn(args);
      return typeof out === 'number' ? fin(out) : out;
    }
  }

  return {
    Sheet,
    FormulaError,
    MAX_COLS,
    MAX_ROWS,
    colName,
    colIndex,
    parseRef,
    refName,
    parse,
  };
});
