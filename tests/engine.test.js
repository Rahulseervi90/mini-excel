// Tests for the formula engine. Run with:  npm test
// Each line says: "if the cells contain THIS, cell X should show THAT".
const assert = require('assert');
const { Sheet, parseRef, colName, MAX_ROWS, shiftFormula } = require('../src/engine.js');
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

// ---------- copy and paste ----------
test('copy-paste: formulas shift like Excel', () => {
  assert.strictEqual(shiftFormula('=A1+B1', 0, 1), '=A2+B2');
  assert.strictEqual(shiftFormula('=A1+B1', 2, 0), '=C1+D1');
  assert.strictEqual(shiftFormula('=A1+B1', 2, 3), '=C4+D4');
  assert.strictEqual(shiftFormula('=$A$1+A1', 1, 1), '=$A$1+B2'); // $A$1 never moves
  assert.strictEqual(shiftFormula('=$A1+A$1', 1, 1), '=$A2+B$1'); // $ fixes just that part
  assert.strictEqual(shiftFormula('=SUM(A1:A3)', 0, 1), '=SUM(A2:A4)');
  assert.strictEqual(shiftFormula('=SUM(A1:B2)', 1, 1), '=SUM(B2:C3)');
  assert.strictEqual(shiftFormula('="A1"&A1', 0, 1), '="A1"&A2'); // text in quotes is left alone
  assert.strictEqual(shiftFormula('="say ""A1"""&A1', 0, 1), '="say ""A1"""&A2');
  assert.strictEqual(shiftFormula('=a1+1', 0, 1), '=A2+1');
  assert.strictEqual(shiftFormula('=1E3+A1', 0, 1), '=1E3+A2'); // 1E3 is a number, not a cell
  assert.strictEqual(shiftFormula('=ATAN2(A1)', 0, 1), '=ATAN2(A2)'); // a name with digits before ( is a function
  assert.strictEqual(shiftFormula('=IF(A1>5,"big","small")', 0, 1), '=IF(A2>5,"big","small")');
  assert.strictEqual(shiftFormula('=B2+C3', -1, -1), '=A1+B2');
});

test('copy-paste: things that must not change', () => {
  assert.strictEqual(shiftFormula('A1', 0, 1), 'A1'); // plain text
  assert.strictEqual(shiftFormula('hello', 3, 3), 'hello');
  assert.strictEqual(shiftFormula('=', 0, 1), '=');
  assert.strictEqual(shiftFormula('=A1+B1', 0, 0), '=A1+B1'); // no movement
  assert.strictEqual(shiftFormula('', 1, 1), '');
  assert.strictEqual(shiftFormula(undefined, 1, 1), undefined);
});

test('copy-paste: moved formulas give the right numbers', () => {
  // C1 holds =A1+B1. Copy it to C2 and it must add A2 and B2.
  const show = make({ A1: '1', B1: '2', A2: '10', B2: '20', C1: '=A1+B1', C2: shiftFormula('=A1+B1', 0, 1) });
  assert.strictEqual(show('C1'), '3');
  assert.strictEqual(show('C2'), '30');
  // a total that points at a fixed cell
  const s2 = make({ A1: '5', B1: '=A1*$D$1', B2: shiftFormula('=A1*$D$1', 0, 1), A2: '7', D1: '2' });
  assert.strictEqual(s2('B1'), '10');
  assert.strictEqual(s2('B2'), '14');
});

test('copy-paste: falling off the sheet gives #REF!', () => {
  assert.strictEqual(calc(shiftFormula('=A1+1', -1, 0)), '#REF!'); // left of column A
  assert.strictEqual(calc(shiftFormula('=A2+1', 0, -2)), '#REF!'); // above row 1
  assert.strictEqual(calc(shiftFormula('=Z1+1', 1, 0)), '#REF!'); // right of column Z
  assert.strictEqual(shiftFormula('=Z1', 1, 0), '=AA1');
  assert.strictEqual(calc(shiftFormula('=SUM(A1:A2)', -1, 0)), '#REF!');
});

