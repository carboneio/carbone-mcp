# Carbone Template Format Support

Read this file when the user asks which template format to use, whether a feature works in a given format (barcodes in XLSX, `:html` in PPTX, images in PDF…), what a template can be converted to, whether an unlisted file format can be used as a template, or about JSON or ODG templates. Full guides per format: `csv-templates.md`, `txt-templates.md`, `xml-templates.md`, `svg-templates.md`, `idml-templates.md`.

Carbone accepts **15 known input template formats**: PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP, HTML, MD, CSV, TXT, XML, SVG, ODG, IDML.

**This list is not closed — Carbone is format-agnostic.** The engine injects data into the file's own markup, so two whole families work as templates, listed or not:

- **XML-based files** — DOCX, XLSX, ODT and IDML are simply XML in a zip, and so are countless other document, design, e-invoicing and configuration formats
- **Text files** — the list names TXT, CSV and Markdown, but any text-based file works. **JSON is a template format too**, even though it does not appear above; the tags are just text in the file

If a user brings an exotic XML-based or text-based file, the answer is "yes, try it", not "unsupported".

What is format-specific is the **enterprise features** in the table below — pictures, colors, charts, barcodes, forms and the rest need per-format handling, so on an unlisted format expect the core language to work and those extras not to.

**Every listed format supports the core language**: substitutions, repetitions, formatters, translations, conditions and simple math. Two exceptions: repetitions are limited in **PDF** (inside a text field only) and in **IDML** (paragraph loops only, no table-row loops).

---

## Enterprise features by format

✓ working · 📅 on the roadmap · ✗ not available, or not supported by the file format itself

| Format | Aggregators | Pictures | Colors | `:html` | Charts | Barcodes | Hyperlinks | Forms | `:transform` | File ops | Signatures |
|---|---|---|---|---|---|---|---|---|---|---|---|
| DOCX | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | 📅 | ✓ | ✓ |
| ODT | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| XLSX | ✓ | ✓ | 📅 | 📅 | ✓ | ✓ | ✓ | ✗ | 📅 | ✓ | ✓ |
| ODS | ✓ | ✓ | ✓ | 📅 | ✓ | ✓ | ✓ | ✗ | 📅 | ✓ | ✓ |
| PPTX | ✓ | ✓ | ✓ | 📅 | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| ODP | ✓ | ✓ | ✓ | 📅 | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ | ✓ |
| HTML | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✓ | ✓ |
| MD | ✓ | ✓ | ✓² | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| ODG | ✓ | ✓ | 📅 | ✗ | ✓ | ✓ | ✓ | ✗ | 📅 | ✓ | ✓ |
| SVG | ✓ | ✓¹ | ✓¹ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| PDF | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| CSV | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| TXT | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| XML | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| IDML | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ |

¹ SVG: colors and pictures are plain tags in the markup — `fill="{d.color}"`, `<image href="{d.photo}"/>` — or `:svgUpdate` to recolor shapes by id; no `:color` formatter or alt-text placeholder needed (`svg-templates.md`).
² Markdown: colors are plain tags in the `style` of an HTML element that starts the line (`<p>`, `<div>`), a `<span>` inside a `<p>` — no `:color` formatter needed (`markdown-templates.md`).

`:drop`/`:keep` do not exist in CSV, TXT, XML, SVG, IDML, ODG and Markdown templates (render error `Formatter "drop" does not exist`): use conditional blocks or loop filters.

If a feature is ✗ for the format at hand, say so — do not propose a workaround tag that does not exist.

---

## Output formats

| Template | Can be converted to |
|---|---|
| DOCX, ODT | odt, docx, pdf, txt, jpg, png, epub, md, rtf, html |
| XLSX, ODS | ods, xlsx, csv, pdf, txt, html |
| PPTX, ODP | odp, pptx, pdf, jpg, png, gif, svg, webp |
| HTML | html, pdf, txt, png, jpg, webp |
| MD | pdf, docx, odt, jpg, png, md |
| ODG | jpg, png, pdf, webp, epub, cdr |
| SVG | svg, pdf, jpg, png, webp |
| CSV | csv, txt, pdf, docx, odt, html |
| TXT | txt, pdf, docx, odt, html |
| PDF | pdf (stays a PDF — no `convertTo`) |
| XML | xml |
| IDML | idml (PDF: export the report from InDesign) |

