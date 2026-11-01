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
- Bold, italic, fill color. Name box (type `C5` to jump). Formula bar.
- Save (`.json`, keeps formulas and formatting), Open (`.json` or `.csv`), Export CSV.
- Grid size: columns A to Z, rows 1 to 200 (change `MAX_COLS` / `MAX_ROWS` in `src/engine.js`).

## Where things live

| File | Job |
|---|---|
| `main.js` | Opens the desktop window (Electron) |
| `index.html`, `style.css` | The page layout and look |
| `src/grid.js` | The screen: grid, keyboard, mouse, toolbar, files |
| `src/engine.js` | The brain: reads formulas and works out answers (no screen code) |
| `src/csv.js` | Reads and writes CSV text |
| `tests/engine.test.js` | Checks the engine: "this input should give that answer" |

## Ideas for what to build next

1. Select many cells (drag the mouse, `Shift` + arrows) and show Sum / Average in the bottom bar
2. Copy and paste (`Ctrl+C` / `Ctrl+V`)
3. Undo and redo (`Ctrl+Z` / `Ctrl+Y`)
4. Let long text spill into empty cells on its right
5. Resize columns by dragging the header edge
6. More functions: VLOOKUP, TODAY, TEXT, ...
7. Charts
