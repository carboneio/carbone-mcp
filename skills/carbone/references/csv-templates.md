# Carbone CSV Templates

Read this file when the user designs or debugs a CSV template: where tags go in a CSV file, which editor and encoding to use (UTF-8, BOM for Excel), one line per array item and where the `[i]` / `[i+1]` tags go, the empty line or the first-line-only value a misplaced tag gives, a column that repeats a value from outside the array, sorted or filtered lines, nested arrays flattened into one line per child item, quoting values that contain commas, quotes or line breaks, numbers and decimal separators for import files, ISO dates and timezones, empty values and defaults, inline conditions and conditional lines, header and trailer control lines (line numbers, counts, totals), multi-value cells, translated headers and values, or choosing between a CSV template and an XLSX template converted to CSV.

---

## How a CSV template works

Any CSV file is a template. Carbone replaces the tags and writes every other character as it is: separators, quotes, spaces, header lines, line endings. It never parses the columns: the template defines the syntax of the file.
```
code,name,vat_number,country,email,payment_terms
{d.code},{d.name},{d.vat},{d.country},{d.email},{d.terms}
```
`{ "code": "SUP-1042", "name": "Globex Industrial Supplies", "vat": "DE123456789", "country": "DE", "email": "billing@globex.example", "terms": "NET30" }` →
```
code,name,vat_number,country,email,payment_terms
SUP-1042,Globex Industrial Supplies,DE123456789,DE,billing@globex.example,NET30
```

- Write the template in a code editor (VS Code, Notepad++), not in a spreadsheet app: saving a CSV there can change the separators, the quotes and the encoding.
- Save it in UTF-8. The report is UTF-8 and keeps the line endings of the template (LF or CRLF).
- Supported: substitutions, loops, formatters, conditions, translations, aggregators and `:set`. `:drop` and `:keep` fail the render (`Formatter "drop" does not exist`): filter the loop instead. No pictures, colors, charts, barcodes or hyperlinks (`references/format-support.md`).
- Rules shared by all text templates (tags that print nothing, control characters, conditional blocks) → `references/txt-templates.md`.

---

## Loops: one line per item

```
sku,title,price,quantity
{d.products[i].sku},{d.products[i].title},{d.products[i].price},{d.products[i].stock}
{d.products[i+1]}
```
`{ "products": [ { "sku": "AC-1001", "title": "Steel water bottle 750 ml", "price": 24.9, "stock": 320 }, { "sku": "AC-1003", "title": "Bamboo cutlery set", "price": 12, "stock": 0 } ] }` →
```
sku,title,price,quantity
AC-1001,Steel water bottle 750 ml,24.9,320
AC-1003,Bamboo cutlery set,12,0
```

Carbone repeats the text from the first `[i]` tag to the `[i+1]` tag (the line break of the `[i]` line included) and removes the `[i+1]` tag:
- **Write `{d.products[i+1]}` at the very start of the next line.** End the file right after it, or write the next line right after it on the same line (`{d.payments[i+1]}TRAILER,…`, see "Control lines"). A line break after the tag leaves an empty line under the loop.
- **Start the repeated line with an `[i]` tag.** Whatever comes before the first `[i]` tag (text, or a tag outside the array) is written once, on the first line only:
  ```
  {d.batch},{d.payments[i].name}
  {d.payments[i+1]}
  ```
  `{ "batch": "PAY-7", "payments": [ { "name": "Globex" }, { "name": "Initech" } ] }` → `PAY-7,Globex` then `Initech`. Read the value from the item with `..` (`{d.payments[i]..batch},{d.payments[i].name}` → `PAY-7,Globex` then `PAY-7,Initech`), or open the line with an empty `[i]` tag: `{d.payments[i]}{d.batch},{d.payments[i].name}`. Same for a fixed record type: `{d.payments[i]}D,{d.payments[i].iban}`.
- **Empty array**: the `[i]` line and the `[i+1]` tag disappear; the header line stays.
- **One-line loop**: for a list inside one cell, see "Multi-value cells".

---

## Sort and filter

```
sku,name,unit_price
{d.items[sku, i].sku},{d.items[sku, i].name},{d.items[sku, i].price}
{d.items[sku+1, i+1, status!='discontinued']}
```
`{ "items": [ { "sku": "HX-310", "name": "Hex bolt M10", "price": 0.42, "status": "active" }, { "sku": "WS-200", "name": "Flat washer M8", "price": 0.05, "status": "discontinued" }, { "sku": "AN-500", "name": "Anchor 8x50", "price": 0.58, "status": "active" } ] }` →
```
sku,name,unit_price
AN-500,Anchor 8x50,0.58
HX-310,Hex bolt M10,0.42
```
- Every `[i]` tag of the line carries the sort attribute (`[sku, i]`); the end tag becomes `[sku+1, i+1]`.
- The filter goes on the end tag only (v5+). Filtering the loop is the way to skip lines in a CSV file.

Syntax details → SKILL.md §4d and `references/loops-advanced.md` "Sorting".

---

## Nested arrays: one line per child item

