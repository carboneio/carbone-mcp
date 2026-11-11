# Carbone Advanced Features Reference

Read this file when the user asks for full details on: the `:color` formatter (scopes, types, limitations, `:bindColor`), the `:html` formatter (full reference — supported elements, CSS, options and themes, page breaks, task-list checkboxes, entities, common patterns), native charts (DOCX, ODT/LibreOffice `bindChart`, ECharts), hyperlink edge cases, SVG templates, ODT dynamic forms, or removing placeholder images when value is empty.

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

**Known limitations:**
- Cannot be used in aliases or combined with aggregators
- PPTX (v5.6.0+): all combinations of `scope` (row, cell, shape) and `type` (text, background, border) are supported; `border` applies to shapes only
- For ODP (text, tables, shapes) and ODT (shapes only): a non-default style must already be applied to the target element in the template
- Complex nested tables with colors on sub-tables are not fully supported

**`:bindColor` (old method — use `:color` instead)**
Static color replacement in template: `{bindColor(myColorRef, format) = d.myVar}`
- `myColorRef` is the placeholder color already applied in the template (used to identify what to replace)
- `format`: `#hexa`, `hexa`, `color` (named), `rgb` (object), `hsl` (object)
- With `#hexa` / `hexa`, a data value that is not hexadecimal (3 to 6 hex digits, optional `#`) is ignored and the element keeps its inherited color (v5.14.4+)
- For DOCX text **background**: only 17 named colors work (`yellow`, `green`, `cyan`, `magenta`, `blue`, `red`, `darkBlue`, `darkCyan`, `darkGreen`, `darkMagenta`, `darkRed`, `darkYellow`, `darkGray`, `lightGray`, `black`, `white`, `transparent`)

---

## Native Charts (ENTERPRISE, v4+)

### DOCX/Word
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