test('CSV with tabs (used for the clipboard)', () => {
  assert.strictEqual(toCSV([['a', 'b c'], ['1', '2']], '\t'), 'a\tb c\r\n1\t2');
  assert.strictEqual(toCSV([['x\ty', 'z']], '\t'), '"x\ty"\tz');
  assert.strictEqual(toCSV([['a,b', '1']], '\t'), 'a,b\t1'); // commas are plain text here
  const rows = [['a', 'b c'], ['x\ty', 'say "hi"'], ['two\nlines', '3']];
  assert.deepStrictEqual(parseCSV(toCSV(rows, '\t'), '\t'), rows);
  assert.deepStrictEqual(parseCSV('1\t2\n3\t4', '\t'), [['1', '2'], ['3', '4']]);
  assert.deepStrictEqual(parseCSV('1\t2\r\n3\t4\r\n', '\t'), [['1', '2'], ['3', '4']]);
  assert.deepStrictEqual(parseCSV('a,b\t1', '\t'), [['a,b', '1']]);
  assert.deepStrictEqual(parseCSV('a,b'), [['a', 'b']]); // the default is still a comma
});

// ---------- update 3: more functions ----------
const TABLE = { A1: 'apple', B1: '10', C1: '1.5', A2: 'banana', B2: '20', C2: '0.5', A3: 'cherry', B3: '30', C3: '2' };

test('lookup: VLOOKUP exact and approximate', () => {
  assert.strictEqual(calc('=VLOOKUP("banana",A1:C3,2,FALSE)', TABLE), '20');
  assert.strictEqual(calc('=VLOOKUP("CHERRY",A1:C3,3,FALSE)', TABLE), '2'); // not case sensitive
  assert.strictEqual(calc('=VLOOKUP("zzz",A1:C3,2,FALSE)', TABLE), '#N/A');
  assert.strictEqual(calc('=VLOOKUP("banana",A1:C3,4,FALSE)', TABLE), '#REF!');
  assert.strictEqual(calc('=VLOOKUP(25,B1:C3,2)', TABLE), '0.5'); // approximate: the last one that is <= 25 (20)
  assert.strictEqual(calc('=VLOOKUP(5,B1:C3,2)', TABLE), '#N/A'); // smaller than everything
  assert.strictEqual(calc('=IFERROR(VLOOKUP("zzz",A1:C3,2,FALSE),"none")', TABLE), 'none');
});

test('lookup: HLOOKUP, INDEX, MATCH', () => {
  const row = { A1: 'x', B1: 'y', C1: 'z', A2: '1', B2: '2', C2: '3' };
  assert.strictEqual(calc('=HLOOKUP("y",A1:C2,2,FALSE)', row), '2');
  assert.strictEqual(calc('=HLOOKUP("q",A1:C2,2,FALSE)', row), '#N/A');
  assert.strictEqual(calc('=HLOOKUP("y",A1:C2,3,FALSE)', row), '#REF!');
  assert.strictEqual(calc('=INDEX(A1:C3,2,2)', TABLE), '20');
  assert.strictEqual(calc('=INDEX(A1:C3,3,1)', TABLE), 'cherry');
  assert.strictEqual(calc('=INDEX(A1:C1,2)', TABLE), '10'); // one row: the second cell
  assert.strictEqual(calc('=INDEX(A1:C3,4,1)', TABLE), '#REF!');
  assert.strictEqual(calc('=MATCH("cherry",A1:A3,0)', TABLE), '3');
  assert.strictEqual(calc('=MATCH("nope",A1:A3,0)', TABLE), '#N/A');
  assert.strictEqual(calc('=MATCH(25,B1:B3,1)', TABLE), '2');
  assert.strictEqual(calc('=INDEX(A1:A3,MATCH(20,B1:B3,0))', TABLE), 'banana'); // the two work together
});

test('maths: ROUNDUP, ROUNDDOWN, EXP, LN, LOG, SIGN', () => {
  assert.strictEqual(calc('=ROUNDUP(1.21,1)'), '1.3');
  assert.strictEqual(calc('=ROUNDUP(-1.21,1)'), '-1.3');
  assert.strictEqual(calc('=ROUNDDOWN(1.29,1)'), '1.2');
  assert.strictEqual(calc('=ROUNDDOWN(-1.29,1)'), '-1.2');
  assert.strictEqual(calc('=ROUNDUP(1234,-2)'), '1300');
  assert.strictEqual(calc('=ROUNDDOWN(1299,-2)'), '1200');
  assert.strictEqual(calc('=ROUNDUP(5)'), '5');
  assert.strictEqual(calc('=EXP(0)'), '1');
  assert.strictEqual(calc('=LN(1)'), '0');
  assert.strictEqual(calc('=LN(0)'), '#NUM!');
  assert.strictEqual(calc('=LOG10(1000)'), '3');
  assert.strictEqual(calc('=LOG(8,2)'), '3');
  assert.strictEqual(calc('=LOG(100)'), '2');
  assert.strictEqual(calc('=LOG(-1)'), '#NUM!');
  assert.strictEqual(calc('=SIGN(-7)'), '-1');
  assert.strictEqual(calc('=SIGN(0)'), '0');
});

