# Carbone XLSX/ODS — Formula Tips

Read this file when the user asks about dynamic Excel formulas that survive Carbone row injection, computing totals after a loop, referencing injected rows with MATCH/INDEX, generating one sheet per array item, line breaks inside a cell, or why a cell's percentage/currency/date format is not being applied.

---

## Number formats only apply to numeric cells

In XLSX/ODS, the cell's Excel number format (percentage, currency, thousands, date) is applied by the spreadsheet — but **only to native numeric cells**. If Carbone writes the value as text, the format is silently ignored and the raw value is shown verbatim.

A value reaches the cell as text when the JSON field is a string (`"0.032"`), or when `{o.exportFormattedValuesAsText=true}` is set. In XLSX/ODS templates, `:formatN` is the **only** way to force Carbone to write a native number into the cell — arithmetic formatters like `:mul(1)` or `:add(0)` do not change the output type. Once the cell holds a real number, the cell's own format handles display:
```
{d.rate:formatN}    ← cell formatted as 0.00%       → 3.20%
{d.price:formatN}   ← cell formatted as $#,##0.00   → $1,234.50
```

**The `:formatN` precision argument is ignored in XLSX/ODS.** Because the cell's own number format controls decimal display, `:formatN`, `:formatN(0)`, and `:formatN(2)` all behave identically — Carbone writes the raw native number and lets Excel/Calc format it. If you need a specific number of decimals, set them on the cell format, not on the tag.

---

## Line breaks inside a cell (v5.17.0+)

`:convCRLF` turns `\n` / `\r\n` in the data into real line breaks inside an XLSX cell. Enable **Wrap text** on the cell, otherwise the content stays on one line:
```
{d.address:convCRLF}
{d.names:arrayJoin('\n'):convCRLF}    ← one array item per line
```

---

## Dynamic Excel formula using `INDIRECT` + `ROW`

A `SUM(B4:B5)` formula breaks when Carbone pushes rows down dynamically. Place this in the total cell below the loop — it sums everything in column B from row 4 up to the row just above:
```
=SUM(INDIRECT("B4:B" & ROW()-1))
```

For bi-directional tables, or when you want the formula to work in **any cell** in the sheet:
```
=SUM(INDIRECT(ADDRESS(1,COLUMN()) & ":" & ADDRESS(ROW()-1,COLUMN())))
```
Sums all numbers in the same column above the current cell, regardless of row or column position.

## Reference the total elsewhere using `MATCH`/`INDEX`

Add a static label next to the total cell (e.g. `TOTAL weeks` in column A), then reference it dynamically:
```
=INDEX(B:B, MATCH("TOTAL weeks", A:A, 0))
```
Finds the total row dynamically regardless of how many rows Carbone injected.

---

## One sheet per array item (ODS only)

**ODS templates can generate sheets dynamically** — one tab per item of an array. Aliases are the only way to do it, and it does **not** work with XLSX templates.

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