Import files often need one line per order line, with the order fields repeated on each line:
```
order,date,sku,quantity
{d.orders[i].items[i]..id},{d.orders[i].items[i]..date},{d.orders[i].items[i].sku},{d.orders[i].items[i].qty}
{d.orders[i+1].items[i+1]}
```
`{ "orders": [ { "id": "SO-58201", "date": "2026-11-09", "items": [ { "sku": "AC-1001", "qty": 2 }, { "sku": "AC-1004", "qty": 6 } ] }, { "id": "SO-58202", "date": "2026-11-09", "items": [ { "sku": "AC-1002", "qty": 1 } ] } ] }` →
```
order,date,sku,quantity
SO-58201,2026-11-09,AC-1001,2
SO-58201,2026-11-09,AC-1004,6
SO-58202,2026-11-09,AC-1002,1
```
- `{d.orders[i].items[i]..id}` reads the `id` of the parent order (`..` = up one level).
- One end tag closes both loops: `{d.orders[i+1].items[i+1]}`.
- An order without items writes no line.

---

## Commas, quotes and line breaks

Carbone escapes nothing: the template sets the quoting rules. Wrap each column that can hold the separator, a quote or a line break in double quotes **in the template**, and double the quotes of the value with `:replace('"','""')`:
```
id,company,note
{d.customers[i].id},"{d.customers[i].company:replace('"','""')}","{d.customers[i].note:replace('"','""')}"
{d.customers[i+1]}
```
`{ "customers": [ { "id": "C-2041", "company": "Acme Corporation, Inc.", "note": "Deliver to \"Dock 4\"\nCall before 4 pm" }, { "id": "C-2042", "company": "Initech", "note": "" } ] }` →
```
id,company,note
C-2041,"Acme Corporation, Inc.","Deliver to ""Dock 4""
Call before 4 pm"
C-2042,"Initech",""
```
- `'"'` is a double quote **inside** a single-quoted argument: it is literal text, valid in a tag. Double quotes stay invalid as argument delimiters (SKILL.md §10 item 18).
- A line break in the data is written as is. Inside a quoted value Excel keeps it in the cell (two lines in one cell). If the target system rejects multi-line values, remove the line breaks from the data.
- An empty value gives `""`.
- With `;` as the separator, quote the columns that can contain a `;`.

---

## Numbers and dates

Write the exact format of the target system, whatever the locale of the report:
```
date,account,label,amount
{d.lines[i].date:formatD('YYYY-MM-DD')},{d.lines[i].account},{d.lines[i].label},{d.lines[i].amount:formatN(2):replace(',', '')}
{d.lines[i+1]}
```
`"lang": "en-us"`, `{ "lines": [ { "date": "2026-11-03T09:12:00Z", "account": "411000", "label": "INV-4410 Acme", "amount": 12480.5 }, { "date": "2026-11-03T09:12:00Z", "account": "706000", "label": "INV-4410 Acme", "amount": -10400.42 } ] }` →
```
date,account,label,amount
2026-11-03,411000,INV-4410 Acme,12480.50
2026-11-03,706000,INV-4410 Acme,-10400.42
```

| Need | Tag | `12480.5` → |
|---|---|---|
| Number as in the JSON | `{d.amount}` | `12480.5` |
| Two decimals, decimal point (`en-us`) | `{d.amount:formatN(2):replace(',', '')}` | `12480.50` |
| Two decimals, decimal comma (`de-de`) | `{d.amount:formatN(2):replace('.', '')}` | `12480,50` |
| Display format with thousands separator (`en-us`) | `{d.amount:formatN(2)}` | `12,480.50` |

- `:formatN` follows the `lang` of the report. Fix it in the template so the API call cannot change the separators: write `{o.lang=en-us}` at the start of the header line (alone on its own line, it leaves an empty first line).
- `{o.lang}` also changes the dictionary of `:t`, while `{t()}` tags keep the `lang` of the API call: in a translated CSV, leave `lang` to the API call (see "Translations"). With decimal commas, separate the columns with `;`.
- Avoid `:formatC` in import files: it adds the currency symbol.
- `:formatD` first converts a date with a time to the timezone of the report (Europe/Paris by default): `"2026-11-03T23:30:00Z"` becomes `2026-11-04`. Write `{o.timezone=UTC}` when the data holds UTC times.

---

## Empty values and inline conditions

```
employee_id,status,hours,bonus
{d.employees[i].id},{d.employees[i].active:ifEQ(true):show(A):elseShow(I)},{d.employees[i].hours},{d.employees[i].bonus:ifEM:show(0)}
{d.employees[i+1]}
```
`{ "employees": [ { "id": "E-0107", "active": true, "hours": 151.67, "bonus": 250 }, { "id": "E-0112", "active": true, "hours": 120, "bonus": null }, { "id": "E-0125", "active": false, "hours": 0 } ] }` →
```
employee_id,status,hours,bonus
E-0107,A,151.67,250
E-0112,A,120,0
E-0125,I,0,0
```
- An empty or missing value writes nothing between the separators (`E-0112,A,120,`). `:ifEM:show(0)` writes a default value; `:ifEQ(true):show(A):elseShow(I)` maps a value to the code of the target system.

---

## Conditional lines

