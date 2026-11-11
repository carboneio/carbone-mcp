# Carbone XLSX/ODS — Spreadsheet Tips

Read this file when the user asks about Excel formulas or totals below a loop, formulas, merged cells, conditional formatting, tables, charts or pivot tables that must follow the rows Carbone adds (XLSX pre-release `5018000`), merging identical cells of a column with `:mergeCell`, why a cell's percentage/currency/accounting/date format is not applied (native number vs text), referencing injected rows with `INDIRECT`/`MATCH`/`INDEX`, frozen panes, pictures, headers/footers or sheet names in XLSX, line breaks inside a cell, or generating one sheet per array item.

---

## Number formats only apply to numeric cells

In XLSX/ODS, the cell's Excel number format (percentage, currency, accounting, thousands, date) is applied by the spreadsheet — but **only to native numeric cells**. If Carbone writes the value as text, the format is silently ignored and the raw value is shown verbatim.

A value reaches the cell as text when the JSON field is a string (`"0.032"`), or when `{o.exportFormattedValuesAsText=true}` is set. In XLSX/ODS templates, `:formatN` is the **only** way to force Carbone to write a native number into the cell — arithmetic formatters like `:mul(1)` or `:add(0)` do not change the output type. The cell must contain **a single tag ending with `:formatN`**: `{d.amount:formatN}`, `{d.amount:cumSum:formatN}`.

`:formatC`, `:formatD` and the accounting option `:formatN(2, acc)` always write **text**, formatted for the report's `lang`: fine for display, but Excel cannot sum, sort or chart them. For a value that must stay a number, use `:formatN` and put the display in the cell's number format. With `lang:"en-us"` and the data `{"amount": 1234.5, "balance": -1234.5, "rate": 0.125}`:
```
{d.rate:formatN}              ← cell format 0.0%                        → 12.5%
{d.amount:formatN}            ← cell format $#,##0.00                   → $1,234.50     (number)
{d.balance:formatN}           ← cell format $#,##0.00;[Red]($#,##0.00)  → ($1,234.50) in red (number)
{d.balance:formatN(2, acc)}   ← any cell format                         → (1,234.50)    (text)
{d.amount:formatC}            ← any cell format                         → $1,234.50     (text)
```
For accounting parentheses on a value that must stay a number, use `:formatN` with the cell format `#,##0.00;(#,##0.00)` instead of `acc`. In ODS, `acc` is ignored and the cell stays a number.

**The `:formatN` precision argument is ignored in XLSX/ODS.** Because the cell's own number format controls decimal display, `:formatN`, `:formatN(0)`, and `:formatN(2)` all behave identically — Carbone writes the raw native number and lets Excel/Calc format it. If you need a specific number of decimals, set them on the cell format, not on the tag. (With `acc` the output is text, so the precision applies.)

---

## Formulas that follow the loop rows — XLSX (v5.18.0+, pre-release)

Add `{o.preReleaseFeatureIn=5018000}` in any cell of the template (the tag is removed from the output). Carbone then updates the workbook the way Excel does when rows are inserted. Without the tag, and in ODS templates, formulas are not adjusted — see "Formulas without `5018000`, and in ODS" below.

Tested template — row 4 is the `[i]` row, row 5 the `[i+1]` row, the VAT rate is in `B9`:

| | A | B | C | D | E |
|---|---|---|---|---|---|
| **4** | `{d.products[i].name}` | `{d.products[i].qty:formatN}` | `{d.products[i].price:formatN}` | `=B4*C4` | `=D4*(1+$B$9)` |
| **5** | `{d.products[i+1].name}` | `{d.products[i+1].qty:formatN}` | `{d.products[i+1].price:formatN}` | `=B5*C5` | `=D5*(1+$B$9)` |
| **6** | `Total` | | | `=SUM(D4:D5)` | `=SUM(E4:E5)` |

With 10 products, the generated rows get `=B5*C5` … `=B13*C13`, the total becomes `=SUM(D4:D13)`, and the absolute reference `$B$9` follows its cell to `$B$17`. A running total `=SUM($D$4:D4)` in the `[i]` row works the same way.

- **Draw ranges over the `[i]` row and the `[i+1]` row** — `SUM(D4:D5)`, a chart series `$E$4:$E$5`, a table or pivot source `A3:F5`, a conditional-formatting range `A4:F5`. They grow to cover every generated row.
- **Keep Carbone tags and formulas in separate cells.** A formula that contains a Carbone tag, or uses `INDIRECT`, is not modified.
- Carbone writes the formulas without computing them: Excel recalculates when it opens the file, and they are computed when the report is converted (to PDF, for example).

