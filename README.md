# Mini Excel

A small Excel-style spreadsheet desktop app, built from scratch with Electron and plain JavaScript.

## Run it

```
npm install --save-dev electron     (first time only - downloads Electron)
npm start                           (opens the app window)
npm test                            (checks the formula engine)
```

Try **Open** and pick `examples/sales-demo.json` to see a finished sheet.

## What works now

- Click a cell and type. `Enter` saves and moves down, `Tab` moves right, `Esc` cancels.
- Arrow keys move, `F2` or double-click edits, `Delete` clears.
- Formulas start with `=`: `+ - * / ^ & %`, comparisons (`= <> < > <= >=`), cell ranges like `A1:B5`.
- Functions: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, PRODUCT, MEDIAN, ABS, SQRT, POWER, MOD, INT, ROUND,
  PI, IF, IFERROR, AND, OR, NOT, COUNTIF, SUMIF, CONCAT, CONCATENATE, LEN, UPPER, LOWER, TRIM, LEFT, RIGHT.
- Errors like Excel: `#DIV/0!`, `#NAME?`, `#VALUE!`, `#REF!`, `#NUM!`, `#CIRC!` (a cell that depends on itself).
- Select many cells: drag with the mouse, `Shift`+click, or `Shift`+arrow keys. Click a column letter or row
  number to select the whole column or row; click the corner box or press `Ctrl+A` for everything.
- The bottom-right shows Average, Count and Sum of the selected cells.
- Copy, cut and paste: `Ctrl+C`, `Ctrl+X`, `Ctrl+V` (or the Cut / Copy / Paste buttons). A dashed orange frame
  marks what you copied; `Esc` removes it.
  - A copied formula follows the move, like Excel: `=A1+B1` pasted one row down becomes `=A2+B2`.
    A `$` keeps that part fixed (`$A$1` never moves). A cut formula keeps its names exactly.
  - Bold, italic and fill color travel with the cells. One copied cell pasted onto a selected block fills it.
  - Text copied in other programs (Excel, Google Sheets, Notepad) can be pasted in, and the other way round.
- `Delete`, bold, italic and fill color apply to every selected cell.
- Bold, italic, fill color. Name box (type `C5` or a block like `A1:B3` to jump). Formula bar.
- Save (`.json`, keeps formulas and formatting), Open (`.json` or `.csv`), Export CSV.
- Grid size: columns A to Z, rows 1 to 200 (change `MAX_COLS` / `MAX_ROWS` in `src/engine.js`).

## Where things live

| File | Job |
|---|---|
| `main.js` | Opens the desktop window (Electron) |
| `index.html`, `style.css` | The page layout and look |
| `src/grid.js` | The screen: grid, keyboard, mouse, toolbar, files |
| `src/engine.js` | The brain: reads formulas and works out answers (no screen code) |
| `src/csv.js` | Reads and writes CSV text (and tab-separated text for the clipboard) |
| `tests/engine.test.js` | Checks the engine: "this input should give that answer" |

## Ideas for what to build next

1. Undo and redo (`Ctrl+Z` / `Ctrl+Y`). Paste overwrites cells, so this is the most useful next step
2. Let long text spill into empty cells on its right
3. Resize columns by dragging the header edge
4. More functions: VLOOKUP, TODAY, TEXT, ...
5. Charts
