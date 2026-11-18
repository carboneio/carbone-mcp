# Carbone XLSX/ODS: Spreadsheet Tips

Read this file when the user asks where to write tags in an Excel sheet (cells mixing text and tags, the `[i]`/`[i+1]` loop rows, sorted, filtered, nested and horizontal loops, `:drop(row)` placement, where to put an `{o.}` option), Excel formulas or totals below a loop, formulas, merged cells, conditional formatting, data validation, tables, charts, pivot tables or hyperlinks that must follow the rows Carbone adds (XLSX pre-release `5018000`), merging identical cells of a column with `:mergeCell`, why a cell's percentage/currency/accounting/date format is not applied (native number vs text), referencing injected rows with `INDIRECT`/`MATCH`/`INDEX`, frozen panes, pictures, barcodes, headers/footers, page setup for PDF or sheet names in XLSX, line breaks inside a cell, or generating one sheet per array item.

---

## Where to write tags in a sheet

Tested layouts (v5.18.0). The loops read `{"products": [{"name": "Laptop", "category": "Hardware", "qty": 12, "price": 950, "amount": 11400, "status": "In stock"}, …]}` (10 products).

- **A cell is a native number only when it holds a single tag ending with `:formatN`** (next section). Any other cell is text and may mix text and tags: `Report generated on {d.date:formatD('MMMM D, YYYY')} by {d.manager}.` → `Report generated on October 5, 2026 by Jane Smith.`
- **Vertical loop**: the `[i]` row, then the `[i+1]` row. One `[i+1]` cell is enough, and the row is removed. Carbone copies the `[i]` row with its styles, height and number formats, and pushes the rows below down. The total row 6 becomes row 14:

| | A | B | C | E |
|---|---|---|---|---|
| **4** | `{d.products[i].name}` | `{d.products[i].category}` | `{d.products[i].qty:formatN}` | `{d.products[i].amount:formatN}` |
| **5** | `{d.products[i+1].name}` | | | |
| **6** | `Total` | | | `{d.total:formatN}` |

- **Sort and filter**: the sort goes in every `[i]` tag, the filter in the `[i+1]` tag only. `{d.products[price, i].name}` in row 4, `{d.products[price+1, i+1, category!='Services'].name}` in row 5 → the products by ascending price, without the services.
- **Nested loops** take four rows: outer `[i]`, inner `[i]`, inner `[i+1]`, outer `[i+1]`. A subtotal on the outer row aggregates the inner array (`formatters.md` "Aggregator Formatters"):
```
row 4   A {d.categories[i].name}                C {d.categories[i].products[].amount:aggSum:formatN}
row 5   A {d.categories[i].products[i].name}    B {d.categories[i].products[i].qty:formatN}   C {d.categories[i].products[i].amount:formatN}
row 6   A {d.categories[i].products[i+1].name}
row 7   A {d.categories[i+1].name}
```
→ `Hardware` with `20460` in C, its 4 products, then `Software` with `591`, its 3 products…
- **Horizontal loop** (one column per item): static labels in column A, the `[i]` tags in B, and a bare `{d.months[i+1]}` in C on **every** row of the loop. `B3 {d.months[i].name}` `C3 {d.months[i+1]}` / `B4 {d.months[i].orders:formatN}` `C4 {d.months[i+1]}` → columns B, C, D for July, August, September, each with the number format of column B. Rules → `loops-advanced.md` "Horizontal loop".
- **Conditions**: `{d.products[i].qty:ifLT(5):show('Reorder'):elseShow('OK')}` prints text. Append a `:drop(row)` tag to a text cell of the `[i]` row: `{d.products[i].name}{d.products[i].qty:ifEQ(0):drop(row)}` removes the products out of stock and leaves no gap. Keep it out of a `:formatN` cell, which must hold a single tag. XLSX supports `:drop(row)` and `:drop(col)` only.
- **`{o.}` options**: put them in a spare cell, such as A2 between the title and the table header. Carbone empties the cell and keeps its row.

---

## Number formats only apply to numeric cells

In XLSX/ODS, the cell's Excel number format (percentage, currency, accounting, thousands, date) is applied by the spreadsheet, but **only to native numeric cells**. If Carbone writes the value as text, the format is silently ignored and the raw value is shown verbatim.

