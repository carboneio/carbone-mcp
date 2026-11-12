# Carbone IDML: Adobe InDesign Templates

Read this file when the user designs or debugs an Adobe InDesign (IDML) template: exporting the template, where tags go (text frames, threaded stories, table cells, parent pages, hyperlink URLs), typographer's quotes and All Caps, why a tag prints nothing or a wrong value (split across styles), how paragraph styles decide what a loop repeats, the Loop end paragraph, nested loops, lists in a sentence, why table-row loops fail, inline conditions and `showBegin`/`showEnd` blocks, the `Formatter "drop" does not exist` error, aggregators, translations and `lang`, line breaks in values, text flow (threaded frames, one badge per frame, Smart Text Reflow, auto-sizing, overset text), repeating rules and inline icons, fonts, what IDML does not support, and how to get a PDF.

---

## Template in, IDML out

- Design in InDesign, then **File > Export > InDesign Markup (IDML)**. Carbone reads the `.idml` export, not the `.indd` file.
- The report is an IDML file with the layout, styles and colors of the template. Omit `convertTo`: IDML renders to IDML only.
- **PDF**: open the report in InDesign (fonts installed, see "Text flow") and use File > Export > Adobe PDF.
- Carbone replaces the tags where they are (story text, hyperlink URLs). Pages, spreads, frames and their positions stay exactly as in the template: Carbone never adds a page or a frame (see "Text flow").

---

## Where tags go

- **Text frames**: any frame, `{d.name}`. The value takes the paragraph style, character style, size and color of its tag.
- **Table cells**: `{d.battery}` in a cell, with ` h` after it in a "Unit" character style → `"24 h"`, the unit keeps its own style. Style the text around a tag, never part of the tag.
- **Parent pages**: a tag in a parent-page frame (footer, running header) prints on every page based on it, including pages InDesign adds when it reflows the report.
- **Hyperlink URL**: Window > Interactive > Hyperlinks > New Hyperlink, URL `{d.dealer.url}` → `"https://northwind.example/tessera-one"`. The link text can be a tag too (`{d.dealer.website}`).
- Turn off **Preferences > Type > Use Typographer's Quotes** before typing tags: formatters need straight quotes, `:formatD('LL')`.
- **All Caps is safe**: a style with All Caps displays `{D.CATEGORY}` or `{T(REGISTRATION)}`, but the file keeps the tag as typed.

---

## Keep each tag in one style

InDesign stores a run of text with one formatting as one style range. A change inside a tag (another character style, a bold letter, a local font, size or color) cuts the tag into two ranges, and a tag with two styles can print nothing or a wrong value.

- Select the whole tag, braces included, before changing its font or color.
- Paste tags with Edit > Paste Without Formatting, or retype a damaged tag in one go.
- To repair a tag, select it whole, apply one character style (or [None]), then Clear Overrides (Paragraph Styles panel).
- Do not use the "tiny tag" trick of SKILL.md §9 (only the first `{` keeps its size) in IDML: keep each tag in one style.
- Edit > Edit in Story Editor shows a story's full text, overset part included: the quickest way to proof every tag.

---

## Loops: paragraph styles decide what repeats

A loop repeats **paragraphs** of one story. Write the `[i]` tags in the paragraphs to repeat and one `[i+1]` tag in the paragraph right after them. Carbone repeats the paragraphs with their styles and removes the `[i+1]` paragraph.

| Paragraph style | Text in the frame |
|---|---|
| Columns | `Product` (tab) `Price` |
| Product | `{d.products[i].name}` (tab) `{d.products[i].price:formatC(0)}` |
| Detail | `{d.products[i].finish} · {d.products[i].sku}` |
| Loop end | `{d.products[i+1].name}` |
| Note | `Prices exclude sales tax.` |

```json
{ "products": [ { "name": "Tessera One", "finish": "Graphite or chalk", "sku": "AA-T1-100", "price": 349 },
                { "name": "Tessera Mini", "finish": "Graphite, chalk or sage", "sku": "AA-TM-100", "price": 199 } ] }
```
→ `Tessera One` (tab) `$349` / `Graphite or chalk · AA-T1-100` / `Tessera Mini` (tab) `$199` / `Graphite, chalk or sage · AA-TM-100` / `Prices exclude sales tax.` (lang `en-us`).

