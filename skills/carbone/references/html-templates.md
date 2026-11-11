# Carbone HTML Templates Reference

Read this file when the user asks about HTML templates, HTML to PDF conversion, inline CSS injection, PDF output options (page size, margins, orientation, headers/footers), ECharts or barcode embedding, `:html` in HTML context, or `<carbone-pdf-options>` / `<carbone-pdf-header/footer>`.

Version: 5.0+ | Free feature | Renderer: Chromium-based (pixel-perfect PDF)

HTML templates support the full Carbone feature set: substitutions, loops, conditions, formatters, charts, barcodes, hyperlinks, i18n, and all enterprise features.

## Contents

- [Basics](#basics)
- [Loops](#loops)
- [Conditions](#conditions)
  - [1. Inline CSS / style injection](#1-inline-css--style-injection)
  - [2. Inject HTML blocks with `:html`](#2-inject-html-blocks-with-html)
  - [3. Smart conditions — `:drop` / `:keep`](#3-smart-conditions--drop--keep)
  - [4. Conditional blocks — `:showBegin` / `:showEnd` / `:hideBegin` / `:hideEnd`](#4-conditional-blocks--showbegin--showend--hidebegin--hideend)
- [Pictures](#pictures)
- [Charts](#charts)
- [Barcodes](#barcodes)
- [Colors](#colors)
- [Hyperlinks](#hyperlinks)
- [Page Breaks (PDF only)](#page-breaks-pdf-only)
- [Table of Contents](#table-of-contents)
- [Headers and Footers (PDF only)](#headers-and-footers-pdf-only)
- [PDF Conversion Options](#pdf-conversion-options)
- [i18n / Translations](#i18n--translations)
- [Comments](#comments)
- [Convert to PDF — API call](#convert-to-pdf--api-call)

---

## Basics

An HTML template is a **complete document**: `<!DOCTYPE html>`, then `<html>` with its `<head>` and `<body>`. Carbone detects the template type from its content, so a fragment without `<html>` is read as XML (when it starts with a tag) or as plain text (when it starts with text), and the Chromium converter refuses to turn it into a PDF. The examples below show only the relevant part of the body.

Carbone tags work anywhere inside an HTML document — in text, attributes, CSS values, `src`, `href`, `style`, etc.

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Welcome</title>
  </head>
  <body>
    <h1>Welcome, {d.user.firstName} {d.user.lastName}!</h1>
    <p>Your email: {d.user.email}</p>
    <p>Membership: {d.membershipLevel}</p>
  </body>
</html>
```

**CSS limitations:**
- **Any inline CSS** is supported via the `style="..."` attribute — the template is rendered by Chromium, so the full CSS specification applies.
- External stylesheets and `<style>` blocks are also supported.
- **Animated CSS is not supported** — `transition`, `animation`, `@keyframes` and similar properties are ignored. The output is a static PDF.

⚠️ **Do not confuse with the `:html` formatter** (used to inject HTML strings inside templates):
- Inside an **HTML template** → no CSS limits, any inline CSS works (rendered by Chromium)
- Inside a **DOCX or ODT template** → only a limited set of inline CSS properties is supported: `color`, `background-color`, `break-before`, `break-after`

---

## Loops

Use `[i]` / `[i+1]` as usual. The `[i+1]` row is removed from output. Works in `<tr>`, `<li>`, `<div>`, or any repeating block.

```html
<!DOCTYPE html>
<html>
  <body>
    <table>
      <tbody>
        <tr>
          <td>{d.users[i].id}</td>
          <td>{d.users[i].name}</td>
          <td>{d.users[i].role}</td>
        </tr>
        <!-- end-of-loop row (removed from output) -->
        <tr><td>{d.users[i+1]}</td></tr>
      </tbody>
    </table>
  </body>
</html>
```

---

## Conditions

### 1. Inline CSS / style injection

Inject CSS property values directly using conditions:

```html
<!-- show/hide via display -->
<div style="display:{d.showDiv:ifEQ(true):show('block'):elseShow('none')};">...</div>

<!-- visibility -->
<p style="visibility:{d.showP:ifEQ(true):show('visible'):elseShow('hidden')};">...</p>

<!-- opacity -->
<span style="opacity:{d.showSpan:ifEQ(true):show('1'):elseShow('0')};">...</span>
```

Inject entire CSS properties or full style attributes:

```html
<!-- inject CSS property from data -->
<img src="img.jpg" style="width:150px;{d.imageStyle}border-radius:8px;">

<!-- conditional CSS property -->
<img src="img.jpg" style="{d.showImage:ifEQ(true):show('display:block;'):elseShow(d.imageStyle)}">

<!-- inject full style attribute from data (data contains: style="background:green;...") -->
<button {d.buttonStyles1}>Click Me</button>

<!-- conditional full style attribute -->
<button {d.theme:ifEQ('forest'):show(d.buttonStyles1):elseShow(d.buttonStyles2)}>Click Me</button>
```

### 2. Inject HTML blocks with `:html`

Without `:html`, `<` and `>` are escaped. Use `:html` to render raw HTML from JSON data — full reference, supported elements, CSS, options, and common patterns → `references/advanced-features.md` "`:html` Formatter — Full Reference".

### 3. Smart conditions — `:drop` / `:keep`

HTML supports: `table`, `col`, `row`, `p`, `div`, `span`. The N-consecutive argument works with `p` and `row` only.

```html
<!-- Drop entire table -->
<table>{d.showTable:ifEQ(false):drop(table)}
  <tr><td>{d.list[i].name}</td></tr>
  <tr><td>{d.list[i+1].name}</td></tr>
</table>

<!-- Drop a row in loop -->
<tr><td>{d[i].name}{d[i].name:ifIN('Falcon'):drop(row)}</td></tr>
<tr><td>{d[i+1].name}</td></tr>
```

Second parameter drops N consecutive elements:
```html
{d.text:ifEM:drop(p, 3)}
```

### 4. Conditional blocks — `:showBegin` / `:showEnd` / `:hideBegin` / `:hideEnd`

```html
{d.name:ifEM:hideBegin}
<strong>Welcome {d.name}!</strong>
{d.name:ifEM:hideEnd}
```

---

## Pictures

In HTML templates, use a standard `<img>` tag. Supports absolute URLs and Base64 Data-URIs. **Relative paths are not supported.**

```html
<img src="{d.userProfile.profilePictureUrl}" style="width:200px; height:auto;" />
<img src="{d.userProfile.profilePictureBase64}" style="width:200px;" />
```

---

## Charts

Use the `:chart` formatter in the `src` of an `<img>` tag. The JSON must contain a full ECharts v5 configuration object:

```html
<img src="{d.chartOptions:chart}" alt="Chart" width="600" height="400">
```

Required JSON structure for `chartOptions`:
```json
{
  "type": "echarts@v5a",
  "width": 600,
  "height": 400,
  "theme": null,
  "option": { /* ECharts v5 config */ }
}
```

Supported versions: `echarts@v5a` (recommended — optimized for SVG output), `echarts@v5` (legacy).
Chart styling must be defined within the JSON. No external JS dependencies.

---

## Barcodes

Use the `:barcode(type)` formatter in the `src` attribute of an `<img>` tag (no placeholder image needed — unlike DOCX/ODT):

```html
<!-- QR code, size via img attributes -->
<img src="{d.qrData:barcode(qrcode)}" width="200" height="200">

<!-- EAN-13, size via formatter -->
<img src="{d.productCode:barcode(ean13, width:200, height:100)}" alt="Barcode">
```

---

## Colors

Inject color values directly from JSON into CSS:

```html
<div style="color:{d.textColor}; background-color:{d.bgColor};">...</div>
<p style="color:{d.isUrgent:ifEQ(true):show(d.alertColor):elseShow('#333333')};">...</p>
```

---

## Hyperlinks

Inject `href` dynamically:

```html
<a href="{d.documentationUrl}">Read the Docs</a>
<a href="{d.isLoggedIn:ifEQ(true):show(d.profileUrl):elseShow(d.defaultUrl)}">
  {d.isLoggedIn:ifEQ(true):show('Your Profile'):elseShow('Login')}
</a>
<a href="/docs/{d.product.name:lowerCase:replace(' ','-')}">Documentation</a>
```

---

## Page Breaks (PDF only)

Define this CSS class once in `<style>`:
```css
.page-break { page-break-before: always; break-before: page; }
```
Then insert a break element:
```html
<p class="page-break"></p>
```
Only works in PDF output, ignored in HTML.

---

## Table of Contents

Use anchor links with `id` attributes. Pair `href="#section_{d.id}"` links in a TOC loop with `id="section_{d.id}"` on the heading elements.

---

## Headers and Footers (PDF only)

Use the `<carbone-pdf-header>` and `<carbone-pdf-footer>` custom elements. Carbone tags work inside them. Only inline CSS is supported (no external stylesheets).

```html
<carbone-pdf-header>
  <div style="font-size:12px; text-align:center; width:100%;">
    <span>Company Report | {d.reportTitle}</span>
    <span>Generated: {c.now:formatD('YYYY-MM-DD')}</span>
    <span>User: {d.user.name}</span>
  </div>
</carbone-pdf-header>

<carbone-pdf-footer>
  <div style="font-size:10px; text-align:center; width:100%;">
    Page <span class="pageNumber"></span> of <span class="totalPages"></span>
  </div>
  <div style="font-size:9px; text-align:right;">
    © {d.year} {d.company}. All rights reserved.
  </div>
</carbone-pdf-footer>
```

- `{c.now}` — built-in complement value for current date/time
- `<span class="pageNumber">` — current page number
- `<span class="totalPages">` — total pages
- Headers/footers are PDF-only; ignored in HTML output and when the output is an image (PNG, JPG, WebP)

---

## PDF Conversion Options

Insert `<carbone-pdf-options/>` in the template with attribute-based options:

```html
<carbone-pdf-options
  paper-size="A3"
  landscape="true"
  margin-bottom="2.5"
  print-background="false"
/>
```

`<carbone-pdf-options>`, `<carbone-pdf-header>` and `<carbone-pdf-footer>` are ignored when the output is an image instead of a PDF.

| Option | Type | Default | Description |
|---|---|---|---|
| `landscape` | boolean | false | Landscape orientation |
| `display-header-footer` | boolean | false | Show header/footer |
| `print-background` | boolean | true | Print background graphics |
| `scale` | number | 1 | Webpage render scale |
| `paper-size` | string | A4 | Letter, Legal, Tabloid, Ledger, A0–A6 |
| `paper-width` | number | 8.27 | Width in inches |
| `paper-height` | number | 11.7 | Height in inches |
| `margin-top` | number | 0.5 | Top margin in inches |
| `margin-bottom` | number | 0.5 | Bottom margin in inches |
| `margin-left` | number | 0.5 | Left margin in inches |
| `margin-right` | number | 0.5 | Right margin in inches |
| `page-ranges` | string | all | e.g. `"1-5, 8, 11-13"`; a plain range `"1-5"` or a single page `"2"` also works (v5.15.0+) |
| `prefer-css-page-size` | boolean | false | Use CSS-defined page size |
| `generate-tagged-pdf` | boolean | false | Tagged PDF/UA for accessibility |

---

## i18n / Translations

Pass `translations` object in the API request body alongside `data` and `lang`:

```json
{
  "data": { "tool": "key1" },
  "lang": "en-us",
  "translations": {
    "fr-fr": { "Invoice": "Facture", "key1": "Tournevis" },
    "en-us": { "Invoice": "Invoice", "key1": "Screwdrivers" }
  }
}
```

Template:
```html
<h1>{t(Invoice)}</h1>
<td>{d.tool:t}</td>
```

---

## Comments

Carbone processes tags inside HTML comments too:
```html
<!-- {d.user.name} -->   ← will be replaced with data
```
To escape a tag in a comment (prevent evaluation): break its syntax, e.g. `d.user.name`.

---

## Convert to PDF — API call

```bash
curl --request POST 'https://api.carbone.io/render/template?download=true' \
  --header 'carbone-version: 5' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer API_TOKEN' \
  --data-raw '{
    "data": {},
    "template": "<BASE64_ENCODED_HTML>",
    "convertTo": "pdf",
    "converter": "C"
  }' \
  --output result.pdf
```

`converter: "C"` = Chromium engine (use for HTML → PDF). Output matches what you see in Chrome.
