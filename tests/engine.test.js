// Tests for the formula engine. Run with:  npm test
// Each line says: "if the cells contain THIS, cell X should show THAT".
const assert = require('assert');
const { Sheet, parseRef, colName, MAX_ROWS } = require('../src/engine.js');
const { parseCSV, toCSV } = require('../src/csv.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.log('FAIL: ' + name + '\n      ' + e.message.split('\n')[0]);
  }
}

// Build a sheet from { A1: "5", B1: "=A1*2" } and return a function to read cells.
function make(cells) {
  const s = new Sheet();
  for (const [ref, text] of Object.entries(cells || {})) {
    const p = parseRef(ref);
    s.setRaw(p.c, p.r, text);
  }
  const show = (ref) => {
    const p = parseRef(ref);
    return s.display(p.c, p.r);
  };
  show.sheet = s;
  return show;
}

// Shortcut: put one formula in Z1... (column Z) and read what it shows.
function calc(formula, cells) {
  const show = make(Object.assign({ Z1: formula }, cells));
  return show('Z1');
}

// ---------- names ----------
test('column names', () => {
  assert.strictEqual(colName(0), 'A');
  assert.strictEqual(colName(25), 'Z');
  assert.strictEqual(colName(26), 'AA');
  assert.deepStrictEqual(parseRef('B3'), { c: 1, r: 2 });
  assert.deepStrictEqual(parseRef('$C$10'), { c: 2, r: 9 });
  assert.strictEqual(parseRef('hello'), null);
});

// ---------- plain typing ----------
test('typed numbers and text', () => {
  const s = make({ A1: '42', A2: 'hello', A3: '3.50', A4: "'007", A5: '007', A6: 'true' });
  assert.strictEqual(s('A1'), '42');
  assert.strictEqual(s('A2'), 'hello');
  assert.strictEqual(s('A3'), '3.5');
  assert.strictEqual(s('A4'), '007');
  assert.strictEqual(s('A5'), '7');
  assert.strictEqual(s('A6'), 'TRUE');
  assert.strictEqual(s('B9'), '');
});

// ---------- arithmetic ----------
test('arithmetic and priority', () => {
  assert.strictEqual(calc('=1+2*3'), '7');
  assert.strictEqual(calc('=(1+2)*3'), '9');
  assert.strictEqual(calc('=10/4'), '2.5');
  assert.strictEqual(calc('=2^3'), '8');
  assert.strictEqual(calc('=2^3^2'), '64'); // Excel works left to right: (2^3)^2
  assert.strictEqual(calc('=-2^2'), '4'); // Excel quirk: the minus binds first
  assert.strictEqual(calc('=2^-1'), '0.5');
  assert.strictEqual(calc('=50%'), '0.5');
  assert.strictEqual(calc('=10*50%'), '5');
  assert.strictEqual(calc('=0.1+0.2'), '0.3');
  assert.strictEqual(calc('=  1 +   2 '), '3');
  assert.strictEqual(calc('=1E3+1'), '1001');
});

test('text and comparisons', () => {
  assert.strictEqual(calc('="abc"&"def"'), 'abcdef');
  assert.strictEqual(calc('="a"&1+1'), 'a2');
  assert.strictEqual(calc('="say ""hi"""'), 'say "hi"');
  assert.strictEqual(calc('=1<2'), 'TRUE');
  assert.strictEqual(calc('=2<=1'), 'FALSE');
  assert.strictEqual(calc('=1<>2'), 'TRUE');
  assert.strictEqual(calc('="a"="A"'), 'TRUE');
  assert.strictEqual(calc('="5"+1'), '6');
});

// ---------- cell references ----------
test('formulas follow the cells they use', () => {
  const s = make({ A1: '5', B1: '7', C1: '=A1+B1' });
  assert.strictEqual(s('C1'), '12');
  s.sheet.setRaw(0, 0, '10');
  assert.strictEqual(s('C1'), '17');
  s.sheet.setRaw(0, 0, '');
  assert.strictEqual(s('C1'), '7');
});

test('empty cells count as 0, text cells in arithmetic fail', () => {
  assert.strictEqual(calc('=A5'), '0');
  assert.strictEqual(calc('=A5+1'), '1');
  assert.strictEqual(calc('=A1+1', { A1: 'abc' }), '#VALUE!');
  assert.strictEqual(calc('=A1&"!"', { A1: 'hello' }), 'hello!');
  assert.strictEqual(calc('=a1+b1', { A1: '1', B1: '2' }), '3');
  assert.strictEqual(calc('=$A$1+1', { A1: '1' }), '2');
});