test('statistics: LARGE, SMALL, COUNTBLANK, AVERAGEIF', () => {
  assert.strictEqual(calc('=LARGE(B1:B3,1)', TABLE), '30');
  assert.strictEqual(calc('=LARGE(B1:B3,2)', TABLE), '20');
  assert.strictEqual(calc('=SMALL(B1:B3,1)', TABLE), '10');
  assert.strictEqual(calc('=LARGE(B1:B3,4)', TABLE), '#NUM!');
  assert.strictEqual(calc('=SMALL(B1:B3,0)', TABLE), '#NUM!');
  assert.strictEqual(calc('=COUNTBLANK(D1:D5)', TABLE), '5');
  assert.strictEqual(calc('=COUNTBLANK(A1:A5)', TABLE), '2');
  assert.strictEqual(calc('=AVERAGEIF(B1:B3,">10")', TABLE), '25');
  assert.strictEqual(calc('=AVERAGEIF(A1:A3,"banana",B1:B3)', TABLE), '20');
  assert.strictEqual(calc('=AVERAGEIF(B1:B3,">100")', TABLE), '#DIV/0!');
});

test('text: MID, FIND, SEARCH, SUBSTITUTE, REPT', () => {
  assert.strictEqual(calc('=MID("Hello world",7,5)'), 'world');
  assert.strictEqual(calc('=MID("abc",2,100)'), 'bc');
  assert.strictEqual(calc('=MID("abc",0,1)'), '#VALUE!');
  assert.strictEqual(calc('=FIND("o","Hello world")'), '5');
  assert.strictEqual(calc('=FIND("o","Hello world",6)'), '8');
  assert.strictEqual(calc('=FIND("O","Hello world")'), '#VALUE!'); // FIND cares about capitals
  assert.strictEqual(calc('=SEARCH("O","Hello world")'), '5'); // SEARCH does not
  assert.strictEqual(calc('=SUBSTITUTE("a-b-c","-","+")'), 'a+b+c');
  assert.strictEqual(calc('=SUBSTITUTE("abc","","x")'), 'abc');
  assert.strictEqual(calc('=REPT("ab",3)'), 'ababab');
  assert.strictEqual(calc('=REPT("x",-1)'), '#VALUE!');
  assert.strictEqual(calc('=LEN(REPT("x",50))'), '50');
});

test('checks: ISNUMBER, ISTEXT, ISBLANK', () => {
  const c = { A1: '5', A2: 'hi' };
  assert.strictEqual(calc('=ISNUMBER(A1)', c), 'TRUE');
  assert.strictEqual(calc('=ISNUMBER(A2)', c), 'FALSE');
  assert.strictEqual(calc('=ISTEXT(A2)', c), 'TRUE');
  assert.strictEqual(calc('=ISTEXT(A1)', c), 'FALSE');
  assert.strictEqual(calc('=ISBLANK(A3)', c), 'TRUE');
  assert.strictEqual(calc('=ISBLANK(A1)', c), 'FALSE');
  assert.strictEqual(calc('=IF(ISBLANK(A3),"empty","full")', c), 'empty');
});

test('dates: TODAY and NOW look like dates', () => {
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(calc('=TODAY()')), calc('=TODAY()'));
  assert.ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(calc('=NOW()')), calc('=NOW()'));
  assert.strictEqual(calc('=LEN(TODAY())'), '10');
  assert.strictEqual(calc('=TODAY(1)'), '#ERROR!');
});

test('old functions still work with ranges that now know their width', () => {
  assert.strictEqual(calc('=SUM(A1:C3)', { A1: '1', B2: '2', C3: '3' }), '6');
  assert.strictEqual(calc('=COUNTIF(A1:B2,">0")', { A1: '1', B2: '2' }), '2');
  assert.strictEqual(calc('=SUMIF(A1:A3,">1",B1:B3)', { A1: '1', A2: '2', A3: '3', B1: '10', B2: '20', B3: '30' }), '50');
});

console.log('\n' + passed + ' test groups passed, ' + failed + ' failed');
if (failed) process.exit(1);
