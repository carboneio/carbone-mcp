# Carbone Markdown Templates Reference

Read this file when the user asks about Markdown templates: file name and type detection, how values and Markdown characters are inserted, styling a Markdown report with a Word/LibreOffice style template (`{o.styleSource}`: heading, body and table styles, page size, margins, header, footer), loops in tables, lists and paragraphs, conditions, pictures, barcodes, charts, colors with `<p>`/`<div>` styles, hyperlinks, `:html` in Markdown, translations, comments, limitations, or output formats (PDF, DOCX, ODT, PNG, JPG, MD).

Version: 5.0+ | Output: PDF, DOCX, ODT, PNG, JPG, MD; without `convertTo` the report stays Markdown

## Contents

- [Basics](#basics)
- [Style template: `{o.styleSource}`](#style-template-ostylesource)
- [Loops](#loops)
- [Conditions](#conditions)
- [Pictures](#pictures)
- [Barcodes](#barcodes-enterprise-v5130)
- [Charts](#charts-enterprise-v5130)
- [Colors](#colors)
- [Hyperlinks](#hyperlinks)
- [Inject HTML: `:html`](#inject-html-html)
- [Translations and comments](#translations-and-comments)
- [Limitations](#limitations)

---

## Basics

Write any valid Markdown; tags work in headings, paragraphs, list items, table cells, link and image destinations and HTML comments:

```markdown
# Welcome, {d.user.firstName} {d.user.lastName}!

Your email address is: {d.user.email}
```
`{"user": {"firstName": "John", "lastName": "Doe", "email": "john.doe@carbone.io"}}` → `# Welcome, John Doe!` / `Your email address is: john.doe@carbone.io`

- **Keep the `.md` file name, and start the file with text, not `<`.** Carbone recognizes a Markdown template by its extension, but a first line such as `<!-- note -->`, `<img>` or `<div>` makes it read the file as XML (`Format "xml" can't be converted to "pdf"`). A template sent without a file name is read as plain text on Carbone Cloud: converted to PDF, its `#`, `**` and `|` print as raw characters.
- **Values are inserted as written.** Carbone escapes `<`, `>` and `&` (`&lt;` `&gt;` `&amp;`), not the Markdown characters: `*`, `_`, `#` or `|` in a value are read as Markdown at conversion. For example, `{d.isUrgent:ifEQ(true):show('**HIGH**')}` prints **HIGH** in bold, and a `|` in a table-cell value splits the cell.
- Works: substitutions, loops, conditions (inline and blocks), formatters, translations, pictures, barcodes, charts, hyperlinks, `:html`. Not available: see [Limitations](#limitations).

---

## Style template: `{o.styleSource}`

A Markdown report takes the look of a DOCX or ODT template (v5.8.0+): text styles, page, header and footer.

1. Create the style template: style the headings, the body text and the table text; set the page, header and footer.
2. Upload it to Carbone. Use its template ID (latest deployed version) or a version ID (one exact version).
3. Write `{o.styleSource=ID}` anywhere in the Markdown, for example on the first line.

Example of a Markdown template:
```markdown
{o.styleSource=1550916316474926631}

# Quarterly report

Results for {d.quarter}, published on {d.publishedAt:formatD('LL')}.

## Highlights

- Revenue of **{d.revenue:formatC(0)}**, up {d.growth}% year over year.
- {d.newCustomers} new customers, {d.customers:formatN(0)} in total.

## Revenue by region

| Region        | Revenue                             |
| :------------ | ----------------------------------: |
| North America | {d.regions.northAmerica:formatC(0)} |
| Europe        | {d.regions.europe:formatC(0)}       |
```
Data `{"quarter": "Q3 2026", "publishedAt": "2026-10-12", "revenue": 4820000, "growth": 18.4, "newCustomers": 126, "customers": 2140, "regions": {"northAmerica": 2310000, "europe": 1480000}}`, Word style template with a logo and `Quarterly report {d.quarter}` in its header, `Acme Corporation, confidential` and the PAGE / NUMPAGES fields in its footer → PDF: logo header `Quarterly report Q3 2026`, `Results for Q3 2026, published on October 12, 2026.`, bold `$4,820,000`, `2,140 in total`, the Revenue column right-aligned, footer `Page 1 of 1`.

The style template sets:
- **Text styles**: `Heading 1`, `Heading 2`… for `#`, `##`…; `Body Text` for paragraphs and list items; `Table Heading` for the header row of a table and `Table Contents` for its cells (an all-caps `Table Heading` prints `REGION  REVENUE`). In Word, create the last two as paragraph styles with these exact names.
- **Page**: size, margins, header and footer, with their pictures and page numbers.

The style template is a Carbone template too: its tags receive the data of the report, like `{d.quarter}` in its header. Its body is not copied into the report.

The style applies when the Markdown is converted to PDF. Table borders are not part of it: tables keep thin black borders. Column alignment (`:---` left, `---:` right) is kept.

---

## Loops

A loop repeats the text from its `[i]` tag to its `[i+1]` tag. Text before the `[i]` tag on its line prints once; the `[i+1]` tag is removed and the rest of its line prints once. So the repeated line must **start with a tag**, and the end tag goes alone on the next line.

**Table**: write the table without leading pipes:
```markdown
ID | Name | Role
-- | ---- | ----
{d.users[i].id} | {d.users[i].name} | {d.users[i].role}
{d.users[i+1]}
```
`{"users": [{"id": 1, "name": "Alice", "role": "Admin"}, {"id": 2, "name": "Bob", "role": "Editor"}]}` →
```markdown
ID | Name | Role
-- | ---- | ----
1 | Alice | Admin
2 | Bob | Editor
```
With leading pipes (`| {d.users[i].id} | … |` then `| {d.users[i+1]} | | |`), the first `|` is outside the repetition and the report ends with an empty row `|  | | |`.

**List**: start the line with an empty `[i]` tag so the bullet repeats:
```markdown
{d.items[i]}- {d.items[i].name}
{d.items[i+1]}
```
`{"items": [{"name": "Alpha"}, {"name": "Beta"}]}` → `- Alpha` / `- Beta`. Without the empty tag (`- {d.items[i].name}`), only the first item gets the bullet. A numbered list works the same: `{d.items[i]}1. {d.items[i].name}` prints `1.` on each line and Markdown numbers them.

**Paragraphs**: a blank line inside the repeated part keeps one paragraph per item:
```markdown
{d.items[i].name}: {d.items[i].qty}

{d.items[i+1]}
```

---

## Conditions

### Inline conditions

```markdown
Status: {d.status:ifEQ('active'):show('✅ Active'):elseShow('❌ Inactive')}

Score: {d.score:ifGT(90):show('Excellent'):elseShow('Good')}
```

### Conditional sections: `:showBegin` / `:showEnd`, `:hideBegin` / `:hideEnd`

Around headings, paragraphs, lists or tables:
```markdown
Product: {d.product}

{d.showDetails:ifEQ(true):showBegin}
## Details

- Feature 1
- Feature 2

{d.showDetails:ifEQ(true):showEnd}

Thank you for using Carbone!
```
`{"showDetails": false, "product": "Carbone Pro"}` → `Product: Carbone Pro` / `Thank you for using Carbone!`

```markdown
{d.name:ifEM:hideBegin}
Welcome, **{d.name}**!
{d.name:ifEM:hideEnd}
```

`:drop` / `:keep` are not supported in Markdown templates (coming soon). Use the blocks above.

---

## Pictures

Use a Markdown image with the tag as its source (an absolute URL or a Base64 data URI; relative paths are not supported):
```markdown
![Profile Picture]({d.userProfile.profilePictureUrl})
```
Markdown image syntax has no size: write an HTML `<img>` to set it:
```markdown
<img src="{d.userProfile.profilePictureUrl}" width="200" height="auto" alt="Profile Picture">
```

---

## Barcodes (ENTERPRISE, v5.13.0+)

`:barcode(type)` in the `src` of an HTML `<img>` (no placeholder picture). The `<img>` `width`/`height` set the size in the converted PDF, DOCX or ODT; the barcode options (each its own `key:value` argument) shape the generated image:
```markdown
<img src="{d.productCode:barcode(qrcode)}" width="150" height="150" alt="Product QR code"/>
<img src="{d.productCode:barcode(qrcode, includetext:false)}" width="150" height="150" alt="QR"/>
```
`![Product QR code]({d.productCode:barcode(qrcode)})` also works but cannot set the size: the barcode comes out very small. `:imageFit` is not compatible with Markdown templates (render error): size with the `<img>` attributes.

---

## Charts (ENTERPRISE, v5.13.0+)

`:chart` in the `src` of an HTML `<img>`; the data holds a full ECharts v5 configuration (`type: "echarts@v5a"`, `width`, `height`, `option`; see `advanced-features.md` "ECharts"):
```markdown
<img src="{d.chartOptions:chart}" width="600" height="400" alt="Sales Overview"/>
```
The `<img>` `width`/`height` set the size in the converted document; the ECharts `width`/`height` set the size of the generated image only. `![Sales Overview]({d.chartOptions:chart})` also works but the chart comes out very small. No `:imageFit` (render error).

---

## Colors

Markdown has no color syntax: write plain tags in the `style` of an HTML element that starts the line, like `<p>` or `<div>` (no formatter needed):
```markdown
<p style="color: {d.alertColor};">{d.isUrgent:ifEQ(true):show('Urgent Alert'):elseShow('All Clear')}</p>

<div style="color: {d.textColor}; background-color: {d.bgColor}; padding: 10px;">
  This section uses colors from the dataset.
</div>
```
`{"alertColor": "#ff4444", "isUrgent": true, "textColor": "#ffffff", "bgColor": "#1a1a1a"}` → `<p style="color: #ff4444;">Urgent Alert</p>`, `<div style="color: #ffffff; background-color: #1a1a1a; …">`

To color a word inside a sentence, put the `<span>` in a `<p>` element: `<p>Status: <span style="color: {d.alertColor};">{d.status}</span></p>`.

---

## Hyperlinks

Tags work in the address and the text of a Markdown link; static text and tags mix in the address:
```markdown
[Read the Docs]({d.documentationUrl})

[{d.isLoggedIn:ifEQ(true):show('Your Profile'):elseShow('Login')}]({d.isLoggedIn:ifEQ(true):show(d.profileUrl):elseShow(d.defaultUrl)})

[Documentation](/docs/{d.product.name:lowerCase:replace(' ','-')})
```
`"product": {"name": "Carbone Cloud"}` → `[Documentation](/docs/carbone-cloud)`

---

## Inject HTML: `:html`

Without `:html`, `<` and `>` of a value are escaped and the HTML prints as text. With it, the HTML string is inserted as is in the Markdown, which accepts HTML (no `:html` option, no pre-release flag), and rendered at conversion:
```markdown
### Engine

{d.richText:html}
```
`"richText": "<p>The engine is <u>powered</u> by <b>liquid oxygen</b>.</p>"` → the `<p>…</p>` is written unchanged in the Markdown. Markdown in the data (`**x**`) is inserted as is too, without `:html`.

---

## Translations and comments

`{t(key)}` for static text, `:t` for a data value; `:formatD`, `:formatN`, `:formatC` follow the `lang` of the render (SKILL.md §8f):
```markdown
# {t(Invoice)}

{t(Date)}: {d.date:formatD('DD/MM/YYYY')}

| Item | Quantity |
| ---- | -------- |
| {d.tool:t} | 1 |
```

Tags inside HTML comments are replaced too: `<!-- {d.user.name} -->` → `<!-- John -->`. To mention a tag in a note, break its syntax: `<!-- Use d.user.name for the username -->`.

---

## Limitations

| Feature | In Markdown templates |
|---|---|
| `:drop` / `:keep` | Coming soon: use `:showBegin`/`:hideBegin` blocks |
| Stylesheet for the whole document | None: inline `style` on an HTML element, or a [style template](#style-template-ostylesource) |
| Paper size, margins, header, footer | No `<carbone-pdf-options>` / header / footer elements: set them with a [style template](#style-template-ostylesource), or use an HTML template (`html-templates.md`) |
| `:imageFit` | Render error: size pictures, barcodes and charts with `<img>` attributes |
| `:transform`, file operations, signatures | Not available (`format-support.md`) |