A value reaches the cell as text when the JSON field is a string (`"0.032"`), or when `{o.exportFormattedValuesAsText=true}` is set. In XLSX/ODS templates, `:formatN` is the **only** way to force Carbone to write a native number into the cell. Arithmetic formatters like `:mul(1)` or `:add(0)` do not change the output type. The cell must contain **a single tag ending with `:formatN`**: `{d.amount:formatN}`, `{d.amount:cumSum:formatN}`.

`:formatC`, `:formatD` and the accounting option `:formatN(2, acc)` always write **text**, formatted for the report's `lang`: fine for display, but Excel cannot sum, sort or chart them. For a value that must stay a number, use `:formatN` and put the display in the cell's number format. Tested with `lang:"en-us"` and the data `{"amount": 1234.5, "balance": -1234.5, "rate": 0.125, "date": "2026-11-10"}`:
```
{d.rate:formatN}                    ← cell format 0.0%                        → 12.5%
{d.amount:formatN}                  ← cell format $#,##0.00                   → $1,234.50     (number)
{d.balance:formatN}                 ← cell format $#,##0.00;[Red]($#,##0.00)  → ($1,234.50) in red (number)
{d.balance:formatN(2, acc)}         ← any cell format                         → (1,234.50)    (text)
{d.amount:formatC}                  ← any cell format                         → $1,234.50     (text)
{d.date:formatD('MMMM D, YYYY')}    ← any cell format                         → November 10, 2026 (text)
```
For accounting parentheses on a value that must stay a number, use `:formatN` with the cell format `#,##0.00;(#,##0.00)` instead of `acc`. In ODS, `acc` is ignored and the cell stays a number.

**The `:formatN` precision argument is ignored in XLSX/ODS.** Because the cell's own number format controls decimal display, `:formatN`, `:formatN(0)`, and `:formatN(2)` all behave identically: Carbone writes the raw native number and lets Excel/Calc format it. If you need a specific number of decimals, set them on the cell format, not on the tag. (With `acc` the output is text, so the precision applies.)

Write identifiers and codes (EAN, SKU, phone numbers) **without** `:formatN`: `{d.ean}` with `"4006381333931"` stays the text `4006381333931`, every digit kept.

---

## Formulas that follow the loop rows: XLSX (v5.18.0+, pre-release)

Add `{o.preReleaseFeatureIn=5018000}` in any cell of the template (the tag is removed from the output). Carbone then updates the workbook the way Excel does when rows are inserted. Without the tag, and in ODS templates, formulas are not adjusted (see "Formulas without `5018000`, and in ODS" below).

Tested template (row 4 is the `[i]` row, row 5 the `[i+1]` row, the VAT rate is in `B9`):

| | A | B | C | D | E |
|---|---|---|---|---|---|
| **4** | `{d.products[i].name}` | `{d.products[i].qty:formatN}` | `{d.products[i].price:formatN}` | `=B4*C4` | `=D4*(1+$B$9)` |
| **5** | `{d.products[i+1].name}` | `{d.products[i+1].qty:formatN}` | `{d.products[i+1].price:formatN}` | `=B5*C5` | `=D5*(1+$B$9)` |
| **6** | `Total` | | | `=SUM(D4:D5)` | `=SUM(E4:E5)` |

With 10 products, the generated rows get `=B5*C5` … `=B13*C13`, the total becomes `=SUM(D4:D13)`, and the absolute reference `$B$9` follows its cell to `$B$17`. A running total `=SUM($D$4:D4)` in the `[i]` row becomes `=SUM($D$4:D13)` on the last row.

- **Draw ranges over the `[i]` row and the `[i+1]` row**: they grow to cover every generated row.
- **Keep Carbone tags and formulas in separate cells.** A formula that contains a Carbone tag, or uses `INDIRECT`, is not modified.
- In the template, formulas that read tag cells show `#VALUE!` (the tags are text): expected.
- Carbone writes the formulas without computing them: Excel recalculates when it opens the file, and they are computed when the report is converted (to PDF, for example).

**The rest of the workbook follows the rows too** (same tag). Tested with 10 products:

| Element | In the template | In the report |
|---|---|---|
| Conditional formatting | ranges `A4:F5`, `C4:C5`…, a formula rule that anchors the column (`$F4="Out of stock"`), a rule on the total `E6` | `A4:F13`, `C4:C13`; the total's rule moves to `E14` |
| Excel table `Sales` (Insert > Table) | `A3:F5`: static header row + `[i]` row + `[i+1]` row; `=SUM(Sales[Amount])` in `E8` | `A3:F13` with banded rows and filter buttons; the formula moves to `E16` |
| Native chart | categories `$A$4:$A$5`, values `$E$4:$E$5`, series name `$E$3`; chart placed at row 8 | `$A$4:$A$13`, `$E$4:$E$13`; chart moved to row 16 |
| Pivot table on another sheet | source `PivotData!A3:F5` (header + `[i]` + `[i+1]`, without the total row) | source `A3:F13` |
| Hyperlinks | a link on `A4`; `Go to total` in `A2` targets `A6`; a link on `A8` | the link on every row `A4:A13`; `Go to total` targets `A14`; `A8` moves to `A16` |

- **Conditional formatting**: cell rules, formula rules, color scales and data bars all extend. Color scales, data bars and number rules compare numbers: end those tags with `:formatN`.
- **Data validation and AutoFilters** on the `[i]` row extend to every row. A drop-down list whose source cells are below the loop follows them.
- **Charts** whose series use the loop cells show every generated row. To draw a chart image from the data instead, use `:chart` (`advanced-features.md`).
- **Pivot tables**: Excel refreshes them when it opens the file, so keep **Refresh data when opening the file** checked in the PivotTable options, as in the tested template. Until then, the file keeps the template's pivot values, and an application that does not refresh pivot tables on open shows those.
- **Hyperlinks**: a URL built from the data → `advanced-features.md` "Hyperlinks: edge cases" (in XLSX, write `d.url` without braces).
- **Named ranges, the print area, sparklines, and manual page breaks, pictures and comments below the loop** follow the rows.

---

## Merged cells in a loop: XLSX (v5.18.0+)

With `{o.preReleaseFeatureIn=5018000}` (or, without the tag, in any sheet that uses `:mergeCell`), a merged cell of the `[i]` row is copied to every generated row, and merged cells below the loop move down. It works with sorted loops, filters, `:drop(row)`, conditional blocks, nested loops and loops of several rows. A hidden row inside a vertically merged cell makes the merge extend to the next row.

### `:mergeCell`: merge identical values of a column

`:mergeCell` merges the consecutive cells of a column that have the same value: the value is printed once, in one cell merged vertically over its rows. No pre-release tag needed.
```
{d.products[i].category:mergeCell}               ← one merged cell per category
{d.products[i].status:mergeCell(.category)}      ← merges identical statuses only within the same category
{d.rows[i].city:mergeCell(.country, .region)}    ← several parents
```
Tested template (no pre-release tag): `A4:B4` and `A5:B5` merged for the product name, `C4` `{d.products[i].category:mergeCell}`, `C5` the plain `{d.products[i+1].category}`, the total merged over `A6:D6`. Report: `C4:C7` Hardware, `C8:C10` Software, `C11:C13` Services, the names merged `A4:B4` … `A13:B13`, the total over `A14:D14`.
- Write `:mergeCell` in the `[i]` row only. It must be the **last formatter** of the tag.
- It merges the rows as printed, so it works with sorted and filtered loops and `:drop(row)`. Only **adjacent** identical values merge: sort the loop when they are not already grouped in the data.
- A cell merged horizontally in the template (`C4:D4`) keeps its width and grows down, which is useful for the parent cells of a nested loop.
- A loop that repeats two rows per item is not merged: the rows must be consecutive.
- XLSX templates only. For merged cells in a DOCX/ODT table loop → `docx-tips.md`.

---

## Totals computed by Carbone: aggregators (ENTERPRISE)