---

## Text formats — CSV, TXT, XML, JSON

Plain-text templates: write Carbone tags anywhere in the file. They support the core language, aggregators and `:set`, and **nothing else** — no images, colors, `:html`, charts, barcodes, hyperlinks or file operations; `:drop`/`:keep` fail the render.

- **CSV** → `csv-templates.md`; **TXT** and other line-based text (fixed-width records, receipts, SMS, ZPL labels) → `txt-templates.md`: loop layout on lines, empty lines, quoting, numbers, encoding.
- **XML** renders to XML only (e-invoices, payment files, feeds). Carbone escapes `&`, `<` and `>` itself; a `"` in data printed inside an attribute breaks the XML → `xml-templates.md`.
- **JSON templates work too**, even though JSON is not in the list of known formats: the tags are plain text in the file, so a JSON template renders to JSON. Useful to reshape an API payload with Carbone's filters, sorting and aggregators.

---

## IDML (Adobe InDesign)

IDML templates render to IDML only (omit `convertTo`); open the report in InDesign to export a PDF. Substitutions, formatters, aggregators, translations, inline conditions, `showBegin`/`showEnd` blocks, paragraph loops (nested too) and hyperlink URLs work. Not available: table-row loops, `:drop`/`:keep` (render error), pictures, colors, `:html`, charts, barcodes. Where tags go, style rules, loops and text flow → `idml-templates.md`.

---

## Format-specific limitations

- **XLSX**: sheet names are capped at 31 characters; dynamic sheet creation is not supported — design an ODS template and convert the report to XLSX. Formulas, merged cells, conditional formatting, tables, charts and pivot tables follow loop rows only with `{o.preReleaseFeatureIn=5018000}` (v5.18.0+); merged cells also do in a sheet that uses `:mergeCell`, which is XLSX only (`xlsx-tips.md`)
- **ODS**: dynamic sheet creation **is** possible — name the sheet tabs with aliases that resolve to a loop (`{$sheet1}` / `{$sheet2}`), see `xlsx-tips.md` "One sheet per array item"
- **PPTX**: no slide loops and no table-column (horizontal) loops yet — for one slide per item use an ODP template rendered with `"convertTo": "pptx"`; shapes below a looped table or list do not move (`pptx-tips.md`)
- **PDF**: see `pdf-templates.md`
- **XML, SVG**: a self-closing element repeated by a loop leaves an empty copy — give it an end tag or wrap it (`xml-templates.md`, `svg-templates.md`)
- **IDML**: loops repeat paragraphs only; Carbone never adds pages or frames (`idml-templates.md`)
- **Markdown**: the template file name must end in `.md`, and the file must start with text, not `<` — otherwise it is read as XML (`markdown-templates.md`)

---

## Choosing a format

- **Pixel-perfect PDF with full CSS** → HTML (`html-templates.md`)
- **Paginated documents, headers/footers, long text** → DOCX or ODT (`docx-tips.md`)
- **AI-generated content** → Markdown (`markdown-templates.md`)
- **Spreadsheets with live formulas** → XLSX (formulas follow loop rows with `{o.preReleaseFeatureIn=5018000}`) or ODS (`xlsx-tips.md`)
- **Presentations** → PPTX, or ODP for one slide per item (`pptx-tips.md`)
- **An existing fillable form you cannot rebuild** → PDF (`pdf-templates.md`)
- **A data payload rather than a document** → XML (`xml-templates.md`), JSON, CSV (`csv-templates.md`) or TXT (`txt-templates.md`)
- **An image (PNG/JPG/WebP) or one-page PDF drawn in a design tool** → SVG (`svg-templates.md`)
- **Print layouts designed in InDesign** (catalogs, price lists, badges) → IDML; the output stays IDML (`idml-templates.md`)
- **A format that is not in the list** → use it as-is if it is XML-based or plain text; substitutions, loops, conditions and formatters apply to both
