# Carbone DOCX/ODT — Section & Layout Tips

Read this file when the user asks about Carbone tags in Word/LibreOffice headers and footers, why a header tag throws "missing i+1", how to display a loop value in a header or footer, about floating text boxes used to bridge sections, about page numbers, repeated table headers or a table of contents, how to loop over list items or repeat a heading with its table, how to generate one page per item or insert a page break inside a loop without a trailing blank page, where to put `showBegin`/`showEnd` so a removed block leaves no empty paragraph, why a loop does not repeat a picture, how to keep merged cells/rows inside a table loop, or how to draw a horizontal (newspaper-column) repetition in a LibreOffice table.

---

## Headers, body, and footers are independent sections

In DOCX and ODT templates, the **header**, **body**, and **footer** are three independent sections. Carbone processes tags inside each, but a single Carbone loop must be entirely contained within one section. Placing `[i]` in one section and `[i+1]` in another triggers a `missing i+1` error because Carbone cannot find the pattern to repeat across the section boundary.

What you can put inside a single section (header, body, or footer), without crossing the boundary:

- Root data — `{d.title}`
- Fixed-index access at any depth — `{d.list[0].name}`, `{d.list[0].sub[0].field}`
- Aggregators (print one value, no loop needed) — `{d.list[].field:aggStrD}`, `{d.list[].qty:aggSum}`
- A self-contained loop — both `[i]` and `[i+1]` in the same section

An HTML template converted to PDF also takes a header and footer with tags (`<carbone-pdf-header>` / `<carbone-pdf-footer>`, see `references/html-templates.md`), but it is identical on every page — a different first-page or odd/even header needs DOCX or ODT.

---

## Cross-section loop values — display a body-loop value in the header or footer

When a loop is defined in one section but a tag from that loop needs to appear in another, you have three options. Pick the simplest one that fits.

### Option 1 — aggregator directly in the target section

Works when one combined value (concatenated list, sum, average, count, …) is enough:

```
(header) {d.orders[].lines[].product.name:aggStrD}
```

No loop context is needed because aggregators print exactly one value. The same expression works in the body or footer.

### Option 2 — compute in the body, read anywhere via `c.`

When the same value needs to appear in multiple sections, or when the target section can't host the aggregator chain:

```
(body, anywhere)   {d.orders[].lines[].product.name:aggStrD:set(c.productList)}
(header / footer)  {c.productList}
```

`c.` (complement data) is global and has no loop context, so it works directly in any section. Prefer this over relative `:set` (`...productList`) when the consumer is in a different section — see `references/set-patterns.md` "Relative `:set` dot rule" for the trade-offs.

### Option 3 — floating text box (officially recommended for per-iteration loop tags)

When you need a tag that **keeps its loop context** (so `[i]` resolves correctly) but must visually appear in a section that does not contain the loop, use a floating text box. This is the recommended Carbone pattern for cross-section loop tags.

The core mechanic: the text box **stays anchored in the section where the loop is defined**, but its visual position is moved over the target section. The anchor never crosses the section boundary — only the rendered position does. That way the inner tag inherits the loop's context, while the user sees the value in the header or footer.

Steps (Word):

1. Insert a text box **inside the same section as the loop** (typically the body). Leave the anchor where Word places it — anchored to a paragraph in that section.
2. Right-click the text box → **More Layout Options**:
   - **Horizontal**: Absolute position, to the right of **Page** (set value to slide the box horizontally).
   - **Vertical**: Absolute position, below **Page** (set value to slide the box up into the header band, or down into the footer band).
3. Inside the text box, write whatever Carbone tag needs the loop context — e.g. `{d.orders[i].customer}`, or an aliased / aggregated / `:set`-stored variant depending on what your data already provides. The recipe doesn't require any specific aggregation or alias declaration; it only requires that the tag inside the box references the loop that the anchor belongs to.

**Critical**: do not drag the anchor itself into the header or footer band. Only the visual position is moved. If the anchor ends up in a different section, the loop context is lost and the tag will not resolve.

Caveats:

- The displayed value is whatever the iteration sees on the page where the anchor falls. For a value that should be identical on every page, use a non-partitioned aggregator (Option 1 or 2) instead.
- `:set` → read order is guaranteed only within the same section. If the box reads a `:set` value, keep the producer in the same section.
- Avoid using floating text boxes for decorative content inside loops (set such elements to "In line with text" — see SKILL.md §9). Floating-over-another-section is the supported exception, not the default.

---

## Page numbers, repeated table headers, table of contents

Build these with the editor, not with tags. Carbone updates them in every generated report, computed on each of its pages:

| Need | Word | LibreOffice |
|---|---|---|
| Page number / page count | Insert → Page Number, or the `PAGE` and `NUMPAGES` fields | Insert → Field → Page Number / Page Count |
| Table header row on every page | Right-click the header row → Table Properties → Row → "Repeat as header row at the top of each page" | Right-click the header row → Table Properties → Text Flow → "Repeat heading" |
| Table of contents | References → Table of Contents | Insert → Table of Contents and Index |

Fields and tags mix freely, e.g. a footer `{d.customer}, {d.statement.period}  Page PAGE of NUMPAGES`. The table of contents lists the generated headings with their page numbers.

---

## Loops beyond table rows — list items, a heading with its table, columns

**List items.** Write `[i]` and `[i+1]` in two consecutive items of the same bulleted or numbered list; Word numbers the generated items. For an array of strings the tag has no attribute:
```
• {d.deliverables[i]}
• {d.deliverables[i+1]}

1. {d.milestones[i].name}    {d.milestones[i].date}
2. {d.milestones[i+1].name}
```
```json
{ "deliverables": ["40 laptops imaged", "Onboarding session"],
  "milestones": [{ "name": "Kick-off meeting", "date": "December 1" }] }
```