**The rest of the workbook follows the rows too** (same tag):
- **Merged cells** — see "Merged cells in a loop" below.
- **Conditional formatting** on the `[i]` row (cell rules, formula rules such as `$F4="Out of stock"`, color scales, data bars) applies to every generated row; a rule on a cell below the loop moves with that cell.
- **Data validation and AutoFilters** on the `[i]` row extend to every row. A drop-down list whose source cells are below the loop follows them.
- **Excel tables** (Insert > Table) on the loop grow with the data: banded rows, filter buttons and structured references like `=SUM(Sales[Amount])`.
- **Native Excel charts** whose series use the loop cells show every generated row; a chart below the loop moves down. To draw a chart image from the data instead, use `:chart` (`advanced-features.md`).
- **Pivot tables** built from the loop cells (on any sheet): the source covers the generated rows, and Excel refreshes the pivot when it opens the file. Until then, the file keeps the template's pivot values — an application that does not refresh pivot tables on open shows those.
- **Hyperlinks** in the `[i]` row are copied to every row; an internal link to a cell of the workbook (like "Go to total") still targets that cell after it moves; a link below the loop moves with its cell.
- **Named ranges, the print area, sparklines, and manual page breaks, pictures and comments below the loop** follow the rows.

---

## Merged cells in a loop — XLSX (v5.18.0+)

With `{o.preReleaseFeatureIn=5018000}` — or, without the tag, in any sheet that uses `:mergeCell` — a merged cell of the `[i]` row (the product name over `A4:B4`) is copied to every generated row, and merged cells below the loop (the total over `A6:D6`) move down. It works with sorted loops, filters, `:drop(row)`, conditional blocks, nested loops and loops of several rows. A hidden row inside a vertically merged cell makes the merge extend to the next row.

### `:mergeCell` — merge identical values of a column

`:mergeCell` merges the consecutive cells of a column that have the same value: the value is printed once, in one cell merged vertically over its rows. No pre-release tag needed.
```
{d.products[i].category:mergeCell}               ← one merged cell per category
{d.products[i].status:mergeCell(.category)}      ← merges identical statuses only within the same category
{d.rows[i].city:mergeCell(.country, .region)}    ← several parents
```
- It must be the **last formatter** of the tag.
- It merges the rows as printed, so it works with sorted and filtered loops and `:drop(row)`. Only **adjacent** identical values merge: sort the loop when they are not already grouped in the data.
- A cell merged horizontally in the template (`C4:D4`) keeps its width and grows down — useful for the parent cells of a nested loop.
- A loop that repeats two rows per item is not merged: the rows must be consecutive.
- XLSX templates only. For merged cells in a DOCX/ODT table loop → `docx-tips.md`.

---

## Totals computed by Carbone — aggregators (ENTERPRISE)

Aggregators compute totals without Excel formulas, in XLSX and ODS, with or without `5018000`. They match the rows after sorting and filtering, and stay correct in PDF and CSV outputs. End with `:formatN` to write native numbers:
```
{d.products[i].amount:cumSum:formatN}               ← running total, in the [i] row
{d.products[i].amount:aggSum(.category):formatN}    ← total of the row's category, in the [i] row
{d.products[].amount:aggSum:formatN}                ← grand total, below the loop
```
Full reference → `formatters.md` "Aggregator Formatters".

---

## Formulas without `5018000`, and in ODS

ODS templates, and XLSX templates without the pre-release tag: Carbone does not adjust formulas to the rows it adds. Use an aggregator (above), or write formulas that do not depend on the number of rows. These patterns keep working when `5018000` is added, since `INDIRECT` formulas are left as they are.

### Dynamic total using `INDIRECT` + `ROW`

Place this in the total cell below the loop — it sums everything in column B from row 4 up to the row just above:
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

## XLSX layout: frozen panes, pictures, headers, sheet names

- **Frozen panes** stay where they are, with or without `5018000`: freeze only rows above the loop.
- **Pictures and barcodes** (tag in the alt text of a temporary picture, e.g. `{d.logo}`) are stretched to the size of the temporary picture: give it the proportions of the real images (square for a QR code). Loops do not repeat pictures — a picture in the `[i]` row stays on the first row, and a picture tag that uses the loop (`{d.items[i].photo}`) stops the render with an error.
- **Headers and footers** (Page Layout > Header & Footer) accept tags next to Excel's page-number fields: `{d.company}` prints on every page.
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

**ODS templates can generate sheets dynamically** — one tab per item of an array. Aliases are the only way to do it, and it does **not** work with XLSX templates: for an XLSX result, design an ODS template and convert the report to XLSX.

Declare two aliases in the content of the first sheet, one holding the loop tag and one holding its end-marker:
```
{#sheet1 = d.fruits[i].name}
{#sheet2 = d.fruits[i+1].name}
```

Then rename the **sheet tabs** in LibreOffice Calc — the first tab becomes `{$sheet1}`, the second `{$sheet2}`:

| Tab name | Role |
|---|---|
| `{$sheet1}` | The sheet that is repeated — its content and formatting are inherited by every generated sheet |
| `{$sheet2}` | End-marker tab, removed from the output |

At render time Carbone resolves the aliases back to the repetition markers and creates one sheet per array item, each named after the value (`apple`, `banana`, …) and carrying the first sheet's layout.

The cells of the first sheet address the current item through the same outer path — `{d.fruits[i].name}`, and a table inside the sheet is an ordinary nested loop (`{d.fruits[i].nutrients[i].qty}` closed by `{d.fruits[i].nutrients[i+1]}`, see SKILL.md §4b).
