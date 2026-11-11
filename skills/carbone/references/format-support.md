# Carbone Template Format Support

Read this file when the user asks which template format to use, whether a feature works in a given format (barcodes in XLSX, `:html` in PPTX, images in PDF…), what a template can be converted to, whether an unlisted file format can be used as a template, or about CSV, TXT, XML, SVG, ODG or IDML templates.

Carbone accepts **15 known input template formats**: PDF, DOCX, XLSX, PPTX, ODT, ODS, ODP, HTML, MD, CSV, TXT, XML, SVG, ODG, IDML.

**This list is not closed — Carbone is format-agnostic.** The engine injects data into the file's own markup, so two whole families work as templates, listed or not:

- **XML-based files** — DOCX, XLSX, ODT and IDML are simply XML in a zip, and so are countless other document, design, e-invoicing and configuration formats
- **Text files** — the list names TXT, CSV and Markdown, but any text-based file works. **JSON is a template format too**, even though it does not appear above; the tags are just text in the file

If a user brings an exotic XML-based or text-based file, the answer is "yes, try it", not "unsupported".

What is format-specific is the **enterprise features** in the table below — pictures, colors, charts, barcodes, forms and the rest need per-format handling, so on an unlisted format expect the core language to work and those extras not to.

**Every listed format supports the core language**: substitutions, repetitions, formatters, translations, conditions and simple math. Two exceptions: repetitions are limited in **PDF** (inside a text field only) and in **IDML**, where conditions are limited too.

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
| MD | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| ODG | ✓ | ✓ | 📅 | ✗ | ✓ | ✓ | ✓ | ✗ | 📅 | ✓ | ✓ |
| SVG | ✓ | ✗ | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✓ |
| PDF | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ |
| CSV | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| TXT | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| XML | ✓ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| IDML | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

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
| SVG | pdf, jpg, png, webp |
| CSV | csv, txt, pdf, docx, odt, html |
| TXT | txt, pdf, docx, odt, html |
| PDF | pdf (stays a PDF — no `convertTo`) |
| XML | xml |
| IDML | idml |

---

## Text formats — CSV, TXT, XML, JSON

Plain-text templates: write Carbone tags anywhere in the file. They support the core language plus aggregators, and **nothing else** — no images, colors, `:html`, charts, barcodes, hyperlinks or file operations.

Loops need no table structure; the `[i]` / `[i+1]` rows are ordinary lines:
```
{d.items[i].id};{d.items[i].name};{d.items[i].qty:formatN(2)}
{d.items[i+1].id}
```

XML templates render to XML only — useful for e-invoicing and data payloads. Escape any character that would break the XML in the data, or the output is invalid.

**JSON templates work too**, even though JSON is not in the list of known formats: the tags are plain text in the file, so a JSON template renders to JSON. Useful to reshape an API payload with Carbone's filters, sorting and aggregators.

---

## IDML (Adobe InDesign)

IDML templates render to IDML only. Substitutions, formatters, translations and simple math work; **repetitions and conditions work with limitations**, and every enterprise feature (including aggregators) is unavailable. Keep IDML templates to straight substitution unless the user has verified more.

---

## Format-specific limitations

- **XLSX**: sheet names are capped at 31 characters; dynamic sheet creation is not supported
- **ODS**: dynamic sheet creation **is** possible — name the sheet tabs with aliases that resolve to a loop (`{$sheet1}` / `{$sheet2}`), see `xlsx-tips.md` "One sheet per array item"
- **PPTX**: dynamic slide creation is not supported — paginate manually with filters (ODP supports dynamic slide creation)
- **PDF**: see `pdf-templates.md`

---

## Choosing a format

- **Pixel-perfect PDF with full CSS** → HTML (`html-templates.md`)
- **Paginated documents, headers/footers, long text** → DOCX or ODT (`docx-tips.md`)
- **AI-generated content** → Markdown (`markdown-templates.md`)
- **Spreadsheets with live formulas** → XLSX or ODS (`xlsx-tips.md`)
- **An existing fillable form you cannot rebuild** → PDF (`pdf-templates.md`)
- **A data payload rather than a document** → XML, JSON, CSV or TXT
- **A format that is not in the list** → use it as-is if it is XML-based or plain text; substitutions, loops, conditions and formatters apply to both
