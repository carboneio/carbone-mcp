# Carbone Advanced Features Reference

Read this file when the user asks for full details on: dynamic pictures (where to write the tag in each format, loops of pictures, anchoring, sizing), barcodes (sizing, GS1-128 values, barcode fonts), the `:color` formatter (scopes, types, limitations) and the `{bindColor}` tag, the `:html` formatter (full reference — supported elements, CSS, options and themes, page breaks, task-list checkboxes, entities, common patterns), native charts (DOCX, ODT/LibreOffice `bindChart`, ECharts), hyperlink edge cases, file operations (`:appendFile`, `:appendTemplate`, `:attachFile`), electronic signature fields (`:sign`), moving shapes with `:transform`, SVG templates, ODT dynamic forms, or removing placeholder images when value is empty.

---

## Dynamic pictures — placement, loops and sizing (ENTERPRISE, v3+)

Insert a temporary picture, then write the tag where the format reads it:

| Template | Where to write the tag on the temporary picture |
|---|---|
| DOCX, XLSX | Alt text, title or description (Word: right-click > Edit Alt Text) |
| PPTX | Alt text (right-click > View Alt Text) |
| ODT | Alternative text (right-click > Properties > Options > Text Alternative) or description |
| ODS, ODP, ODG | Image title |

The value is a public URL or a Base64 data URI (`data:image/png;base64,...`); accepted image types are `jpeg`, `png`, `gif` and `svg`. The image takes the width of the temporary picture and keeps its own proportions (`fillWidth`); change this with `:imageFit` in DOCX, PPTX and ODT. In XLSX the image is stretched to the size of the temporary picture — give the picture the proportions of the images.

**Loops of pictures** — one temporary picture in the repeated row, with the item's tag in its alt text (`{d.damages[i].photo}`), is enough. Whether the loop repeats it depends on the format:
- **DOCX**: only a picture **In Line with Text** is repeated; a floating one is replaced once but not repeated.
- **ODT**: anchor it **As Character**; a loop of floating pictures stops the render with an error — in ODG too. Setup steps → `docx-tips.md` "Pictures in loops".
- **PPTX**: a loop repeats the picture at the same place; move each copy with `:transform` (see "Transform" below).
- **ODP**: loop over slides, one slide per item.
- **XLSX**: a picture tag in a loop stops the render with an error; a picture in the repeated row is not repeated.

---

## Barcodes — sizing, values and fonts (ENTERPRISE, v3.4.6+)

One temporary picture per barcode, with the tag in its alt text (placement per format as for pictures above):
```
{d.ean:barcode(ean13, scale:6)}
{d.url:barcode(qrcode, scale:6)}
{d.gs1:barcode(gs1-128, scale:6)}
```
```json
{ "ean": "9520012345674", "url": "https://example.com/setup", "gs1": "(01)09520012345674(21)58201734" }
```
- Carbone keeps the width of the temporary picture and sets the height from the barcode (XLSX stretches it to the picture). Give the picture the proportions of the barcode — a square for a QR code — or fit it inside with `{d.url:barcode(qrcode, scale:6):imageFit(contain)}`.
- `scale` sets the resolution, from 1 to 10 (default `3`); `scale:6` keeps the bars sharp in print.
- GS1-128 values carry their Application Identifiers in parentheses: `(01)` for the GTIN, `(21)` for the serial number.

**Barcodes as font** (former method, 4 types — prefer the image method). Install the font on the computer that edits the template: `ean13` and `ean8` → *Code EAN13*, `code39` → *Code 3 de 9*, `code128` (`ean128` is the same code) → *Code 128*. Write the tag as text and apply the barcode font and size to its opening `{` (or to the whole tag) — the output takes the format of that first character:
```
{d.ean13:barcode(ean13)}
{d.sku:barcode(code39)}
{d.sku}
```
```json
{ "ean13": "9520012345674", "sku": "LP14-16-512" }
```
- EAN values need every digit, check digit included: 13 for `ean13`, 8 for `ean8`. Code 39 accepts uppercase letters, digits, spaces and `- . $ / + %`. An invalid value prints nothing.
- The EAN font prints the digits under the bars; the Code 39 and Code 128 fonts print bars only — add the value as text, like `{d.sku}` above.
- Converting the report (to PDF, for example) needs the fonts installed where the conversion runs.

