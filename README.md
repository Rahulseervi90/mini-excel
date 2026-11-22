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
- 58 functions:
  - maths: SUM, AVERAGE, MIN, MAX, COUNT, COUNTA, COUNTBLANK, PRODUCT, MEDIAN, LARGE, SMALL, ABS, SQRT, POWER, MOD,
    INT, ROUND, ROUNDUP, ROUNDDOWN, EXP, LN, LOG, LOG10, SIGN, PI
  - logic and checks: IF, IFERROR, AND, OR, NOT, ISNUMBER, ISTEXT, ISBLANK
  - counting with a condition: COUNTIF, SUMIF, AVERAGEIF
  - text: CONCAT, CONCATENATE, LEN, UPPER, LOWER, TRIM, LEFT, RIGHT, MID, FIND, SEARCH, SUBSTITUTE, REPT
  - lookup: VLOOKUP, HLOOKUP, INDEX, MATCH
  - dates (they are numbers, like Excel): TODAY, NOW, DATE, YEAR, MONTH, DAY, WEEKDAY. Pick the Date format to see them as dates
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
- Undo and redo: `Ctrl+Z`, `Ctrl+Y` (or the buttons). Up to 100 steps.
- Fill down `Ctrl+D` and fill right `Ctrl+R`: copy the top row (or left column) of the selection over the rest.
  Formulas follow, like copy and paste.
- Drag the right edge of a column letter to resize it. Double-click that edge to fit the column to its text.
- Insert or delete rows and columns (`+ Row`, `- Row`, `+ Col`, `- Col`). Select as many as you want to add or remove.
  Every formula follows: `=SUM(A1:A5)` grows when a row is inserted inside it. A formula that pointed at a deleted
  cell shows `#REF!` (and `ZZ0` in the formula bar). `Ctrl+Z` undoes it.
- Sort (`Sort A-Z`, `Sort Z-A`): by the column of the selected cell. Select a block, or click one cell inside your
  table and it finds the table. Tick **Header row** to keep the titles on top. Formulas stay with their row.
- Filter: type text (`ap`) or a number test (`>5`, `<=10`, `=3`, `<>0`) and press **Filter**. Rows that do not match
  are hidden, in the column of the selected cell. **Show all** brings them back.
- Number formats (the box in the toolbar): General, Number `1,234.50`, Rupees `₹1,234.50`, Percent, Date, Date and time.
  The number in the cell does not change, only how it looks. Copy, paste, save and open keep the format.
- Charts: select cells (for example `A1:C6` with titles on top and names on the left) and press **Chart**. Column,
  line or pie. **Save picture** downloads a PNG. Charts are not stored in the sheet, press Chart again to redraw.
- Auto-save: the sheet is saved in the browser/app as you work and comes back next time you open it.
- `Delete`, bold, italic and fill color apply to every selected cell.
- Bold, italic, fill color. Name box (type `C5` or a block like `A1:B3` to jump). Formula bar.
- Save (`.json`, keeps formulas, formatting and column widths), Open (`.json` or `.csv`), Export CSV.
- Grid size: columns A to Z, rows 1 to 200 (change `MAX_COLS` / `MAX_ROWS` in `src/engine.js`).

## Use it on a phone and a computer (the website version)

The same files also work as a website, and as an app you can install. Put it online once with GitHub Pages:

1. On github.com open your `mini-excel` repo, then **Settings** > **Pages**.
2. Under **Build and deployment**, set **Source** to **Deploy from a branch**, **Branch** to `main`, folder `/ (root)`, press **Save**.
3. Wait 1 to 2 minutes. The page shows your address: `https://YOUR-NAME.github.io/mini-excel/`.
4. Open that address on your phone or computer.
   - Android / Chrome / Edge: press the **Install app** button in the green bar (or the browser menu > Install).
   - iPhone: Safari > Share button > **Add to Home Screen**.
5. After you change the code: `git add .`, `git commit`, `git push`. Then in `sw.js` change `mini-excel-v6` to
   `mini-excel-v7` (a new number each time) so phones fetch the new files.

On a phone: tap a cell to select it, tap it twice quickly to type (or tap the formula bar). Slide the toolbar sideways.
Your sheet is stored on each device separately. Use **Save** to move a sheet between devices.

## Where things live

| File | Job |
|---|---|
| `main.js` | Opens the desktop window (Electron) |
| `index.html`, `style.css` | The page layout and look |
| `src/grid.js` | The screen: grid, keyboard, mouse, toolbar, files |
| `src/engine.js` | The brain: reads formulas and works out answers (no screen code) |
| `src/chart.js` | Turns cells into chart pictures (column, line, pie) |
| `src/csv.js` | Reads and writes CSV text (and tab-separated text for the clipboard) |
| `src/pwa.js`, `sw.js`, `manifest.webmanifest`, `icons/` | Install-as-app and offline support for the website version |
| `tests/engine.test.js` | Checks the engine: "this input should give that answer" |

## Ideas for what to build next

1. Typing a date like `22/11/2026` straight into a cell
2. Resize columns, select ranges and drag-fill by touch on a phone
3. Keep charts inside the sheet (they are drawn fresh each time now)
4. Conditional formatting (turn cells red when they are above a number)
5. Freeze the top row, find and replace, more functions: TEXT, SUMPRODUCT, IFS