test('a long chain of cells', () => {
  const cells = { A1: '1' };
  for (let r = 2; r <= 150; r++) cells['A' + r] = '=A' + (r - 1) + '+1';
  assert.strictEqual(make(cells)('A150'), '150');
});

// ---------- functions ----------
test('SUM AVERAGE MIN MAX COUNT COUNTA', () => {
  const c = { A1: '1', A2: '2', A3: 'x', A4: '6', B1: '' };
  assert.strictEqual(calc('=SUM(A1:A4)', c), '9');
  assert.strictEqual(calc('=sum(a1:a4)', c), '9');
  assert.strictEqual(calc('=SUM(A1,A2,10)', c), '13');
  assert.strictEqual(calc('=SUM(A3)', c), '0'); // text inside a reference is ignored
  assert.strictEqual(calc('=SUM("x")', c), '#VALUE!'); // but typed directly it is an error
  assert.strictEqual(calc('=AVERAGE(A1:A4)', c), '3');
  assert.strictEqual(calc('=MIN(A1:A4)', c), '1');
  assert.strictEqual(calc('=MAX(A1:A4)', c), '6');
  assert.strictEqual(calc('=COUNT(A1:A4)', c), '3');
  assert.strictEqual(calc('=COUNTA(A1:A4)', c), '4');
  assert.strictEqual(calc('=AVERAGE(B1:B2)', c), '#DIV/0!');
  assert.strictEqual(calc('=PRODUCT(A1:A2,4)', c), '8');
  assert.strictEqual(calc('=MEDIAN(1,3,2)'), '2');
  assert.strictEqual(calc('=MEDIAN(1,2,3,4)'), '2.5');
  assert.strictEqual(calc('=SUM(B1:A1)', { A1: '1', B1: '2' }), '3'); // reversed range
});

test('IF, IFERROR, AND, OR, NOT', () => {
  assert.strictEqual(calc('=IF(A1>3,"big","small")', { A1: '5' }), 'big');
  assert.strictEqual(calc('=IF(A1>3,"big","small")', { A1: '1' }), 'small');
  assert.strictEqual(calc('=IF(FALSE,1)'), 'FALSE');
  assert.strictEqual(calc('=IF(TRUE,1,1/0)'), '1'); // the unused branch is never calculated
  assert.strictEqual(calc('=IF(B1=0,0,A1/B1)', { A1: '8', B1: '0' }), '0');
  assert.strictEqual(calc('=IFERROR(1/0,"oops")'), 'oops');
  assert.strictEqual(calc('=IFERROR(4/2,"oops")'), '2');
  assert.strictEqual(calc('=AND(1<2,2<3)'), 'TRUE');
  assert.strictEqual(calc('=AND(1<2,3<2)'), 'FALSE');
  assert.strictEqual(calc('=OR(1>2,2<3)'), 'TRUE');
  assert.strictEqual(calc('=NOT(1>2)'), 'TRUE');
  assert.strictEqual(calc('=IF(AND(A1>=50,A2>=50),"pass","fail")', { A1: '60', A2: '40' }), 'fail');
});

test('maths functions', () => {
  assert.strictEqual(calc('=ABS(-5)'), '5');
  assert.strictEqual(calc('=SQRT(16)'), '4');
  assert.strictEqual(calc('=SQRT(-1)'), '#NUM!');
  assert.strictEqual(calc('=POWER(2,10)'), '1024');
  assert.strictEqual(calc('=MOD(10,3)'), '1');
  assert.strictEqual(calc('=MOD(-1,3)'), '2');
  assert.strictEqual(calc('=MOD(1,0)'), '#DIV/0!');
  assert.strictEqual(calc('=INT(-1.5)'), '-2');
  assert.strictEqual(calc('=ROUND(2.675,2)'), '2.68');
  assert.strictEqual(calc('=ROUND(-2.5)'), '-3');
  assert.strictEqual(calc('=ROUND(1234,-2)'), '1200');
  assert.strictEqual(calc('=ROUND(3.14159,3)'), '3.142');
  assert.strictEqual(calc('=PI()'), '3.14159265359');
});