---

## Colors — full reference (ENTERPRISE, v4.17+)

`:color(scope, type)` — the tag prints nothing in the document. Color must be **6-digit hex**, with or without `#` (e.g. `FF0000` or `#FF0000`). Invalid colors are replaced with light gray `#888888`.

**Compatible templates**: DOCX, ODT, ODS, ODP, PPTX, HTML, Markdown, SVG — a colored PDF is obtained by converting one of these. A **PDF used as a template** does not support `:color` (see `pdf-templates.md`). Not available in Embedded Carbone JS.

| `scope` | Element targeted |
|---|---|
| `p` or `paragraph` | Current paragraph (default) |
| `row` | Current table row |
| `cell` | Current table cell |
| `shape` | Current shape |
| `part` | Inline section within a paragraph (ODT only) |

| `type` | What changes |
|---|---|
| `text` | Text color (default) |
| `highlight` | Text highlight color (**not supported in DOCX**) |
| `background` | Background of cell, row, or shape |
| `border` | Border of shape only |

```
{d.statusColor:color(row, background)}
{d.textHex:ifEQ('ok'):show(007700):elseShow(FF0000):color(p)}
```

**Rules and limitations:**
- Overlapping colors: a color applied to the paragraph wins over a color applied to the shape, cell or row
- `part` (ODT only): place the `:color(part)` tag right next to the text to color, select that text together with its tags, click **Clear Direct Formatting**, then reapply the font style — the cleared span is the colored section
- HTML: the color is set in the `style` attribute of the selected `<tr>`, `<td>` or `<p>` only
- Cannot be used in aliases or combined with aggregators
- PPTX (v5.6.0+): scopes `row`, `cell`, `shape` (not `p`) with types `text`, `background`, `border` (`border` on shapes only) — table-cell caveats in `pptx-tips.md`
- For ODP (text, tables, shapes) and ODT (shapes only): a non-default style must already be applied to the target element in the template
- Complex nested tables with colors on sub-tables are not fully supported