Aggregators compute totals without Excel formulas, in XLSX and ODS, with or without `5018000`. They match the rows after sorting and filtering, and stay correct in PDF and CSV outputs. End with `:formatN` to write native numbers:
```
{d.products[i].amount:cumSum:formatN}               ← running total, in the [i] row: 11400, 17400, 19500…
{d.products[i].amount:aggSum(.category):formatN}    ← total of the row's category, in the [i] row: 20460 on each Hardware row
{d.products[].amount:aggSum:formatN}                ← grand total, below the loop: 21140
```
Full reference → `formatters.md` "Aggregator Formatters".

---

## Formulas without `5018000`, and in ODS

ODS templates, and XLSX templates without the pre-release tag: Carbone does not adjust formulas to the rows it adds. Use an aggregator (above), or write formulas that do not depend on the number of rows. These patterns keep working when `5018000` is added, since `INDIRECT` formulas are left as they are.

### Dynamic total using `INDIRECT` + `ROW`

Place this in the total cell below the loop. It sums everything in column B from row 4 up to the row just above:
```
=SUM(INDIRECT("B4:B" & ROW()-1))
```

For bi-directional tables, or when you want the formula to work in **any cell** in the sheet:
```
=SUM(INDIRECT(ADDRESS(1,COLUMN()) & ":" & ADDRESS(ROW()-1,COLUMN())))
```
Sums all numbers in the same column above the current cell, regardless of row or column position.

### Reference the total elsewhere using `MATCH`/`INDEX`

Add a static label next to the total cell (e.g. `TOTAL weeks` in column A), then reference it dynamically:
```
=INDEX(B:B, MATCH("TOTAL weeks", A:A, 0))
```
Finds the total row dynamically regardless of how many rows Carbone injected.

---

## XLSX layout: frozen panes, pictures, page setup, sheet names

- **Frozen panes** stay where they are, with or without `5018000`: freeze only rows above the loop.
- **Pictures and barcodes** (tag in the alt text of a temporary picture: `{d.logo}`, `{d.ean:barcode(ean13, scale:6)}`, `{d.url:barcode(qrcode, scale:6)}`) are stretched to the size of the temporary picture: give it the proportions of the real images (square for a QR code). Loops do not repeat pictures: a picture in the `[i]` row stays on the first row, and a picture tag that uses the loop (`{d.items[i].photo}`) stops the render with an error. Place pictures outside the loop.
- **Headers and footers** (Page Layout > Header & Footer) accept tags next to Excel's page-number fields: `{d.company}` prints on every page.
- **PDF output** prints each sheet with its own page setup (print area, orientation, scaling, headers and footers): set them per sheet in the template.
- **Sheet names** accept tags. Excel caps a sheet name at 31 characters; a longer value makes Excel report a problem when it opens the file.

---

## Line breaks inside a cell (v5.17.0+)

`:convCRLF` turns `\n` / `\r\n` in the data into real line breaks inside an XLSX cell. Enable **Wrap text** on the cell, otherwise the content stays on one line:
```
{d.address:convCRLF}
{d.names:arrayJoin('\n'):convCRLF}    ← one array item per line
```

---

## One sheet per array item (ODS only)

**ODS templates can generate sheets dynamically**: one tab per item of an array. Aliases are the only way to do it, and it does **not** work with XLSX templates: for an XLSX result, design an ODS template and convert the report to XLSX.

Declare two aliases in the content of the first sheet, one holding the loop tag and one holding its end-marker:
```
{#sheet1 = d.fruits[i].name}
{#sheet2 = d.fruits[i+1].name}
```

Then rename the **sheet tabs** in LibreOffice Calc. The first tab becomes `{$sheet1}`, the second `{$sheet2}`:

| Tab name | Role |
|---|---|
| `{$sheet1}` | The sheet that is repeated: its content and formatting are inherited by every generated sheet |
| `{$sheet2}` | End-marker tab, removed from the output |

At render time Carbone resolves the aliases back to the repetition markers and creates one sheet per array item, each named after the value (`apple`, `banana`, …) and carrying the first sheet's layout.

The cells of the first sheet address the current item through the same outer path (`{d.fruits[i].name}`), and a table inside the sheet is an ordinary nested loop (`{d.fruits[i].nutrients[i].qty}` closed by `{d.fruits[i].nutrients[i+1]}`, see SKILL.md §4b).
