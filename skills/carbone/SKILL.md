---
name: carbone
description: >
  Carbone templating: merge JSON data into a DOCX (Word), XLSX (Excel), PPTX (PowerPoint), ODT, ODS,
  HTML, Markdown or PDF template, plus text/XML formats such as CSV, TXT, SVG and IDML. Use this skill
  to design, validate, fix or explain Carbone syntax: tags, loops, conditions, formatters, aggregators,
  aliases, and mapping a JSON dataset onto a template. Trigger on: the tag syntax {d.} {c.} {#alias}
  {$alias} {t()} {o.} or any :formatter chain; a template error such as a missing [i+1]; whether a
  format supports a feature or what it converts to; filling a PDF form (AcroForm); adding a chart,
  barcode or dynamic image to a document; writing a number or an amount in words; dynamic Excel
  formulas or merged cells; upgrading between Carbone versions;
  and any request to build an invoice, contract or report from JSON, mail-merge data into a document,
  fill a template with data, or convert a document (HTML or Markdown to PDF, DOCX to PDF).
license: Apache-2.0
metadata:
  author: carboneio
  version: "2.2.0"
  carbone_version: "5.18.0"
  repository: https://github.com/carboneio/carbone-agent-plugin
---

# Carbone Universal Templating Language — Skill

Carbone is a **declarative** templating engine. You provide a template (DOCX, XLSX, PPTX, ODT, HTML, …) with **Carbone tags** (placeholders in `{}`), plus a JSON dataset. Carbone merges both to produce the filled document.

> **NEVER invent Carbone syntax.**
> Carbone is its own language — it is NOT JSONPath, NOT Mustache, NOT Handlebars, NOT Jinja2, NOT any other templating language. Its tag syntax, formatters, loop markers, and filter expressions are unique. Any pattern not explicitly documented in this skill or its reference files does not exist in Carbone. If a user's request cannot be answered from what is documented here, say so — do not guess or adapt syntax from another language.

**Design principles — they change how you answer:**
- **Adapt the template to the data, never the data to the template.** Carbone injects into an unmodified API response. Reach for array filters, sorting, lookups and `:set` before suggesting the user reshape their JSON.
- **Format-agnostic.** Carbone injects into the file's own markup — the XML inside DOCX/ODT/IDML and any other XML-based format, and text files such as TXT, CSV, Markdown or JSON (§9).
- **Backward compatible.** Tag syntax survives upgrades — a template written for v2 still renders on v12. Never warn a user that their existing tags will break in a newer version.

---

## 1. Tag Types and Prefixes

| Tag | Purpose |
|---|---|
| `{d.path}` | Data from the main JSON object (most common) |
| `{c.path}` | Data from the "complement" object (metadata / computed values) |
| `{c.now}` | Built-in: current date/time at render time (UTC). Chain with `:formatD` to display it. |
| `{#alias = d.path}` | Declare an alias shortcut (removed from output) |
| `{$alias}` | Use a declared alias |
| `{t(key)}` | Static i18n translation tag — no quotes needed, whitespace preserved |
| `{o.option=value}` | Carbone in-template option (removed from output) |

### Special `{o.}` options
Common: `{o.timezone=Europe/Paris}` `{o.lang=en-US}` `{o.converter=L}` `{o.useHighPrecisionArithmetic=true}` `{o.exportFormattedValuesAsText=true}` (XLSX only) `{o.hardRefresh=true}` (force converter even when input/output format match — useful for XLSX formula refresh) `{o.preReleaseFeatureIn=VERSION}` (opt-in pre-release features — e.g. `5018000`: XLSX formulas, merged cells, charts and pivot tables follow loop rows).
Full in-template option list → `references/in-template-options.md`.

---

## 2. Basic Placeholders

| Goal | Tag |
|---|---|
| Simple property | `{d.firstname}` |
| Nested property | `{d.user.address.city}` |
| Array item by position | `{d.items[0].name}` or `{d.items[i=0].name}` |
| Last array item | `{d.items[i=-1].name}` |
| Second to last | `{d.items[i=-2].name}` |
| Parent object property | `{d.child..parentProp}` (`..` = up 1 level, `...` = up 2 levels) |

### Array search (without loop)
Search the first matching item by attribute value:
```
{d[year=1999].name}
{d[name='Back to the future'].year}
{d[year=1999, meta.type='SF'].name}     ← multiple filters = AND
{d.subArray[sub.b.c=.other].text}       ← variable filter (starts with .)
{d.movies[year=1999]..country}          ← access parent via ..
```
If the filter returns multiple rows, Carbone keeps only the **first** match. Equality is **loose**: `[year=1999]` matches both numeric `1999` and the string `'1999'` (loop filters always; array search and lookup since v5.7.0).

---

## 3. Aliases

```
{#myAlias = d.wheels}
{d.name} needs {$myAlias} wheels.
```

**Parametrized aliases** (act like functions):
```
{#mealOf($weekday) = d[weekday = $weekday]}
Tuesday we eat {$mealOf(2).name}.
```

Aliases are shortcuts — they do NOT store values. To store a computed value, use `:set` (see Section 7).

For advanced patterns → `references/aliases.md`.

---

## 4. Loops (Repetitions)

Carbone uses a **two-row declaration** pattern. No explicit open/close tags needed.

### 4a. Simple array loop
```
{d.cars[i].brand}     {d.cars[i].id}
{d.cars[i+1].brand}
```
The `[i+1]` row marks the end of the repeated block and is **removed** from output.

### 4b. Nested loops (unlimited depth)
```
{d[i].brand}
{d[i].models[i].size}   {d[i].models[i].power}
{d[i].models[i+1].size}
{d[i+1].brand}
```

### 4c. Loop over object properties
Use `.att` to print the key, `.val` to print the value:
```
{d.myObject[i].att}    {d.myObject[i].val}
{d.myObject[i+1].att}
```

You can also combine **direct property access and object iteration on the same object** in the same template (v5.4.2+, requires `{o.preReleaseFeatureIn=5004002}`):
```
{d.myObj.id}
{d.myObj[i].att}
{d.myObj[i+1].att}
```

### 4d. Filtering
Operators: `>`, `<`, `>=`, `<=`, `=`, `!=`. Place conditions after the iterator:
```
{d[i, age > 19, age < 30].name}
{d[i+1, age > 19, age < 30].name}
```
**v5+**: only the `[i+1]` row needs the filter. First N items: `{d[i, i < 2].name}`. Last item only: `{d[i=-1].name}`. Exclude last: `{d[i, i!=-1].name}`.

### 4e. Grouping (v5+)
Use an attribute name as a custom iterator to group rows by that attribute:
```
{d[brand].brand}   {d[brand].qty:aggSum(.brand)}
{d[brand+1].brand}
```

For advanced loop patterns (negative-index filtering, OR-logic with `:set`, bidirectional loops, sorting, distinct, lookup/JOIN, parallel loops, primitive/nested arrays, object attribute search, row repetition) → read `references/loops-advanced.md`.

---

## 5. Formatters

Formatters are chained with `:`. Each formatter's output feeds the next.
```
{d.name:lowerCase:ucFirst}
{d.birthday:formatD(LL)}
```
Parameters use parentheses. Strings with spaces or commas need single quotes: `:prepend('hello world')`.

**Escaping a single quote**: use two adjacent single quotes — `'David''s Car'`.

**`{t()}` in formatter args**: `{d.id:ifEQ(2):show( {t(monday)} ):elseShow( {t(tuesday)} )}`. No quotes needed around `{t()}` content — whitespace is preserved. Chain formatters after `:show`: `{d:show('{t(Destination)}'):ucFirst}`.

**Whitespace in JSON key names** (requires `{o.preReleaseFeatureIn=4022011}`): wrap in single quotes — `{d.'my param'.'second level'[1].'sub obj'}`. Not supported inside formatters, array filters, or aliases.

**Dynamic parameters** start with `.` (relative) or `d.`/`c.` (absolute): `{d.qtyB:add(.qtyC)}` / `{d.qtyB:add(d.qtyA)}`.

For the **complete formatter reference**, read `references/formatters.md`.

### Quick-reference — most common formatters

**Text**: `:lowerCase` `:upperCase` `:ucFirst` `:ucWords` `:prepend(text)` `:append(text)` `:replace(old,new)` `:substr(start,end)` `:ellipsis(max)` `:convCRLF` `:html` `:print(msg)` `:t`

**Number**: `:formatN(precision, acc)` (uses `lang` option for separators; `acc` = negatives in parentheses, v5.18.0+) `:add(x)` `:sub(x)` `:mul(x)` `:div(x)` `:mod(x)` `:abs` `:round(n)` `:ceil` `:floor`

**Math formula** — formatters accept simple expressions (no parentheses, `*`/`/` before `+`/`-`):
```
{d.val:add(.otherQty + .vat * d.sub.price - 10 / 2)}
```

**Currency**: `:formatC(precisionOrFormat, targetCurrencyOrAcc)` (`{d.x:formatC(L, acc)}` — `-1234.5` → `"($1,234.50)"`) `:convCurr(target, source)`

**Number in words**: `:toWord(type, precision, keywords…)` — `W` cardinal (default), `O` ordinal, `C` amount with currency, in the `lang` language (v5.16.0+)

**Date**: `:formatD(patternOut, patternIn)` `:addD(amount, unit)` `:subD(amount, unit)` `:startOfD(unit)` `:endOfD(unit)` `:diffD(toDate, unit, patternFrom, patternTo)`

**Interval**: `:formatI(patternOut, patternIn)` — converts ms/seconds/ISO durations to human-readable

**Array**: `:arrayJoin(sep, index, count)` `:arrayMap(objSep, attSep, attributes)` `:cumCount` `:cumCountD` `:count(start)` (deprecated → use `:cumCount`)

**Key-value mapping**: `:convEnum('ENUM_NAME')` — enum defined in render options

---

## 6. Conditions

### 6a. Inline — print a word/phrase
```
{d.score:ifGT(50):show('Pass'):elseShow('Fail')}
```
Switch-case pattern:
```
{d.val:ifEQ(1):show(A):ifEQ(2):show(B):elseShow(C)}
```

### 6b. Conditional blocks — show/hide a section
```
{d.isPremium:ifEQ(true):showBegin}
  ... premium content ...
{d.isPremium:showEnd}

{d.status:ifEQ('cancelled'):hideBegin}
  ... content hidden if cancelled ...
{d.status:hideEnd}
```
Recommendation: use only line breaks (`Shift+Enter`) between Begin/End tags — or, in DOCX, end each tag's paragraph with it (`references/docx-tips.md`) — to avoid extra blank lines.

### 6c. Smart conditions — drop/keep elements (ENTERPRISE, v4+)
Drops the containing document element when condition is true. The tag prints **nothing**.
```
{d.discount:ifEM():drop(row)}
```
Elements: `row` `col` `p` `img` `table` `chart` `shape` `slide` (ODP) `item` (ODP/ODT) `sheet` (ODS) `h` (ODT) `div` (HTML) `span` (HTML).
Drop N consecutive: `{d.text:ifEM():drop(row, 3)}` — works for `p` and `row`, not `col`. One `:drop(col)` per column only. Use `:keep` for the inverse.
Format limits: ODS → `col`/`row`/`img`/`sheet` only. XLSX → `row`/`col` only. PPTX → `col`/`row`/`img`/`p`/`shape`/`chart`/`table`. HTML → `table`/`col`/`row`/`p`/`div`/`span`.

### 6d. Logical operators
`:ifEQ(v)` `:ifNE(v)` `:ifGT(v)` `:ifGTE(v)` `:ifLT(v)` `:ifLTE(v)` `:ifIN(v)` `:ifNIN(v)` `:ifEM()` `:ifNEM()` `:ifTE(type)`

Chain with `:and(arg?)` or `:or(arg?)` (OR is the default between consecutive conditions). The argument selects what the next condition reads — accepted forms:
- bare (no arg) — re-evaluate the same field: `{d.x:ifEM():or:ifEQ('N/A'):drop(row)}`
- `.prop` — sibling on the same parent object: `{d.age:ifGTE(18):and(.country):ifEQ('FR'):show(…)}`
- `d.absolute.path` / `c.absolute.path` — any node in the data or complement tree: `{d.row.last_page:ifEQ(true):and(d.total.shared_payee):ifEQ(true):keep(row,2)}`
- `$alias.field` — switch context to a declared alias: `{$mailing.cc_name:ifNEM:or($mailing.payee):ifEM:drop(p)}`

For real-world conditional patterns (optional blocks, table/row visibility, NaN guard, range checks, checkbox patterns, complement data branching) → `references/practical-examples.md`.

---

## 7. Computation

### 7a. Simple mathematics
`:add`, `:sub`, `:mul`, `:div`, `:mod`, `:abs` — see formatters reference.

### 7b. Aggregators (ENTERPRISE, v4+)
Process an entire array and return a single result. Place **outside** the loop for totals:
```
{d.cars[].qty:aggSum}                ← sum of all qty
{d.cars[sort>1].qty:aggSum}          ← sum with filter
{d.cars[].qty:mul(.sort):aggSum}     ← with chained formatter before agg
```
Inside a loop, partitioned by group:
```
{d[i].qty:aggSum(.brand)}    ← sub-total per brand
```
All aggregators: `aggSum` `aggAvg` `aggMin` `aggMax` `aggCount` `aggCountD` `aggStr(sep)` `aggStrD(sep)` `cumSum` `cumCount` `cumCountD`

Limitation: to aggregate a value from a sub-object, use `:print` first:
```
{d[].qty:print(.sub.price):aggSum}
```

`:aggSum` also works when the root `d` is an array with nested loops (v5.4.2+):
```
{d[].sub[].val:aggSum}
```

### 7c. Store and Transform — `:set` (ENTERPRISE, v5+ / v4 with `{o.preReleaseFeatureIn=4022011}`)

Store into `c.`: `{d.cars[].qty:aggSum:set(c.mySum)}` / `Total: {c.mySum}`
Add attribute to items: `{d.cars[].qty:append(' tyres'):set(.newInfo)}`
Clone array: `{d.myArray[]:set(c.new[])}` / `{d.myArray[].country:set(c.newArr[].country)}`
Distinct merge into nested: `{d[].city:set(c.countries[id=.country].cities[].name)}`

**Rules**: tags using `:set` print nothing. Use `c.` for new data. Alphanumeric keys only. `[i]` cannot be used with `:set`.

For complex `:set` patterns (dynamic URLs, type conversion, newest date from list, multi-aggregation conditions, filtering parent by child content, paginating into N-column rows, JSON restructuring, grouping flat lists, pairing sibling arrays, dynamic object keys) → read `references/set-patterns.md`.

---

## 8. Advanced Features

### 8a. Dynamic pictures (ENTERPRISE, v3+)
Insert a placeholder image in the template, then write the Carbone tag in the image's **alternative text** (not inline in text):
```
{d.imageUrl}
```
Supports public URLs and Base64 Data URIs. Templates: DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, HTML, Markdown (PDF as output only — a PDF form template has no pictures).

**`:imageFit(option)`** — controls how the replacement image is resized to fit the placeholder (DOCX, PPTX, ODT — XLSX always stretches it to the placeholder):
- `fillWidth` (default) — fills the full width while keeping aspect ratio
- `contain` — fits within the placeholder box while keeping aspect ratio
- `fill` — stretches to fill the entire placeholder box

```
{d.myImage:imageFit(contain)}
```
If the image URL is missing or invalid, Carbone inserts a default SVG (square with a cross). Where to write the tag in each format, and loops of pictures → `references/advanced-features.md`.

### 8b. Barcodes (ENTERPRISE, v3.4.6+)
Insert a placeholder image, write in its **alternative text** (in HTML and Markdown templates, put the tag in `<img src="">` instead — Markdown since v5.13.0):
```
{d.code:barcode(qrcode)}
{d.code:barcode(code128)}
{d.code:barcode(qrcode, svg:true)}              ← vector SVG, better print quality
{d.code:barcode(ean13, width:200, height:100)}  ← custom dimensions (mm)
```
Common barcode options (second argument, `key:value` format): `width`, `height`, `scale` (1–10), `includetext` (true/false), `textsize`, `textxalign` (left/center/right/justify), `textyalign` (below/center/above), `rotate` (N/R/L/I), `barcolor` (#RRGGBB), `textcolor` (#RRGGBB), `backgroundcolor` (#RRGGBB), `eclevel` (L/M/Q/H — QR only). `scale` defaults to 3. Limits (v5.14.4+): `width`/`height` max 1,000 mm and `textsize` max 100 pt — a bigger value is ignored; above 25 million pixels (`scale` included) the barcode is replaced by the error image.
Carbone supports 107 barcode types. If the barcode value is missing or invalid, Carbone inserts a default SVG (square with a cross). Sizing, GS1-128 values and barcode fonts → `references/advanced-features.md`.

### 8c. Colors (ENTERPRISE, v4.17+)
`:color(scope, type)` — injects color from data into the document element. The tag prints nothing. Color must be 6-digit hex (e.g. `FF0000` or `#FF0000`). Scopes: `p`, `row`, `cell`, `shape`, `part`. Types: `text` (default), `highlight`, `background`, `border`. Templates: DOCX, ODT, ODS, ODP, PPTX, HTML, Markdown, SVG (PDF as output only, not a PDF template).
```
{d.statusColor:color(row, background)}
{d.textHex:ifEQ('ok'):show(007700):elseShow(FF0000):color(p)}
```
For full scope/type tables, limitations, and the `{bindColor}` tag (legacy) → read `references/advanced-features.md`.

### 8d. HTML content rendering (ENTERPRISE, v5+)
`:html` renders an HTML string as native document formatting in ODT, DOCX, HTML, and Markdown templates (PDF reached via conversion). Quick example: `{d.richContent:html}` or `{d.notes:convCRLF:html}` (convert `\n` to `<br>` first).
Basic text, lists, links and images work out of the box; headings and tables need `{o.preReleaseFeatureIn=5002000}` and the richer elements need `5011000`. For the element list, CSS, options and themes (`tabletheme`, `headingtheme`, `quotetheme`), page breaks, entities, and common patterns → `references/advanced-features.md` "`:html` Formatter — Full Reference".

### 8e. Hyperlinks (ENTERPRISE, v3+)
Set the URL of a hyperlink (in your editor) to a Carbone tag, e.g. `{d.url}`. Works in DOCX, XLSX, PPTX, ODT, ODS, ODP, ODG, HTML, Markdown. Use `:defaultURL('fallback')` if the URL may be invalid. Edge cases (XLSX syntax, mixed URLs) → `references/advanced-features.md`.

### 8f. i18n / Translations
- Static text: `{t(key)}` in template + localization dictionary JSON — no quotes (they would become part of the key); spaces are allowed, `{t(key with space)}`. If a text editor splits the spaced key and the tag stops resolving, wrap it in `:print`: `{d:print('{t(key with space)}')}`
- Dynamic value: `{d.status:t}` — looks up the value in the translation dictionary
- Use locale-aware formatters for numbers/dates/currencies: `:formatN`, `:formatD`, `:formatC`, `:formatI`

### 8g. File operations (ENTERPRISE, v4.22+)
Append PDF files at the end (or start) of the generated PDF:
```
{d.products[i].datasheet:appendFile}           ← append at end (default)
{d.products[i].datasheet:appendFile('start')}  ← append at start
```
Attach a file inside a PDF (Factur-X, ZUGFeRD) — `:attachFile(name, type)`, `name` defaults to `factur-x.xml`; the optional `type` is the PDF relationship `Data` (default), `Source`, `Alternative`, `Supplement`, `Unspecified`, `FormData` or `Schema`, never a MIME type:
```
{d.invoiceXml:attachFile('factur-x.xml')}
```

**`:appendTemplate(templateIdOrVersionId, position?)`** (v5.0.3+) — generate another stored template with the current data and append its PDF output. Each iterated array item becomes the root `{d.}` of the nested template. The tag prints nothing.
```
{d.orders[i]:appendTemplate(110212)} {d.orders[i+1]}
```
**PDF output only** — silently ignored if the final render format is DOCX/XLSX/ODT/etc. Only the following render options are forwarded to the nested template: `lang`, `timezone`, `currencySource`, `currencyTarget`, `currencyRates`, `converter`, `enum`, `translations`, and complement data (`{c.}`). Other options (`hardRefresh`, `useHighPrecisionArithmetic`, `exportFormattedValuesAsText`, `preReleaseFeatureIn`, …) are **not** forwarded. A nested template cannot itself call `:appendTemplate` (no recursion).

### 8h. Digital signatures (ENTERPRISE, BETA — v5+)
Marks a signature field; the tag prints nothing. Render to PDF with the `carbone-version: 5` header: the response gives each field's value, page and x/y. Write the tag in Arial or Calibri, opening `{` in the background color — rules → `references/advanced-features.md`:
```
{d.signatureBuyer:sign}
```

### 8i. Transform / move shapes (ENTERPRISE, v5+ / v4.22.11+ with `{o.preReleaseFeatureIn=4022011}`)
Move a shape or picture on the X or Y axis in PPTX/ODP/ODT, from its alt text or its text (prints nothing; positive = right/down): `{d.offset:transform(x, cm)}`. Units: `cm`, `mm`, `in` (or `inch`), `pt`. Never on a line or a group (render error).
Repeated shapes and layer order → `references/pptx-tips.md`; full rules → `references/advanced-features.md`.

### 8j. SVG templates
SVG files can be used as Carbone input templates. Write tags inside HTML comments (`<!-- {d.value:svgUpdate(...)} -->`). Use `:svgUpdate(attrName, selectorValue, selectorType)` to update attributes, or `:svgSelectiveUpdate` to select and inject. Full syntax → `references/advanced-features.md`.

### 8k. Dynamic Forms — ODT Text Fields and Checkboxes (ENTERPRISE, v3.3+)
ODT editable text fields and clickable checkboxes (LibreOffice only). Checkbox alternatives that work in any format: `{d.value:ifEQ(true):show(☑):elseShow(☐)}` (unicode) or emoji. Full setup steps → `references/advanced-features.md`.

### 8l. Native Charts (ENTERPRISE, v4+)
Four chart types: native DOCX/PPTX charts (loop tags in the embedded Excel sheet), native XLSX charts whose series cover the loop rows (they grow with `{o.preReleaseFeatureIn=5018000}`, `references/xlsx-tips.md`), ODT/LibreOffice charts (`{bindChart(refValue) = d.tag}` in the Data Table), and ECharts via `:chart` formatter in the alt text of a placeholder image — or in `<img src="">` for HTML and Markdown templates (Markdown since v5.13.0). If the chart config is missing or malformed, Carbone inserts a default SVG (square with a cross). For full syntax and examples → read `references/advanced-features.md`.

> **Missing/invalid image or barcode/chart value**: Carbone always inserts a default SVG placeholder (square with a cross). Use `{d.field:ifEM():drop(img)}` in the same alt-text to remove the element entirely when the value is absent.

### 8m. PDF templates — form filling (ENTERPRISE, v5+)
A fillable PDF (AcroForm) can be used **as the template**; output stays PDF. Tags go in the field value, in an annotation over the field (`:fill` `:check` `:uncheck`), or target a field by name anywhere (`:fillField('name')` `:checkField('name')`).
A PDF template supports **no** pictures, colors, `:html`, charts, barcodes, hyperlinks, `:transform`, file operations or signatures — never suggest them here. Full guide → `references/pdf-templates.md`.

---

## 9. Design Best Practices

### Editor configuration (critical!)
Text editors auto-replace straight quotes `'` with "smart quotes" — **Carbone only accepts straight single quotes** in formatter parameters.

- **MS Word**: `Tools > AutoCorrect Options > AutoFormat As You Type` → uncheck "Straight quotes with smart quotes"
- **LibreOffice**: `Tools > AutoCorrect > Localized Options` → disable Replace for single and double quotes

### Tag styling
Only the font style and size of the **first `{` character** applies to the output. You can make the rest of the tag tiny (e.g. size 1pt) to reduce visual clutter in the template.

### Template type choice
- **PDF with high styling control**: use HTML — full CSS, paper size and margins via `<carbone-pdf-options>`, one header/footer for every page via `<carbone-pdf-header>`/`<carbone-pdf-footer>`
- **PDF from a document template**: use DOCX or ODT — better pagination, text overflow handling
- **Presentations**: PPTX uses absolute positioning — shapes below a looped table or list don't move, and loops can't create slides or table columns (paginate manually with filters, or use an ODP template rendered with `"convertTo": "pptx"` — `references/pptx-tips.md`)
- **Spreadsheets**: formulas recalculate after Carbone injection; use `:formatN` so tags output native numbers not strings — this is also how percentage/currency/accounting/date cell formats apply (`:formatN` is the only way to force native-number output in XLSX/ODS; `:formatC`, `:formatD` and `:formatN(2, acc)` write text; see `references/xlsx-tips.md`). ODS can generate one sheet per array item via aliases in the sheet tab names — XLSX cannot (convert the ODS report to XLSX)
- **An existing fillable form you cannot rebuild**: use the PDF itself as the template — form filling only (`references/pdf-templates.md`)

Known input formats: PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP, HTML, MD, CSV, TXT, XML, SVG, ODG, IDML — plus any other XML-based or text file (see the format-agnostic principle above). All support the core language; enterprise features are format-specific and vary a lot — check `references/format-support.md` before promising images, colors, `:html`, charts or barcodes in a given format.

### XLSX/ODS — formula rules
Carbone tags and Excel formulas must be in **separate cells**. XLSX + `{o.preReleaseFeatureIn=5018000}` (v5.18.0+): formulas, merged cells, conditional formatting, tables, charts and pivot tables follow the loop rows like an Excel row insertion — draw ranges over the `[i]` and `[i+1]` rows (`=SUM(D4:D5)` becomes `=SUM(D4:D13)`). ODS, or XLSX without the tag: use aggregators `{d.items[].qty:aggSum:formatN}` or `INDIRECT`+`ROW`. `{d.rows[i].country:mergeCell}` merges identical consecutive values of a column (XLSX only, no tag needed). Details → `references/xlsx-tips.md`.

### Removing the trailing comma/separator in a loop
Place the separator in its own paragraph alongside a drop tag. The tag drops that paragraph only for the last item (`i=-1`); for all earlier items the paragraph is kept:
```
{d.items[i]}
; {d.items[i, i=-1]:drop(p)}     ← separator paragraph — dropped for the last item
{d.items[i+1]}
```
Data `["A","B","C"]` → outputs `A`, `;`, `B`, `;`, `C` (no trailing semicolon). With an array of objects, the drop tag must read an attribute that is always present: `{d.items[i, i=-1].id:drop(p)}`.

Alternatives when you only need a flat string — no loop required:
```
{d.items:arrayJoin('; ')}              ← join with separator
{d.items[].name:aggStr('; ')}          ← aggregate field from array of objects
```

### Prefer `:drop` over `hideBegin/hideEnd`
`:drop` is simpler, cleaner, and removes the element without leaving empty space. Use `hideBegin/hideEnd` only when you need to hide large multi-element blocks.

### Loop iterator casing
Use lowercase `i` for loop iterators — `{d.array[i].field}` / `{d.array[i+1]}`. Carbone also accepts uppercase `I`, but lowercase is the convention in all official documentation and avoids confusion with alias names.

### Floating elements in loops
Avoid floating images, shapes, or text boxes inside Carbone loops. Set pictures **In Line with Text** (DOCX) or anchor them **As Character** (ODT): a floating picture is not repeated (DOCX) or stops the render (ODT). PPTX/ODP/XLSX → `references/advanced-features.md`.

### `{bindColor}` reference colors
Carbone replaces a reference color on **every** element that uses it, and each reference color can be bound only **once** — pick a color used nowhere else in the template. In a loop, fill the repeated row with it and bind it to the item: `{bindColor(e3e8ee, #hexa) = d.accounts[i].color}` gives one color per row.

### Deprecated formatters
Full list of deprecated formatters and their modern replacements → `references/formatters.md` (sections "Legacy condition formatters" and "Other deprecated formatters").

---

## 10. Validation Checklist

When asked to validate a Carbone tag, check:

1. **Braces** — `{` and `}`, NOT `{{` (that's Mustache, not Carbone)
2. **Correct prefix** — `d.`, `c.`, `#`, `$`, `t(`, `o.`
3. **No spaces in tag name** — `{d.first name}` is invalid → use `{d.firstName}`
4. **Dot notation** — properties separated by `.`, arrays with `[index]`
5. **Formatter separator** — `:` not `.` or `|`
6. **Formatter argument quoting** — arguments may be written with or without single quotes: `:formatD(DD/MM/YYYY)` and `:formatD('DD/MM/YYYY')` are both valid, as are `:convEnum(STATUS)` and `:convEnum('STATUS')`. Single quotes are **required** only when the argument contains a **space** — Carbone trims unquoted spaces (see item 19). Double quotes are never valid (see item 18)
7. **Formatters must be chained, not nested** — `{d.value:add(20):sub(10)}` ✅ — `{d.value:add(20:sub(10))}` ❌ (nesting doesn't work)
8. **Loop end-marker** — every `[i]` block needs a matching `[i+1]`. **Vertical** loop (grows down): one `[i+1]` **row** closes the whole block (§4a). **Horizontal** loop (grows sideways): detected per-row, so **each** `[i]` tag needs its own `[i+1]` in the column to its right — one marker is not enough (see `references/loops-advanced.md` "Horizontal loop"). A pre-release code below `5000000` (e.g. `{o.preReleaseFeatureIn=4025011}`, v5.13.0+) silences this error for legacy v4 templates — a migration aid, not a fix
9. **`showBegin/showEnd` and `hideBegin/hideEnd` must always be paired** — a missing `showEnd` will break the document
10. **Never interleave two loops** — this corrupts the document:
    ```
    ❌ {d.fruits[i].name} {d.vegetables[i].name} {d.fruits[i+1].name}
       {d.vegetables[i+1].name}
    ```
    Each loop's `[i]` and `[i+1]` must stay together as a complete block:
    ```
    ✅ {d.fruits[i].name} {d.fruits[i+1].name}
       {d.vegetables[i].name} {d.vegetables[i+1].name}
    ```
    If you need to **access data from multiple different arrays within the same loop row**, use **Lookups** (`references/loops-advanced.md`). Lookups let you reach into any other array from inside a single loop — there is no limit on how many different arrays you can access this way, and no risk of interleaving corruption.
11. **Sorting** — uses attribute name as iterator (e.g. `[power, i]` / `[power+1, i+1]`), NOT `sortAsc()`/`sortDesc()` functions
12. **Filtering** — uses `[i, prop > value]` directly in brackets, NOT a `where()` function
13. **Grouping** — uses attribute name `[brand]`/`[brand+1]`, NOT a `groupBy()` function
14. **Condition chaining** — a logical operator (`:ifEQ` etc.) must be followed by `:show`, `:elseShow`, `:hideBegin/End`, `:showBegin/End`, or `:drop`/`:keep`
15. **`:drop` / `:keep` / `:set` / `:sign`** — these all print **nothing** in the output
16. **Dynamic images** — must be a full Data-URI (`data:image/jpeg;base64,...`) or a public URL — pure base64 without the prefix is not supported
17. **`:isImage` vs `:imageFit`** — `:isImage` is a private internal method; use `:imageFit(contain|fill|fillWidth)` for image resizing
18. **Double quotes are never valid in tags** — use single quotes everywhere: formatter args `{d.date:formatD('LL')}` and array filter values `[key='value']`. Double quotes in either location cause a rendering error.
19. **Space in `show()` without quotes** — `show(40 FT)` outputs `40FT`; use `show('40 FT')` — unquoted spaces are dropped
20. **Attributes after `[i+1]` are ignored** — the marker only closes the loop and prints nothing, so `{d.arr[i+1].name}` and `{d.arr[i+1]}` render identically; both are valid, never expect `.name` to be printed there
21. **Missing `.` between `[index]` and next key** — `{d.items[0]products.value}` gives empty output; must be `{d.items[0].products.value}`
22. **Alias must start with a data path or a filter expression** — `{#flag=0:ifEM():hideBegin}` is invalid because `0` is not a Carbone data path. Aliases normally start with `d.`, `c.`, or a `$param` reference. Exception: a **filter-expression alias** (used inside `[]` brackets to share a reusable filter) starts with a bare field name, e.g. `{#incCrit = criticality.code!='-1'}` — see `references/aliases.md` "Alias as filter"
23. **Never use spaces inside a tag** — Carbone trims spaces between any structural elements (`{`, `d`, `.`, field names, `[]`, `:`, `}`, etc.) so `{d.photo :imageFit(contain)}` technically works, but this is bad practice and should never be written intentionally
24. **Double colon `::` is invalid** — `{d.value:aggSum::formatN(2)}` creates an empty formatter name and will cause a rendering error; remove the extra colon
25. **An alias cannot reference another alias** — neither as the right-hand side of a declaration (`{#x = $y}`) nor as a formatter argument inside one (`{#x = d.value:ifEM:show($y)}`). An alias declaration's right-hand side must be built only from `d.`/`c.` data paths or a filter expression — no `{$alias}` references anywhere inside. To pull an aliased object's sibling into a condition argument, use a relative path (`.field` / `..field`) instead
26. **No control-flow statements** — Carbone is declarative: `{if}`, `{#if}`, `{% for %}`, `{/if}`, `{endfor}` and every variant of them do not exist. Repetition is the `[i]` / `[i+1]` pattern (§4), conditions are formatters (§6). A tag shaped like a statement was imported from another language

---

## Reference files

Read these when the user's question goes beyond what SKILL.md covers:

- `references/formatters.md` — complete formatter list with parameters and examples. Read when verifying a formatter name, checking parameters, or reviewing deprecated formatters.
- `references/aliases.md` — `{#}` / `{$}` alias patterns: filter aliases, object-pick, frozen-index, loop shorthand, looping over alias arrays. Read when user asks about aliases.
- `references/loops-advanced.md` — bidirectional loops, sorting, distinct, lookup/JOIN, parallel loops, primitive/nested arrays, object attribute search, row repetition. Read when user asks about sorting, lookup, bidirectional or parallel loops.
- `references/set-patterns.md` — advanced `:set` patterns: dynamic URLs, type conversion, JSON restructuring, list grouping, N-column pagination, dynamic object keys. Read when user needs complex data transformation or multi-step `:set`.
- `references/html-templates.md` — inline CSS injection, `:chart`, barcodes, `<carbone-pdf-header/footer>`, page breaks, `<carbone-pdf-options>`. Read when user asks about HTML templates, CSS, PDF options.
- `references/markdown-templates.md` — Markdown table loops, barcodes and charts, limitations, convert to PDF/DOCX/ODT. Read when user asks about Markdown templates.
- `references/pdf-templates.md` — fillable PDF (AcroForm) as a template: the three tag-placement methods, `:fill`/`:check`/`:fillField`, unsupported features, gotchas. Read when user asks about PDF templates or filling PDF form fields.
- `references/format-support.md` — the 15 input formats, which enterprise feature works in which, output formats, CSV/TXT/XML and IDML templates, format-specific limitations. Read when user asks which format to use or whether a feature works in a given format.
- `references/in-template-options.md` — all `{o.}` in-template options with descriptions and version requirements, plus how `preReleaseFeatureIn` version codes work (including v4 compatibility mode). Read when user asks about timezone, lang, converter, or pre-release flags.
- `references/advanced-features.md` — dynamic pictures per format (tag placement, loops), barcode sizing and fonts, full `:color` reference and `{bindColor}`, `:html` options and page breaks, hyperlink edge cases, file operations, `:sign` rules, `:transform`, SVG templates, ODT forms, native charts. Read when user asks about pictures, barcodes, color formatting, file operations, signatures, transform, SVG, ODT forms, or ECharts.
- `references/xlsx-tips.md` — XLSX/ODS: formulas, merged cells, tables, charts and pivot tables that follow loop rows (`5018000`), `:mergeCell`, native numbers vs text (cell number formats, accounting), aggregator totals, `INDIRECT`+`ROW` and `MATCH`/`INDEX` without the tag, frozen panes, pictures and sheet names in XLSX, line breaks in a cell, one sheet per item (ODS). Read when user asks about Excel formulas, totals, merged cells or number formats in spreadsheet templates.
- `references/docx-tips.md` — DOCX/ODT section rules, cross-section loop values, floating text boxes, page numbers/table headers/TOC, list and heading-plus-table loops, one page per item, page breaks in loops, `showBegin`/`showEnd` placement, picture anchoring in loops, merged cells in loops, LibreOffice newspaper columns. Read when user asks about Word headers/footers, "missing i+1" in a header, page numbers, list or page loops, empty paragraphs left by blocks, pictures not repeating, merged cells, or horizontal repetition.
- `references/pptx-tips.md` — PowerPoint templates: where tags go, fixed positions, bullet and nested-table loops, one slide per item via ODP, moving repeated shapes with `:transform`, `:drop` placement, PPTX `:color` limits, native charts. Read when user designs or debugs a PPTX template.
- `references/upgrade-guide.md` — upgrading Carbone versions: breaking changes, `carbone-version` header, `templateId` vs `versionId`. Read when user asks about upgrading or migration.
- `references/practical-examples.md` — real-world combinations: conditional visibility (optional blocks, table/row hiding, NaN guard, range checks, checkboxes), date formatting, aggregation patterns, complement data, chained formatters, `..` in formatter args. Read when user asks for practical examples, real-world patterns, or complex conditional logic.

Official docs: https://carbone.io/documentation/design/overview/getting-started.html (HTML) · https://carbone.io/llms.txt (LLM-friendly index) · https://carbone.io/llms-full.txt (single-file for verification & diffs)