**`{bindColor}` tag (former method — prefer `:color`)** — ODT, ODP, ODS, DOCX:
```
{bindColor(myColorRef, format) = d.myVar}
```
- `myColorRef` is a hex color applied in the template (case-insensitive, `#` optional). Carbone replaces it on **every** element that uses it — pick a color used nowhere else, and bind each reference color only once
- Write the tag anywhere: end of the document, header, footer, or below the `[i+1]` row even when `d.myVar` belongs to the loop. It is removed from the report
- Works on text colors, text backgrounds and table-cell backgrounds; in DOCX also on shape backgrounds and line colors (tag in the document body, not in the shape's alt text; the shape needs an RGB color, not a theme color)

| `format` | Value of `d.myVar` |
|---|---|
| `#hexa` | `"#FF0000"` |
| `hexa` | `"FF0000"` |
| `color` | `"red"` — one of 17 names: `yellow`, `green`, `cyan`, `magenta`, `blue`, `red`, `darkBlue`, `darkCyan`, `darkGreen`, `darkMagenta`, `darkRed`, `darkYellow`, `darkGray`, `lightGray`, `black`, `white`, `transparent` |
| `rgb` | `{ "r": 255, "g": 0, "b": 0 }`, each 0–255 |
| `hsl` | `{ "h": 0, "s": 100, "l": 50 }`, `h` 0–360, `s` and `l` 0–100 (or all three 0–1) |

With `#hexa` / `hexa`, a data value that is not hexadecimal (3 to 6 hex digits, optional `#`) is ignored and the element keeps its inherited color (v5.14.4+).

**Word text highlight** accepts only a color name: apply a highlight in the template, then bind it by name with the `color` format (every name except `transparent`). Text colors, cell backgrounds and text shading (Borders and Shading > Shading) take hex colors:
```
{bindColor(lightGray, color) = d.highlight}
{bindColor(e3e8ee, #hexa) = d.status.background}
```

**One color per loop row** — fill the cells of the repeated row with the reference color, then bind it to the current item; the tag can sit below the loop:
```
{d.accounts[i].customer}   {d.accounts[i].status}     ← cells filled with #E3E8EE
{d.accounts[i+1].customer}
{bindColor(e3e8ee, #hexa) = d.accounts[i].color}
```
```json
{ "accounts": [ { "customer": "Acme Corporation", "status": "Overdue", "color": "#FDE8E8" }, { "customer": "Orbit Analytics", "status": "Paid", "color": "#DCFCE7" } ] }
```

---

## Native Charts (ENTERPRISE, v4+)

### DOCX/Word and PPTX/PowerPoint
Insert a chart via `Insert > Chart`, edit the embedded Excel spreadsheet with Carbone loop tags directly in cell values:
```
{d.temps[i].date}   {d.temps[i].min}   {d.temps[i].max}
{d.temps[i+1].date} {d.temps[i+1].min} {d.temps[i+1].max}
```
⚠️ Each `[i]` expression must have its own `[i+1]` on the next row — you cannot use a single `[i+1]` for multiple `[i]` tags.

Aliases work inside chart cells too — declare `{#income = d.income_type_summary}` in the document body, then loop the alias array:
```
{$income[i].itg_nm}
{$income[i+1].itg_nm}
```
Remove the chart when the array is empty: `{d.regions:ifEM:drop(chart)}` in its alt text.

### XLSX/Excel
A native chart whose series use the loop cells grows with the rows under `{o.preReleaseFeatureIn=5018000}` (v5.18.0+): draw the series over the `[i]` and `[i+1]` rows → `xlsx-tips.md`.

### ODT/LibreOffice
Insert a chart, edit the Data Table. Use `{bindChart(refValue) = d.tag}` in the Categories column to bind a JSON value to a chart reference value:
```
{d.cheeses[i].type} {bindChart(3)=d.cheeses[i].purchasedTonnes}
{d.cheeses[i+1].type} {bindChart(4)=d.cheeses[i+1].purchasedTonnes}
```
`bindChart(3)` means: replace the value `3` in the chart with the result of the tag.

### ECharts (all formats)
Insert a placeholder image, write `:chart` tag in its alt text:
```
{d.chartOptions:chart}
```
JSON must contain a full ECharts v5 config:
```json
{ "type": "echarts@v5a", "width": 600, "height": 400, "theme": null, "option": { /* ECharts config */ } }
```
Compatible with: ODT, ODS, ODP, ODG, DOCX, PPTX, XLSX, HTML, Markdown (v5.13.0+); PDF as output only, not a PDF form template. Use `echarts@v5a` (not `echarts@v5`) for better SVG compatibility.

**Chart from an indexed array** — when data contains an array of ECharts config objects, access each by index and chain `:imageFit` to fit the chart to the placeholder size:
```
{d.team_avg_chart[0]:chart:imageFit(contain)}
{d.team_avg_chart[1]:chart:imageFit(contain)}
{d.team_avg_chart[2]:chart:imageFit(contain)}
```
Each tag goes in a separate image placeholder alt-text. The number of placeholders in the template determines how many charts render.

---

## `:html` Formatter — Full Reference (ENTERPRISE, v5+)

`:html` converts an HTML string into native document formatting. Use it whenever JSON data contains an HTML payload that must render as styled content rather than escaped text. Without `:html`, the `<` and `>` characters are escaped and the raw HTML is shown as text.

```
{d.richContent:html}
{d.notes:convCRLF:html}    ← convert \r\n / \n to native line breaks first; with :html, \n becomes <br> (v3.5.3+)
```

**Compatible templates**: ODT, DOCX, HTML, Markdown — a PDF result is reached by converting one of these. `:html` does **not** work in a PDF template (a fillable PDF used as input, see `pdf-templates.md`), nor in XLSX/ODS/PPTX/ODP (on the roadmap).

### Supported HTML elements

| Category | Elements | Notes |
|---|---|---|
| Text formatting | `<b>` `<strong>` `<i>` `<em>` `<u>` `<s>` `<del>` | Always supported |
| Structure | `<p>` `<br>` | Always supported |
| Lists | `<ul>` `<ol>` `<li>` | Always supported |
| Links | `<a href="...">` | URL validated; use `:defaultURL` for fallback |
| Images | `<img src="..." width="X" height="Y">` | URL or Data-URI; size in px; default 5cm if missing |
| Headings | `<h1>` `<h2>` `<h3>` `<h4>` `<h5>` `<h6>` | Requires `{o.preReleaseFeatureIn=5002000}` |
| Tables | `<table>` `<tr>` `<th>` `<td>` with `colspan`/`rowspan` | Requires `{o.preReleaseFeatureIn=5002000}` (introduced in v5.0.9, significant fixes in v5.2.0 — use 5002000) |
| Inline semantics | `<sup>` `<sub>` `<mark>` `<code>` `<kbd>` `<samp>` | v5.11.0+, requires `{o.preReleaseFeatureIn=5011000}`. `<mark>` = fixed yellow highlight (color not customizable); `<code>`/`<kbd>`/`<samp>` = Courier New. Without the flag the content renders unformatted |
| Preformatted | `<pre>` | v5.11.0+, requires `{o.preReleaseFeatureIn=5011000}`. Courier New, preserves `\n` / `\r\n`; an empty paragraph is added after the block |
| Horizontal rule | `<hr>` | v5.13.0+, requires `{o.preReleaseFeatureIn=5011000}`. `0.5em` spacing above and below |
| Quotes | `<blockquote>` | v5.13.0+, requires `{o.preReleaseFeatureIn=5011000}`. Default indentation `40px`; style it with `quotetheme` |
| Task list checkbox | `<input type="checkbox">` | v5.13.0+, requires `{o.preReleaseFeatureIn=5011000}`. Other `<input>` types are ignored |

`<hr>`, `<blockquote>` and the checkbox work **everywhere**: inside lists, table cells, headings, and inside a paragraph — which `<hr>` splits in two while keeping the surrounding styles. Spacing and indentation reproduce a browser: `0.5em` around the rule, `40px` per `<blockquote>`, cumulative on each nesting level and added to the indentation of a list.

**Not supported** (ignored): `<tbody>` `<thead>` `<caption>`, `<input>` types other than `checkbox`, external stylesheets, `<style>` elements, CSS classes, CSS IDs.

### Supported CSS (inline `style` attribute only)

Support depends on the **template format**:

- **HTML template** → any inline CSS works, no restrictions (rendered by Chromium)
- **DOCX or ODT template** → only the following properties are supported:

| Property | Values |
|---|---|
| `color` | text color |
| `background-color` | background color |
| `break-before` | `page` — insert page break before `<p>` (requires `{o.preReleaseFeatureIn=5002000}`) |
| `break-after` | `page` — insert page break after `<p>` (requires `{o.preReleaseFeatureIn=5002000}`) |

Supported color formats for DOCX/ODT: hex (`#FF00BB`), RGB (`rgb(31,120,50)`), HSL (`hsl(120,75,25)`), named CSS colors (`red`, `lightseagreen`, etc.).

Page-break example:
```html
<p style="break-before:page">New page starts here</p>
<p style="break-after:page">Page break after this</p>
```
Page breaks apply to `<p>` only — not allowed in headers, footers, or table cells.

### Options (combinable with comma)

| Option | Effect | Example |
|---|---|---|
| `inline` | Render inside current paragraph. Only: `<a>` `<b>` `<strong>` `<em>` `<i>` `<s>` `<del>` `<u>` `<sup>` `<sub>` `<mark>` `<code>` `<kbd>` `<samp>` | `{d.v:html(inline)}` |
| `nospace` | Remove empty paragraph added after block elements: `<p>` `<h1>`–`<h6>` `<ul>` `<ol>` `<table>` `<pre>` | `{d.v:html(nospace)}` |
| `tabletheme:Name` | Apply named Word table theme to `<table>` (DOCX only) | `{d.v:html(tabletheme:GridTable2-Accent3)}` |
| `headingtheme:prefix` | Use custom heading styles `prefix1`…`prefix6` for `<h1>`–`<h6>` (themes must already exist in the template) | `{d.v:html(headingtheme:my-theme-)}` |
| `quotetheme:Name` | Apply a paragraph style of the template to `<blockquote>` instead of the default `40px` indentation (v5.13.0+) | `{d.v:html(quotetheme:Quote)}` |

Combine: `{d.value:html(nospace,headingtheme:my-theme-)}`

**`quotetheme` style names**: Word and LibreOffice both ship a `Quote` and an `Intense Quote` paragraph style by default. In ODT, a style name containing a space must be written the way ODF stores it — `Intense Quote` is passed as `Intense_20_Quote`:
```
{d.content:html(quotetheme:Quote)}
{d.content:html(quotetheme:Intense_20_Quote)}    ← ODT
```

### Task lists / checkboxes (v5.13.0+)

Requires `{o.preReleaseFeatureIn=5011000}`. A checkbox is **ticked** by the HTML `checked` attribute in any of its forms (`checked`, `checked=""`, `checked="checked"`), and unticked without it:
```html
<ul><li><input type="checkbox"> todo</li><li><input type="checkbox" checked> done</li></ul>
```
- In DOCX the checkbox stays **clickable in Word**; everywhere else it renders as a character (`☑` / `☐`)
- Like a browser, the bullet of a task item is not rendered
- Only `<input type="checkbox">` is rendered — all other input types are ignored

### Font and paragraph behaviour
- HTML content **inherits** font family and size from the template paragraph where the tag is placed
- Text alignment from the template is **not** retained
- By default, `:html` renders content in a **new paragraph**. Use `inline` to stay in the current paragraph
- Tab characters: use `&ensp;` or `&emsp;` — do NOT use `&#9;` (collapsed to space by HTML parsers)
- **ODT** (v5.13.0+): when no `headingtheme` is given, `<h1>`–`<h6>` use the template's built-in `Heading_20_1` … `Heading_20_6` styles
- Write the HTML payload with **lowercase element names, double-quoted attributes, and every tag closed** — uppercase names (`<P>`, `<BR>`) and single-quoted or unquoted attributes (`href='x'`, `href=x`) are only read with `{o.preReleaseFeatureIn=5011000}`

### HTML entities (v5.5.0+)
The `:html` formatter supports named, decimal, and hexadecimal HTML entities:
- Named: `&amp;` `&copy;` `&nbsp;`
- Decimal: `&#169;` `&#128512;`
- Hexadecimal: `&#xA9;` `&#x1F600;`
- Emoji supported as literal Unicode or numeric entities

### Common patterns

**Wrap dynamic HTML content before rendering** — `:prepend` and `:append` operate on the raw string; `:html` then renders the assembled result. Order matters — reversing it would render HTML before the wrapper tags are added:
```
{d.htmlContent:prepend('<ul>'):append('</ul>'):html}
```

**Choose between HTML blocks via a condition** — `:show` / `:elseShow` select which raw HTML to render, then `:html` renders the chosen branch:
```
{d.displayNote:ifEQ(true):show(d.noteSection):elseShow(d.nothingSection):html}
{d.isAdmin:ifEQ(true):show(d.adminPanel):elseShow(d.userPanel):html}
{d.showComment:ifEQ(true):show(.comment):elseShow(''):html}
```

**Render plain-text line breaks as HTML breaks** — chain `:convCRLF` before `:html` so `\n` becomes `<br>`:
```
{d.notes:convCRLF:html}
```

**Fallback URL for embedded links** — place `:defaultURL` before `:html`:
```
{d.content:defaultURL(.urlOnError):html}
```

---

## Hyperlinks — edge cases (ENTERPRISE, v3+)

- If no protocol is provided, Carbone automatically prepends `https://`
- You cannot mix a static URL with a dynamic tag in the same link — `https://carbone.io{d.path}` won't work; Carbone keeps only the dynamic part
- **XLSX only**: do NOT wrap the tag in `{}`. Use `d.url` (not `{d.url}`) as the hyperlink URL

**`:defaultURL(url)`** — if the injected URL fails validation, use this fallback:
```
{d.documentUrl:defaultURL('https://carbone.io')}
{d.url:defaultURL(.urlOnError)}          ← dynamic fallback
{d.content:defaultURL(.urlOnError):html} ← place before :html
```

---

## File operations — details (ENTERPRISE)

The three tags print nothing and act only when the report is rendered to PDF (`"convertTo": "pdf"`); other output formats ignore them. `:appendFile` and `:attachFile` take a URL or a Base64 data URI. An empty or undefined value is skipped.

**`:appendFile(where)`** (v4.22.0+) — in a loop, one PDF per item, appended in loop order. Each appended page keeps its own size and orientation (an A3 landscape datasheet stays A3 landscape). A URL that fails or a file that is not a valid PDF stops the render.
```
{d.products[i].name}
{d.products[i].model} {d.products[i].datasheet:appendFile}
{d.products[i+1].name}
```
```json
{ "products": [ { "name": "Solar panel 425 W", "model": "DS425-108M10T-03", "datasheet": "https://example.com/datasheets/ds425.pdf" } ] }
```

**`:appendTemplate(templateOrVersionId, position)`** (v5.0.3+) — pass the ID of a stored template (renders its latest deployed version) or a version ID (pins that version). Each loop item becomes the `{d}` of the nested template, which reads `{d.orderId}`, `{d.customer}` directly:
```
{d.orders[i]:appendTemplate(1550932030872181245)}{d.orders[i+1]}
{d:appendTemplate(110212, 'start')}      ← whole data, prepended instead of appended
```
A nested template that uses `:appendTemplate` itself fails with `Circular dependency detected in appendTemplate formatter`.

**`:attachFile(name, type)`** (v4.23.0+) — embeds a file inside the PDF, e.g. the XML of a Factur-X or ZUGFeRD invoice:
```
{d.invoiceXml:attachFile('factur-x.xml')}
{d.invoiceXml:attachFile('factur-x.xml', 'Alternative')}
```
- `name` defaults to `factur-x.xml`. With that name, Carbone detects the Factur-X conformance level from the XML and produces a PDF/A-3B, unless another PDF version is requested
- `type` is the PDF relationship of the attachment, not a MIME type: `Data` (default), `Source`, `Alternative`, `Supplement`, `Unspecified`, `FormData` or `Schema`

---

## Electronic signature fields — `:sign` (ENTERPRISE, BETA, v5+)

`:sign` marks where a person signs, dates or initials the document; the tag prints nothing. The value can be any JSON — store what the e-signature provider needs to invite the signer:
```
{d.client.signer:sign}
Date {d.client.signedOn:sign}
```
```json
{ "client": {
    "signer":   { "type": "signature", "name": "Emma Johnson", "email": "emma.johnson@bluebird.example" },
    "signedOn": { "type": "date",      "name": "Emma Johnson", "email": "emma.johnson@bluebird.example" } } }
```
Render to PDF (`"convertTo": "pdf"`) with the `carbone-version: 5` header. The render response lists every field in `data.signatures`: `data` (the tag value as sent, missing when undefined), `page` (first page = 1), `x` and `y` in points (1/72 inch) from the top-left corner of the page, `y` growing down. The array does not follow reading order — match fields by `data`. Other output formats return no positions and keep the markers.

- Write each `:sign` tag in **Arial or Calibri**: Carbone replaces it with a marker (`ʕ` + three digits) and looks for it in the PDF. With a font that lacks `ʕ` (Georgia, for example) the render fails with `Signature position No. 000 was not found in the generated PDF`
- Give the opening `{` of each tag the background color (white on a white page): the marker takes the format of that first character, so it does not show in the PDF. This also gives the exact `x` of a tag written after text on the same line
- Leave room below and to the right of each tag — the provider draws the field from the tag position
- Never remove a tag whose value is set with a condition: the render fails. To skip a field, leave its value undefined
- Up to 999 fields per document; a tag in a loop gives one field per item

---

## Transform — move shapes and pictures (ENTERPRISE, v4.22.11+)

`:transform(axis, unit)` moves a shape or a picture from its position in the template by the value of the tag: `x` moves it right (negative: left), `y` moves it down (negative: up). Units: `cm`, `mm`, `in` (or `inch`), `pt`. Templates: PPTX, ODP, ODT (PDF by conversion). Carbone v5 needs no pre-release tag; v4 needs `{o.preReleaseFeatureIn=4022011}`.

Write the tag in the alt text of the shape or picture, or in the shape's own text; it prints nothing. Several tags can share one alt text — chain `:mul` to turn data into a distance, here 10 mm right per effort point and 8 mm up per impact point:
```
{d.initiatives[i].effort:mul(10):transform(x, mm)} {d.initiatives[i].impact:mul(-8):transform(y, mm)}
```
```json
{ "initiatives": [ { "name": "Instant payouts", "effort": 4, "impact": 9 }, { "name": "Smart retries", "effort": 2, "impact": 7 } ] }
```
- When a loop spans several shapes, the shape holding the `[i+1]` tag must be **above** the `[i]` shapes in the layer order (right-click > Bring to Front)
- A `:transform` tag on a line or a group stops the render with an error — draw lines as thin rectangles and ungroup the shapes to move
- PPTX walkthroughs (one copy per loop index, a full matrix with colored shapes) → `pptx-tips.md`

---

## SVG templates

SVG files can be used as Carbone input templates. Write Carbone tags inside HTML comments in the SVG file.

**`:svgUpdate(attrName, selectorValue, selectorType)`** — update an SVG attribute on elements matching a selector:
```
{d.myTable[].width:svgUpdate('width', .id)}
```
- `attrName`: attribute to update (e.g. `'fill'`, `'stroke'`, `'width'`)
- `selectorValue`: value used to find the target element
- `selectorType`: `'id'` (exact match), `'id > *'` (direct children), `'id *'` (all descendants, default)

**`:svgSelectiveUpdate(attrName, attrValue, selectorType)`** — select elements and inject a value:
```
{d.myTable[active=true].id:svgSelectiveUpdate('fill', .color)}
```
Only basic SVG shapes are updated: `rect`, `circle`, `line`, `ellipse`, `polygon`, `polyline`, `path`.

---

## ODT Dynamic Forms — Text Fields and Checkboxes (ENTERPRISE, v3.3+)

**ODT editable text fields** (LibreOffice only, outputs ODT or PDF):
- In LibreOffice: `Form > Text Box` → draw box → disable Design Mode → place `{d.value}` inside
- Not supported in DOCX, XLSX, ODS, or ODT files created with MS Word

**Clickable checkboxes** (ODT/LibreOffice only):
- `Form > Check Box` → right-click → Control Properties → put tag in the **Name** property
- Checkbox is ticked when value is `true`, non-empty string, non-empty array, or non-empty object

**Checkbox alternatives that work in any format:**
```
{d.value:ifEQ(true):show(✅):elseShow(⬜️)}    ← emojis
{d.value:ifEQ(true):show(☑):elseShow(☐)}       ← unicode
{d.value:ifEQ(true):show(.img1):elseShow(.img2)} ← SVG dynamic images
```

---

## Removing placeholder images when value is empty

When a dynamic picture URL is invalid, a barcode value is incorrect, or an ECharts config is missing or malformed, Carbone inserts a default SVG image — a square with an X (cross). To remove the placeholder entirely instead, add a second tag in the **same alternative text** using `:drop(img)`.

**Dynamic picture:**
```
{d.imageUrl}{d.imageUrl:ifEM:drop(img)}
```

**Barcode:**
```
{d.number:barcode(ean13)}{d.number:ifEM:drop(img)}
```

**ECharts:**
```
{d.chartOptions:chart}{d.chartOptions:ifEM:drop(img)}
```

The `:drop(img)` tag prints nothing — if the condition is true, it removes the entire placeholder image from the document. Both tags must be placed in the image's alternative text.