**A heading and its table per item.** A loop repeats everything between its `[i]` and `[i+1]` tags, whole tables included. Put the outer `[i]` in the heading, the inner loop in the table, and the outer `[i+1]` in a paragraph after the table:
```
{d.categories[i].name}                                   ← heading paragraph
| {d.categories[i].items[i].name}   | {d.categories[i].items[i].amount:formatC} |
| {d.categories[i].items[i+1].name} |                                           |
| Subtotal                          | {d.categories[i].subtotal:formatC}        |
{d.categories[i+1].name}                                 ← paragraph after the table
```

**Horizontal loop column width.** In a horizontal loop (one table column per item), every generated column takes the width of the `[i]` column — size that column for the number of columns the data will produce. Syntax → `references/loops-advanced.md` "Horizontal loop".

---

## One page per item — page breaks in a loop

For certificates, letters or payslips, repeat the whole page: write the first `[i]` tag in the first paragraph of the page and set **Page break before** on that paragraph (Word: Paragraph → Line and Page Breaks; LibreOffice: Paragraph → Text Flow → Breaks → Page / Before). End the page with the `[i+1]` paragraph:
```
Acme Corporation   No. {d.attendees[i].number}     ← first paragraph, "Page break before"
{d.attendees[i].name}
{d.course.name}
{d.attendees[i+1].name}                            ← last paragraph of the page
```
The loop starts at the paragraph holding the first `[i]` tag; paragraphs above it print once. The break leads each item, so no blank page trails the last one.

### Manual page break inside the loop

**Problem**: a manual page break placed inside a body loop repeats on every iteration, so a blank page trails the last item. **Fix**: drop the break on the last iteration only.

Emit this tag on the paragraph that holds the page break:

```
{d.list[i]..list:len:sub(1):ifEQ(.i):drop(p)}
```

- `..list:len` → length of the parent array
- `:sub(1)` → last index (zero-based)
- `:ifEQ(.i)` → true only on the last iteration (`.i` = current loop index)
- `:drop(p)` → deletes that paragraph, and its page break, when true

Shorter form (filtered loop tag): `{d.list[i, i=-1].id:drop(p)}` — `[i, i=-1]` matches only the last element, so the paragraph is dropped there. The tag must read an attribute that is always present (here `id`): on an object with no attribute, or a missing one, nothing is dropped.

Swap `list` for the real array path (it appears twice).

---

## Conditional blocks — no empty paragraph left behind

Write the begin tag at the **end of the paragraph above** the block, and the end tag at the **end of the last paragraph** of the block. When the condition is false, the block is removed without leaving an empty paragraph, and a numbered list (contract clauses) is renumbered. A begin tag at the start of a paragraph leaves an empty paragraph in the report.
```
The customer pays {d.fee:formatC} per month.{d.plan:ifEQ('Enterprise'):showBegin}
3. Premium support
A dedicated engineer answers within one hour.{d.plan:showEnd}{d.region:ifEQ('EU'):showBegin}
4. Data processing
Personal data is processed in the European Union.{d.region:showEnd}
5. Term
```
```json
{ "fee": 2490, "plan": "Enterprise", "region": "US" }
```
One paragraph can close a block and open the next. `:hideBegin` / `:hideEnd` follow the same placement.

---

## Pictures in loops — anchor the picture in line

A loop repeats a temporary picture only when it is anchored to the text. One picture in the repeated row is enough, with `{d.damages[i].photo}` in its alt text.

- **Word**: Picture Format → Wrap Text → **In Line with Text**. With any other wrapping the picture floats: it is replaced once, but a loop does not repeat it.
- **LibreOffice**: Anchor → **As Character**. A floating picture (To Page, To Paragraph, To Character) is replaced once, but a loop of floating pictures stops the render with an error.

---

## Keep merged cells inside a table loop (nest a table in a table)

**There is no Carbone tag for this in DOCX/ODT** (`:mergeCell` is XLSX only). Carbone drops a merged cell that shares a table with a row loop — the merged column is flattened into rows. The fix is a layout one: put the loop in an inner table so the merge lives in the outer table.

1. Outer table: one row, two or more columns. Merged-cell content goes in the first column.
2. Next column: insert an **inner** table and put the loop there, one inner row per item — first inner row `{d.rows[i].ref}` `{d.rows[i].qty}`, second inner row `{d.rows[i+1].ref}`.
3. Make the inner table flush so the nesting is invisible:
   - **Word**: inner table → Table Properties → Table → Options… → left/right cell margins = `0`.
   - **LibreOffice**: inner table → Table Properties → Borders → padding/spacing = `0`.

The outer cell never loops, so its merge survives; only the inner table repeats.

`:drop(col)` has the same limit: a column that contains merged cells cannot be removed.

---

## Horizontal repetition in a LibreOffice table (newspaper-column flow)

This flows a flat list **down the page across newspaper-style columns** — a page-layout effect, not a table growing sideways. It uses a normal **vertical** loop inside a multi-column Section; the Section (not a tag) creates the left-to-right flow. In LibreOffice Writer/ODT:

1. Insert → Section → Columns tab → set the column count to the max items you want per row.
2. Inside the section, insert a one-row table with a standard loop: `{d.items[i].name}` … `{d.items[i+1].name}`.
3. Table Properties → Text Flow → **uncheck** "Allow table to split across pages and columns" (keeps each block whole so it flows into the next column).
4. Optional: a second section above for fixed column titles.

To grow a **table** sideways (one column per item) — a real tag pattern that works in any table format except PPTX — see `references/loops-advanced.md` "Horizontal loop". For a two-dimensional grid (rows **and** columns at once), use the bidirectional loop → same file, "Bidirectional loop".