test('text functions', () => {
  assert.strictEqual(calc('=LEN("hello")'), '5');
  assert.strictEqual(calc('=UPPER("abc")'), 'ABC');
  assert.strictEqual(calc('=LOWER("ABC")'), 'abc');
  assert.strictEqual(calc('=TRIM("  a   b  ")'), 'a b');
  assert.strictEqual(calc('=LEFT("spreadsheet",6)'), 'spread');
  assert.strictEqual(calc('=RIGHT("spreadsheet",5)'), 'sheet');
  assert.strictEqual(calc('=LEFT("abc")'), 'a');
  assert.strictEqual(calc('=RIGHT("abc",10)'), 'abc');
  assert.strictEqual(calc('=CONCAT("a",1,TRUE)'), 'a1TRUE');
  assert.strictEqual(calc('=CONCATENATE(A1:A2)', { A1: 'x', A2: 'y' }), 'xy');
});

test('COUNTIF and SUMIF', () => {
  const c = { A1: '3', A2: '8', A3: '12', A4: 'apple', B1: '10', B2: '20', B3: '30', B4: '40' };
  assert.strictEqual(calc('=COUNTIF(A1:A4,">5")', c), '2');
  assert.strictEqual(calc('=COUNTIF(A1:A4,"<=8")', c), '2');
  assert.strictEqual(calc('=COUNTIF(A1:A4,8)', c), '1');
  assert.strictEqual(calc('=COUNTIF(A1:A4,"APPLE")', c), '1');
  assert.strictEqual(calc('=COUNTIF(A1:A4,"<>apple")', c), '3');
  assert.strictEqual(calc('=SUMIF(A1:A3,">5")', c), '20');
  assert.strictEqual(calc('=SUMIF(A1:A4,">5",B1:B4)', c), '50');
});

// ---------- errors ----------
test('errors', () => {
  assert.strictEqual(calc('=1/0'), '#DIV/0!');
  assert.strictEqual(calc('=FOO(1)'), '#NAME?');
  assert.strictEqual(calc('=foo'), '#NAME?');
  assert.strictEqual(calc('=ZZ1'), '#REF!');
  assert.strictEqual(calc('=A' + (MAX_ROWS + 1)), '#REF!');
  assert.strictEqual(calc('=A0'), '#REF!');
  assert.strictEqual(calc('="abc"+1'), '#VALUE!');
  assert.strictEqual(calc('=1+'), '#ERROR!');
  assert.strictEqual(calc('=(1+2'), '#ERROR!');
  assert.strictEqual(calc('=1+2)'), '#ERROR!');
  assert.strictEqual(calc('="abc'), '#ERROR!');
  assert.strictEqual(calc('=SUM()'), '#ERROR!');
  assert.strictEqual(calc('=10^999'), '#NUM!');
  assert.strictEqual(calc('=A1:A2+1', { A1: '1', A2: '2' }), '#VALUE!');
  assert.strictEqual(calc('=3', {}), '3');
  assert.strictEqual(calc('='), '='); // just an equals sign is plain text
});

test('errors travel along', () => {
  const s = make({ A1: '=1/0', B1: '=SUM(A1:A2)', C1: '=B1+1' });
  assert.strictEqual(s('B1'), '#DIV/0!');
  assert.strictEqual(s('C1'), '#DIV/0!');
});

test('circular references', () => {
  const s = make({ A1: '=B1', B1: '=A1', C1: '=C1+1', D1: '=A1+1', E1: '=IFERROR(A1,"ok")' });
  assert.strictEqual(s('A1'), '#CIRC!');
  assert.strictEqual(s('B1'), '#CIRC!');
  assert.strictEqual(s('C1'), '#CIRC!');
  assert.strictEqual(s('D1'), '#CIRC!');
  assert.strictEqual(s('E1'), 'ok');
  // fixing the loop fixes the answers
  s.sheet.setRaw(1, 0, '5');
  assert.strictEqual(s('A1'), '5');
  assert.strictEqual(s('D1'), '6');
});

// ---------- CSV ----------
test('CSV round trip', () => {
  const rows = [['name', 'note'], ['Ann', 'likes "quotes", commas'], ['Bob', 'two\nlines']];
  assert.deepStrictEqual(parseCSV(toCSV(rows)), rows);
  assert.deepStrictEqual(parseCSV('a,b\r\n1,2\r\n'), [['a', 'b'], ['1', '2']]);
  assert.deepStrictEqual(parseCSV('a,,c\n'), [['a', '', 'c']]);
  assert.deepStrictEqual(parseCSV('﻿x,y'), [['x', 'y']]);
  assert.deepStrictEqual(parseCSV(''), []);
});

console.log('\n' + passed + ' test groups passed, ' + failed + ' failed');
if (failed) process.exit(1);