To skip item lines, filter the loop ("Sort and filter"). For a block of lines (an optional header or comment line), use `:showBegin`/`:showEnd` or `:hideBegin`/`:hideEnd`: the begin tag at the start of the first line of the block, the end tag at the start of the line after it. Placement rules and the empty lines a misplaced tag leaves → `references/txt-templates.md` "Conditional blocks".

---

## Control lines: line numbers, counts and totals

Bank and accounting files often start with a header record and end with a control line:
```
HEADER,{d.batch},{d.date:formatD('YYYY-MM-DD')}
{d.payments[i].amount:cumCount},{d.payments[i].name},{d.payments[i].iban},{d.payments[i].amount:formatN(2):replace(',', '')}
{d.payments[i+1]}TRAILER,{d.payments[].amount:aggCount},{d.payments[].amount:aggSum:formatN(2):replace(',', '')}
```
`"lang": "en-us"`, `{ "batch": "PAY-2026-11-07", "date": "2026-11-07", "payments": [ { "name": "Globex Industrial Supplies", "iban": "DE89370400440532013000", "amount": 1250.4 }, { "name": "Initech Software", "iban": "FR7630006000011234567890189", "amount": 980 }, { "name": "Umbrella Logistics", "iban": "NL91ABNA0417164300", "amount": 4310.25 } ] }` →
```
HEADER,PAY-2026-11-07,2026-11-07
1,Globex Industrial Supplies,DE89370400440532013000,1250.40
2,Initech Software,FR7630006000011234567890189,980.00
3,Umbrella Logistics,NL91ABNA0417164300,4310.25
TRAILER,3,6540.65
```
- `:cumCount` on any field of the item numbers the lines.
- `[]` tags outside the loop aggregate the whole array (ENTERPRISE): `:aggCount`, `:aggSum`. `{d.payments:len}` also counts the items, without an aggregator.
- Write the control line right after the end tag, on the same line. Format the total like the lines.

---

## Multi-value cells

To list several values in one cell, join them instead of looping:
```
{d.tags:arrayJoin('|')}             ["a","b","c"] → a|b|c
{d.payments[].name:aggStr('|')}     [{"name":"Globex"},{"name":"Initech"}] → Globex|Initech
```
A one-line loop (`{d.tags[i]}|{d.tags[i+1]}`) leaves a separator after the last item, and the `:drop(p)` pattern of SKILL.md §9 does not exist in text files. Quote the cell when the joining character is the column separator.

---

## Translations

Template saved as UTF-8 with BOM, `"lang": "fr-fr"`:
```
{t(SKU)};{t(Price)};{t(Availability)}
{d.products[i].sku};{d.products[i].price:formatN(2)};{d.products[i].availability:t}
{d.products[i+1]}
```
Translations `{ "fr-fr": { "SKU": "Référence", "Price": "Prix HT", "Availability": "Disponibilité", "in_stock": "En stock", "backorder": "Sur commande" } }`, data `{ "products": [ { "sku": "AC-1001", "price": 24.9, "availability": "in_stock" }, { "sku": "AC-1002", "price": 349.5, "availability": "backorder" } ] }` →
```
Référence;Prix HT;Disponibilité
AC-1001;24,90;En stock
AC-1002;349,50;Sur commande
```
- `{t(...)}` translates the header, `:t` translates a code from the data. A key missing from the dictionary is printed as is.
- Translated text is XML-encoded: `'` prints `&apos;`, `&` prints `&amp;`. Write apostrophes as `’` in the dictionary.
- `:formatN(2)` writes decimal commas in French, hence the `;` separator.

---

## Encoding for Excel and other character sets

- Excel reads a CSV as UTF-8 only with a BOM: save the template as **UTF-8 with BOM** (VS Code: Save with Encoding). Carbone keeps the BOM in the report. Without it, Excel shows `Zoë` as `ZoÃ«`.
- For another character set, like Windows-1252, use an XLSX template converted to CSV (below).

---

## CSV template or XLSX template converted to CSV

An XLSX or ODS template converted to CSV is the other way: Carbone fills the spreadsheet, then the conversion writes the CSV, quoting the cells itself. Design the spreadsheet with `references/xlsx-tips.md`.

| | CSV template | XLSX or ODS template |
|---|---|---|
| Quotes and escaping | Written in the template | Automatic |
| Separator and text delimiter | Written in the template | Set by the conversion |
| Character set | UTF-8 (BOM optional) | Set by the conversion (Windows-1252 possible) |
| Numbers | Formatted by the tags | As displayed by the cell format, like `$950.50` |

Use a CSV template to control every character of the file; an XLSX template to get the quoting done for you, or another character set.

---

## Checklist

- Copy the sample file of the target system: same columns, order, header names and separator.
- ISO dates with `:formatD('YYYY-MM-DD')` (`{o.timezone=UTC}` for UTC times); plain numbers, raw or `:formatN(2):replace(',', '')` with `{o.lang=en-us}`.
- Quote every text column that can contain the separator, a quote or a line break, with `:replace('"','""')`.
- Every repeated line starts with an `[i]` tag; the `[i+1]` tag starts the next line, followed by nothing or by the control line.
