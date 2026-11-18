# Carbone HTML Templates Reference

Read this file when the user asks about HTML templates or HTML to PDF/image: document structure and XHTML detection, value escaping in attributes, CSS and external resources, JavaScript, loops on rows/list items/blocks, nested loops and a table of contents, inline CSS/style injection, `:html` in HTML, `:drop`/`:keep` placement, show/hide blocks, pictures, ECharts and barcodes in `<img src>`, `:color` in HTML, hyperlinks in `href`, page breaks and one page per item, `<carbone-pdf-header>`/`<carbone-pdf-footer>` (page numbers, a different cover page), `<carbone-pdf-options>` (paper size, margins, orientation, page ranges, dynamic options), translations, comments, or output formats.

Version: 5.0+ | Rendered to PDF, PNG, JPG or WebP by a Chromium-based renderer; without `convertTo` the report stays HTML.

## Contents

- [Basics](#basics)
- [Loops](#loops)
- [Table of contents and one page per item](#table-of-contents-and-one-page-per-item)
- [Conditions](#conditions)
- [Pictures](#pictures)
- [Charts](#charts)
- [Barcodes](#barcodes)
- [Colors](#colors)
- [Hyperlinks](#hyperlinks)
- [Page breaks](#page-breaks)
- [Headers and footers](#headers-and-footers)
- [PDF options: `<carbone-pdf-options>`](#pdf-options-carbone-pdf-options)
- [Translations and comments](#translations-and-comments)

---

## Basics

An HTML template is a **complete document**: `<!DOCTYPE html>`, then `<html>` with its `<head>` and `<body>`. Carbone reads a file as HTML when it contains `<html`; a fragment without it that starts with a tag is read as XML, and Chromium refuses to turn it into a PDF. The examples below show only the relevant part of the body.

**Never put `xmlns` on `<html>` after a `<!DOCTYPE>`** (common in e-mail templates: `<html xmlns="http://www.w3.org/1999/xhtml">`). Carbone then reads the file as XHTML: `:drop`/`:keep` stop the render with `Formatter "drop" does not exist`, `:color` prints the hex value as text, and `:barcode` prints font text or nothing instead of an image. Remove the `xmlns` attribute.

Tags work anywhere in the markup (text, attribute values, CSS values, `src`, `href`, `style`, comments), and any valid HTML stays as written:
```html
<h1>Welcome, {d.user.firstName} {d.user.lastName}!</h1>
<p>Your membership level: {d.membershipLevel}</p>
```

**Escaping**: Carbone escapes `<`, `>` and `&` in values (`"a < b & c"` → `a &lt; b &amp; c`), **not quotes**. A value holding `"` ends a double-quoted attribute: `<p data-note="{d.note}">` with `"say \"hi\""` → `data-note="say "hi""` (broken). Quote the attribute with `'` when the value can contain `"`: `<p data-note='{d.note}'>`.

**CSS and resources**: the page is rendered by Chromium, so the full CSS applies (inline `style`, `<style>` blocks and external stylesheets). Carbone downloads the images, stylesheets and fonts of the page before the conversion; a resource that cannot be downloaded is not loaded. Use absolute URLs (relative paths are not supported). Animated CSS (`transition`, `animation`, `@keyframes`) does not apply: the output is static.

**JavaScript does not run** during the conversion: a `<script>` that writes content or draws a chart has no effect. Build the content with Carbone tags and the charts with `:chart` ([Charts](#charts)).

**`:html` in an HTML template** only stops the escaping: the string is inserted as is, so every element and CSS works, with no `:html` option and no pre-release flag (those apply to DOCX/ODT, `advanced-features.md` "`:html` Formatter: Full Reference"):
```html
<p>{d.welcomeMessage}</p>        ← "<strong>Welcome!</strong>" → &lt;strong&gt;Welcome!&lt;/strong&gt;
<p>{d.welcomeMessage:html}</p>   ← → <strong>Welcome!</strong>
{d.isAdmin:ifEQ(true):show(d.adminPanel):elseShow(d.userPanel):html}
```

---

## Loops

The usual `[i]` / `[i+1]` pair (SKILL.md §4). Carbone repeats the element that holds the `[i]` tag, at the level of the `[i+1]` tag, and removes the element that holds `[i+1]`:

```html
<table>
  <thead><tr><th>ID</th><th>Name</th><th>Role</th></tr></thead>
  <tbody>
    <tr>
      <td>{d.users[i].id}</td>
      <td>{d.users[i].name}</td>
      <td>{d.users[i].role}</td>
    </tr>
    <tr><td>{d.users[i+1]}</td></tr>
  </tbody>
</table>
```
`{"users": [{"id": 1, "name": "Alice", "role": "Admin"}, {"id": 2, "name": "Bob", "role": "Editor"}]}` → one `<tr>` per user, the `[i+1]` row removed.

The same placement works for any repeated element:
```html
<ul>
  <li>{d.items[i].name}</li>
  <li>{d.items[i+1]}</li>
</ul>
<div class="card"><span>{d.items[i].name}</span></div>
<div>{d.items[i+1]}</div>
```
→ `<ul><li>A</li><li>B</li></ul>` and one `<div class="card">` per item.

**Bare markers**: a tag on an object, written as text between elements, prints nothing and only marks the bounds: `{d.sections[i]}` before an `<li>` and `{d.sections[i+1]}` after its `</li>` repeat that `<li>`. Where the `[i+1]` tag sits decides what repeats: placed after a `</ul>`, it repeats the whole `<ul>` per item.

---

## Table of contents and one page per item

Nested loops, bare markers, anchor ids and a page break per section. The second loop closes both arrays with one end tag, `{d.sections[i+1].subSections[i+1]}`:

```html
<style>.page-break { page-break-before: always; break-before: page; }</style>
<ul class="toc_list">
  {d.sections[i]}
  <li>
    <a href="#section_{d.sections[i].id}">{d.sections[i].title}</a>
    <ul>
      <li><a href="#subSection_{d.sections[i].subSections[i].id}">{d.sections[i].subSections[i].title}</a></li>
    </ul>
    {d.sections[i].subSections[i+1]}
  </li>
  {d.sections[i+1]}
</ul>
<div>
  {d.sections[i]}
  <p class="page-break"></p>
  <h1 id="section_{d.sections[i].id}">{d.sections[i].title}</h1>
  <h2 id="subSection_{d.sections[i].subSections[i].id}">{d.sections[i].subSections[i].title}</h2>
  <p>{d.sections[i].subSections[i].content}</p>
  {d.sections[i+1].subSections[i+1]}
</div>
```
```json
{ "sections": [ { "id": 1, "title": "First", "subSections": [ { "id": 11, "title": "Sub 1", "content": "C11" }, { "id": 12, "title": "Sub 2", "content": "C12" } ] }, { "id": 2, "title": "Second", "subSections": [] } ] }
```
Result:
- TOC: `<li>` "First" with one `<ul>` per subsection (`#subSection_11`, `#subSection_12`, because the sub-loop end tag sits after `</ul>`), then `<li>` "Second" with no `<ul>` (an empty array removes the repeated block).
- Body: each section starts with `<p class="page-break">` (one page per section), its `<h1>` printed once, then one `<h2>` + `<p>` per subsection.

---

## Conditions

### 1. Inline CSS / style injection

Write the tag in a CSS value, among CSS properties, or as a whole attribute:

```html
<!-- CSS value: display:none hides and frees the space, visibility:hidden keeps the space, opacity:0 stays clickable -->
<div style="display:{d.showDiv:ifEQ(true):show('block'):elseShow('none')};">...</div>
<p style="visibility:{d.showP:ifEQ(true):show('visible'):elseShow('hidden')};">...</p>
<span style="opacity:{d.showSpan:ifEQ(true):show('1'):elseShow('0')};">...</span>

<!-- CSS properties from the data ("imageStyle": "display: none;") -->
<img src="image.jpg" style="width: 150px;{d.imageStyle}border-radius: 8px;">
<img src="image.jpg" style="{d.showImage:ifEQ(true):show('display:block;'):elseShow(d.imageStyle)}">

<!-- a whole attribute from the data ("buttonStyles1": "style=\"background-color: green;\"") -->
<button {d.buttonStyles1}>Click Me</button>
<button {d.buttonTheme:ifEQ('forest'):show(d.buttonStyles1):elseShow(d.buttonStyles2)}>Click Me</button>
```

### 2. Inject HTML blocks with `:html`

See [Basics](#basics): `{d.noteSection:html}`, or choose the block first with `{d.displayNote:ifEQ(true):show(d.noteSection):elseShow(d.nothingSection):html}`.

### 3. Smart conditions: `:drop` / `:keep` (ENTERPRISE)

| Element | Where to write the tag | Example |
|---|---|---|
| `p` | Inside the `<p>` | `{d.text:ifEM:drop(p)}` |
| `row` | In a cell of the `<tr>` | `{d.condition:ifNE(value):keep(row)}` |
| `col` | In any `<td>` or `<th>` of the column: the cell at the same position is removed in every row, header included | `{d.condition:ifEQ(value):drop(col)}` |
| `table` | Inside the `<table>`, e.g. right after the opening tag | `{d.condition:ifEQ(value):drop(table)}` |
| `div` | Inside the `<div>` | `{d.condition:ifEQ(value):drop(div)}` |
| `span` | Inside the `<span>` | `{d.condition:ifEQ(value):drop(span)}` |

- These six elements only. A count drops or keeps several paragraphs or rows (`p` and `row` only): `:drop(p, 2)` removes the paragraph of the tag and the next one.
- Never chain a formatter after `:drop()` / `:keep()`. The tag prints nothing.

```html
<table>{d.showTable:ifEQ(false):drop(table)}
  <tr><td>{d.list[i].name}</td></tr>
  <tr><td>{d.list[i+1].name}</td></tr>
</table>

<tr><td>{d[i].name}{d[i].name:ifIN('Falcon'):drop(row)}</td></tr>    ← removes "Falcon 9", "Falcon Heavy"
<tr><td>{d[i+1].name}</td></tr>

<tr><th>Name</th><th>Price{d.hidePrice:ifEQ(true):drop(col)}</th></tr>

<p>{d.text}{d.text:ifEM:drop(p, 2)}This paragraph and the next one are dropped if text is empty.</p>
<p>Dropped too.</p>
```

### 4. Conditional blocks: `:showBegin` / `:showEnd` / `:hideBegin` / `:hideEnd`

Write the tags as text between elements, around any number of elements:
```html
<p>Product: {d.product}</p>
{d.showDetails:ifEQ(true):showBegin}
<p>Details:</p>
<ul><li>Feature 1</li><li>Feature 2</li></ul>
{d.showDetails:ifEQ(true):showEnd}
```

---

## Pictures

Write the tag in the `src` of an `<img>` (no placeholder picture). The value is an absolute URL or a Base64 data URI; relative paths (`/images/logo.png`) are not supported. Size it with attributes (`width="300" height="200"`) or CSS (`style="width:300px; height:auto;"`):

```html
<img src="{d.userProfile.profilePictureUrl}" alt="Profile Picture" style="width:200px; height:auto;"/>
```

`:imageFit` is **not compatible** with HTML templates: on a `:chart` or `:barcode` tag it stops the render with `The imageFit formatter is not compatible with HTML templates`. Size with the `<img>` attributes or CSS.

---

## Charts

`:chart` in the `src` of an `<img>` (ENTERPRISE); the tag becomes an SVG data URI (`data:image/svg+xml;base64,…`). The data holds a full ECharts v5 configuration: `"type"` `echarts@v5` (default) or `echarts@v5a` (better SVG compatibility), `width`, `height`, `theme`, `option` (`advanced-features.md` "ECharts"); style the chart in that JSON, external JavaScript is not supported:

```html
<img src="{d.chartOptions:chart}" alt="Sales chart" width="600" height="400">
```
The `width`/`height` of the `<img>` set the size in the page; the `width`/`height` of the ECharts configuration set the size of the generated image.

---

## Barcodes

`:barcode(type)` in the `src` of an `<img>` (ENTERPRISE). In HTML the barcode is an **SVG by default** (`svg:false` for a PNG). Size it with the `<img>` attributes or with the barcode options (each option is its own `key:value` argument):

```html
<img src="{d.qrData:barcode(qrcode)}" alt="QR Code" width="200" height="200">
<img src="{d.productCode:barcode(ean13, width:200, height:100)}" alt="EAN-13">
```
A single quoted string of options, `barcode(ean13, 'width:200;height:100')`, is ignored: the barcode keeps its default size. Barcode types and options → SKILL.md §8b.

---

## Colors

Inject the color into a CSS property, directly or with a condition:
```html
<div style="color: {d.textColor}; background-color: {d.bgColor}; padding: 10px;">...</div>
<p style="color: {d.isUrgent:ifEQ(true):show(d.alertColor):elseShow('#333333')};">...</p>
<button style="color: {d.theme:ifEQ('dark'):show('#ffffff'):elseShow('#000000')};">...</button>
```

`:color(scope, type)` works too (ENTERPRISE): scope `p`, `row` (`<tr>`) or `cell` (`<td>`), type `text` or `background`. Carbone adds the property to the `style` attribute of that element and keeps its other properties:
```html
<p style="font-weight:bold">Total {d.statusColor:color(p)}</p>
<tr style="font-size:10px"><td>{d.rows[i].name}{d.rows[i].bg:color(row, background)}</td></tr>
<tr><td>{d.rows[i+1]}</td></tr>
```
`"statusColor": "#FF0000"` → `<p style="color:#ff0000; font-weight:bold">`; each row gets `style="background-color:#eeeeee; font-size:10px"` from its own `bg`. Full `:color` rules → `advanced-features.md` "Colors".

---

## Hyperlinks

The `href` is plain text: static text and tags mix freely, and Carbone writes the URL as built and adds no protocol (`{d.host}` = `"carbone.io/x"` stays `carbone.io/x`, a relative link):

```html
<a href="{d.documentationUrl}">Read the Docs</a>
<a href="{d.isLoggedIn:ifEQ(true):show(d.profileUrl):elseShow(d.defaultUrl)}">
  {d.isLoggedIn:ifEQ(true):show('Your Profile'):elseShow('Login')}
</a>
<a href="https://carbone.io/{d.slug}">Pricing</a>                                 ← "slug": "carbone-cloud" → https://carbone.io/carbone-cloud
<a href="/docs/{d.product.name:lowerCase:replace(' ','-')}">Documentation</a>     ← "Carbone Cloud" → /docs/carbone-cloud
```

---

## Page breaks

PDF output only: HTML and image output ignore them. Define the class once in `<style>`, then add a `<div>` or `<p>` with it where the new page starts:
```css
.page-break { page-break-before: always; break-before: page; }
```
```html
<div>Page 1 content</div>
<p class="page-break"></p>
<div>Page 2 content</div>
```
One page per item: put the break element first in the repeated block ([example](#table-of-contents-and-one-page-per-item)).

---

## Headers and footers

`<carbone-pdf-header>` and `<carbone-pdf-footer>` repeat on every page of the PDF. Tags work inside; style with **inline CSS only** (no external stylesheet):

```html
<carbone-pdf-header>
  <div style="font-size:12px; text-align:center; width:100%;">
    <span>Company Report | {d.reportTitle}</span>
    <span>Generated: {c.now:formatD('YYYY-MM-DD')}</span>
  </div>
</carbone-pdf-header>

<carbone-pdf-footer>
  <div style="font-size:10px; text-align:center; width:100%;">
    Page <span class="pageNumber"></span> of <span class="totalPages"></span>
  </div>
  <div style="font-size:9px; text-align:right;">© {d.year} {d.company}. All rights reserved.</div>
</carbone-pdf-footer>
```

- `<span class="pageNumber">` prints the current page, `<span class="totalPages">` the page count
- PDF only: HTML output and image output (PNG, JPG, WebP) ignore them
- They render in the PDF even when hidden or commented out in the template

**Same header and footer on every page.** They cannot be turned off or changed on one page: a CSS rule like `.pageNumber:first-child { display: none; }` is ignored, with no error. For a cover page without footer:
1. **Two HTML templates**: the cover without `<carbone-pdf-footer>` and the body with it, joined with `:appendTemplate` (SKILL.md §8g), e.g. `{d:appendTemplate(110212)}` in the cover, where `110212` is the body template's ID. Page numbering restarts at 1 in the appended template.
2. **A DOCX, PPTX or XLSX template**: Office headers and footers can differ on the first page, on odd and even pages, or per section, in a single template.

---

## PDF options: `<carbone-pdf-options>`

```html
<carbone-pdf-options paper-size="A3" landscape="true" margin-bottom="2.5" print-background="false"/>
```

| Option | Type | Default | Description |
|---|---|---|---|
| `landscape` | boolean | `false` | Landscape orientation |
| `display-header-footer` | boolean | `false` | Show header/footer (`true` when the template has a header or footer) |
| `print-background` | boolean | `true` | Print background graphics |
| `scale` | number | `1` | Page render scale |
| `paper-size` | string | `A4` | `Letter` (8.5 × 11 in), `Legal` (8.5 × 14), `Tabloid` (11 × 17), `Ledger` (17 × 11), `A0` to `A6` |
| `paper-width` / `paper-height` | number | `8.27` / `11.7` | Paper size in inches, overrides `paper-size` |
| `margin-top` / `-bottom` / `-left` / `-right` | number | `0.5` | Margins in inches; `paper-size="Letter"` or `"Legal"` sets them to `1` unless given |
| `page-ranges` | string | all | `"1-5, 8, 11-13"`, a plain range `"1-5"` or a page `"2"` (v5.15.0+). Pages print in document order, each once; `""` prints all; invalid ranges are ignored; a start page greater than its end page returns an error |
| `prefer-css-page-size` | boolean | `false` | Use the CSS `@page` size; when `false`, the content is scaled to fit the paper size |
| `generate-tagged-pdf` | boolean | `false` | Tagged PDF/UA for accessibility |

- Write every value in **double quotes**. Booleans: `true`/`false` (or `1`/`0`); any other value is ignored and the default kept.
- An unknown option name, or a `paper-size` outside the list (exact case: `A4`, `Letter`), stops the render with an error.
- Tags work in the values, so paper size or orientation can come from the data: `<carbone-pdf-options paper-size="{d.size}" landscape="{d.land}"/>` with `{"size": "A5", "land": "true"}` → A5 landscape.
- PDF only: image output ignores the element.

---

## Translations and comments

`{t(key)}` translates static text, `:t` a data value; `:formatD`, `:formatN`, `:formatC` follow the `lang` of the render (SKILL.md §8f):
```html
<h1>{t(Invoice)}</h1>
<p>{t(Date)}: {d.date:formatD('DD/MM/YYYY')}</p>
<tr><td>{d.tool:t}</td><td>1</td></tr>
```

Carbone reads HTML comments too: `<!-- {d.user.name} -->` → `<!-- John -->`. To mention a tag in a comment, break its syntax: `<!-- Use d.user.name for the username -->`. To insert a whole comment from the data, end the tag with `:html`: `{d.showComment:ifEQ(true):show(.comment):elseShow(''):html}` with `"comment": "<!-- Injected -->"`.