InDesign groups consecutive paragraphs with the same paragraph formatting into one range, and Carbone repeats whole ranges. Hence the rules:
- **Loop end style**: give the `[i+1]` paragraph its own paragraph style, used by neither the last repeated paragraph nor the paragraph after it. Otherwise an empty paragraph stays under the last item.
- **Paragraph above**: the paragraph just before the loop needs another style than the first repeated paragraph (here Columns vs Product), or it is repeated too. A loop that starts its story has no such neighbor.
- **One story**: `[i]` and `[i+1]` must be in the same story (one frame, or frames threaded together). In two unthreaded frames the render fails: `The marker {d.items[i].name} has no corresponding [i+1]`.
- **Columns**: align values with tab stops in the paragraph style (Product and Price above), not with a table (see "Tables").
- **Decoration that repeats**: draw separators and labels with the paragraph style, using Paragraph Rules (Rule Above/Below) and Paragraph Shading, so each copy gets them. An icon or rule anchored inline in the repeated paragraphs, after the first `[i]` tag, repeats with them; a floating frame stays in place.
- **Keep an item together**: Keep Options > Keep with Next on each paragraph style of the item except its last one, so an item never splits across columns or pages.

---

## Nested loops

Same rules, one level deeper. Write **both** `[i+1]` tags in the same Loop end paragraph, the inner one first:

| Paragraph style | Text |
|---|---|
| Product line | `{d.lines[i].name}` |
| Product | `{d.lines[i].items[i].name}` |
| Price | `{d.lines[i].items[i].price:formatC(0)}` |
| Description | `{d.lines[i].items[i].text}` |
| Loop end | `{d.lines[i].items[i+1].name}{d.lines[i+1].name}` |

```json
{ "lines": [ { "name": "Speakers", "items": [ { "name": "Tessera One", "price": 349, "text": "…" }, { "name": "Tessera Mini", "price": 199, "text": "…" } ] },
             { "name": "Headphones", "items": [ { "name": "Halo Buds", "price": 229, "text": "…" } ] } ] }
```
→ `Speakers`, its two products, `Headphones`, its product, each paragraph in its own style.

---

## Lists in a sentence, tables

- **List in a sentence**: an inline loop in one paragraph keeps the separator after the last item (`{d.items[i].name}, {d.items[i+1].name}` → `"Graphite, Chalk, Sage, "`). Use a formatter instead:
  - `{d.items[].name:aggStr(', ')}` with `[{"name":"Graphite"},{"name":"Chalk"},{"name":"Sage"}]` → `"Graphite, Chalk, Sage"`
  - `{d.tags:arrayJoin(', ')}` with `["new","wireless","portable"]` → `"new, wireless, portable"`
- **Tables**: loops on table rows are **not supported**. Carbone copies the rows but InDesign ignores them. Use paragraphs aligned with tab stops (above), or, for a short fixed list, one row per position: `{d.products[0].name}`, `{d.products[1].name}`… (a row with no item prints empty).

---

## Conditions

**Inline**: print one value or another:
- `{d.growth:ifGTE(0):show('+'):elseShow('−')}{d.growth:abs}% compared to {d.previousYear}` with `{"growth": 18.4, "previousYear": 2025}` → `"+18.4% compared to 2025"`
- `Revenue {d.record:ifEQ(true):show('· Record year'):elseShow('')}` with `{"record": true}` → `"Revenue · Record year"`

**Blocks**: `:showBegin`/`:showEnd` keep paragraphs when the condition is true (`:hideBegin`/`:hideEnd` remove them, SKILL.md §6b). Write the begin tag at the **end of the paragraph above** the block, and the end tag at the **end of the block's last paragraph**, so no empty paragraph is left:

| Paragraph style | Text |
|---|---|
| Section | `Notes to shareholders{d.dividend:ifGT(0):showBegin}` |
| Block title | `Dividend` |
| Body | `The board proposes a dividend of {d.dividend:formatC} per share.{d.dividend:showEnd}{d.guidance:ifNEM:showBegin}` |
| Block title | `Guidance update` |
| Body | `{d.guidance}{d.guidance:showEnd}` |
| Footnote | `Figures for the fiscal year, unaudited.` |

`{"dividend": 0.42, "guidance": ""}` → Notes to shareholders / Dividend / The board proposes a dividend of $0.42 per share. / Figures for the fiscal year, unaudited.

**`:drop` and `:keep` do not exist in IDML**: `{d.flag:ifEQ(true):drop(p)}` stops the render with `Formatter "drop" does not exist` (same for `:keep`). Remove paragraphs with a `showBegin`/`showEnd` or `hideBegin`/`hideEnd` block.

---

## Values, aggregators, translations

- **Line breaks**: a `\n` in a value starts a new line in the same paragraph (`{d.address}` with `"12 Main St\nSpringfield"` → two lines, one paragraph style).
- **Aggregators work**: `Total {d.items[].price:aggSum}` with prices `10`, `20`, `5` → `"Total 35"`.
- **Translations**: static text in `{t( )}`, values with `:t`, dictionary in the `translations` render option, language from `lang` (SKILL.md §8f):
  - `{t(Program)}` → `"Programme"`; `{t(Includes lunch and the evening reception)}` → `"Déjeuner et soirée inclus"` (spaces in the key work)
  - `{d.sessions[i].type:t}` with `"Keynote"` → `"Conférence plénière"`
  - for a render with `"lang": "fr-fr"`: `{d.date:formatD('dddd D MMMM YYYY')}` with `"2026-10-15"` → `"jeudi 15 octobre 2026"`, and `{d.fee:formatC}` with `290` → `"290,00 €"`
- A translated or injected value can be longer than its tag: leave room in the frame, or let it grow (see "Text flow").

---

## Text flow: frames and pages

InDesign opens the report with the pages and frames of the template and flows the new text like in any document.

- **Overset text**: text that does not fit its frame stays hidden. Window > Output > Preflight lists overset frames before you export.
- **Frames that grow**: Object > Text Frame Options > Auto-Sizing > Height Only.
- **New pages**: turn on Smart Text Reflow (Preferences > Type) and put the looped story in a **primary text frame** (on the parent page). InDesign adds the pages when it opens the report in a window: a one-page catalog template gives a two-page report.
- **One item per frame (badges, labels, cards)**: thread the frames of the page into one story (one badge per frame), put the loop in it, and set the first paragraph of each item to Keep Options > Start Paragraph: In Next Frame. The number of frames is fixed by the template: extra items go overset, missing items leave empty frames. Text that is the same on every badge (event name) goes in a separate, unthreaded frame on each badge, with its own tag.
- **Fonts**: an IDML file does not contain its fonts, so install them on the machine that opens the report.

---

## Not supported in IDML

- Loops on table rows, and loops that create frames or pages (only paragraphs repeat; InDesign adds pages through Smart Text Reflow).
- `:drop` and `:keep` (render error): use conditional blocks.
- Dynamic pictures, barcodes, charts (`:chart`), `:color`/`{bindColor}`, `:html`, `:transform`, file operations, signatures and forms. Place pictures in InDesign; they stay as in the template.
- Any output other than IDML.

---

## Checklist before exporting the template

1. Typographer's Quotes off; every tag typed or pasted in one style, braces included.
2. Each loop: `[i]` paragraphs, then a Loop end paragraph with its own style; neighbors in other styles; `[i]` and `[i+1]` in the same story.
3. Nested loops: both `[i+1]` tags in one Loop end paragraph, inner first.
4. Conditional blocks: begin tag at the end of the paragraph above, end tag at the end of the last paragraph.
5. Frames sized for the longest value, auto-sized, or a primary text frame with Smart Text Reflow.
6. File > Export > InDesign Markup (IDML).
