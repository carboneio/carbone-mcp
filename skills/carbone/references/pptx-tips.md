# Carbone PPTX — Slide Layout Tips

Read this file when the user designs a PowerPoint (PPTX) template: where tags work on a slide, why shapes below a looped table or bullet list do not move, looping over table rows or bullets, one slide per item, moving repeated shapes or pictures with `:transform`, removing a shape, picture or chart, `:color` limits in PPTX tables and shapes, or native PowerPoint charts.

---

## Where tags go

- **Text**: text boxes, table cells, speaker notes, and the slide master (e.g. a footer on every slide).
- **Alt text** (right-click → View Alt Text): pictures `{d.client.logo}`, barcodes, `:transform`, `:color(shape, …)`, and `:drop` for a picture or chart.
- **Link address** (Insert → Link): `{d.resources[i].url}` — in a loop, each item gets its own address.

Turn off smart quotes in PowerPoint (AutoCorrect → AutoFormat As You Type) — formatters need straight quotes.

---

## Slides use fixed positions — shapes below a loop do not move

A table row loop grows the table down, and rows below the `[i+1]` row (a total) move with it. **Shapes below the table do not move.** Keep the total inside the table and leave room on the slide for the longest list:
```
| {d.products[i].name}   | {d.products[i].qty} | {d.products[i].amount:formatC} |
| {d.products[i+1].name} |                     |                                |
| Total                  |                     | {d.total:formatC}              |
```

**Bullets**: write `{d.wins[i]}` and `{d.wins[i+1]}` in two consecutive bullets of a text box → one bullet per item. Shapes below the text box do not move either; draw the box large enough for the longest list.
```json
{ "wins": ["Revenue up 18%", "3 new enterprise customers", "Churn down to 2.1%"] }
```

**Nested loop in one table**: a group row, the item rows, then the group's `[i+1]` row:
```
| {d.quarters[i].name}                    |                                       |
| {d.quarters[i].features[i].name}        | {d.quarters[i].features[i].status}    |
| {d.quarters[i].features[i+1].name}      |                                       |
| {d.quarters[i+1].name}                  |                                       |
```

**Not supported in PPTX yet**: loops on table columns (horizontal loops) and one slide per item.

---

## One slide per item — use an ODP template

Open the deck in LibreOffice Impress and save it as ODP. Write the `[i]` tags on the slide to repeat and an `[i+1]` tag on the next slide; that next slide is removed from the report. Render with `"convertTo": "pptx"` to get a PowerPoint file.
```
Slide 1:  {d.products[i].name}
          {d.products[i].specs[i].label}    {d.products[i].specs[i].value}
          {d.products[i].specs[i+1].label}
          {d.products[i].price:formatC(0)}
Slide 2:  {d.products[i+1].name}
```
In an ODP template, `{d.discontinued:ifEQ(true):drop(slide)}` in a text box removes the slide that contains it.

---

## Repeated shapes and pictures — move each copy with `:transform`

A loop on a shape or picture repeats it **at the same place**. Write `:transform(axis, unit)` in its alt text to move each copy (prints nothing; positive = right/down, negative = left/up; units `cm`, `mm`, `in`/`inch`, `pt`):

- **By index** — one card every 212 pt: `{d.products[i].name:print(.i):mul(212):transform(x, pt)}`
- **By data** — place each item on a matrix; several tags share one alt text:
  ```
  {d.initiatives[i].effort:mul(10):transform(x, mm)} {d.initiatives[i].impact:mul(-8):transform(y, mm)} {d.initiatives[i].color:color(shape, background)}
  ```

Rules:
- A loop can span several shapes, each carrying the `[i]` tags. The shape holding the `[i+1]` tag (e.g. `{d.initiatives[i+1].name}`) must be **in front of** the `[i]` shapes in the layer order (right-click → Bring to Front).
- `:transform` on a line or a group stops the render with an error: draw lines as thin rectangles and ungroup the shapes to move.

---

## Removing elements

`:drop` in PPTX removes a `row`, `col`, `p`, `shape`, `img`, `chart` or `table`. Write the tag in the element's text, or in the alt text of a shape, picture or chart:
```
Blocker  {d.blocker}{d.blocker:ifEM:drop(shape)}     ← in the callout's text
{d.client.logo:ifEM:drop(img)}                       ← picture alt text (else an empty value shows a crossed square)
{d.regions:ifEM:drop(chart)}                         ← chart alt text
```
To remove a slide, use an ODP template (above).

---

## Pictures and barcodes

The image takes the width of the temporary picture and keeps its proportions. `:imageFit(contain)` fits it inside the temporary picture, `:imageFit(fill)` stretches it to its size. A barcode also takes the width of the temporary picture, so draw a square for a QR code: `{d.proposalUrl:barcode(qrcode, scale:6)}`.

---

## Colors in PPTX

- Scopes: `cell`, `row`, `shape`. The `p` scope is not supported in PPTX yet — color the text of the cell or shape instead.
- Table cell text, in the cell:
  `{d.services[i].status:ifEQ('Operational'):show('15803D'):ifEQ('Degraded'):show('B45309'):elseShow('B91C1C'):color(cell, text)}`
- Shape fill, in its alt text:
  `{d.overall:ifEQ('Operational'):show('DCFCE7'):elseShow('FEF3C7'):color(shape, background)}`
- In a table, `background` works only on cells **without borders**; on a bordered cell it changes a border color. Color the text, or use an ODP template.

---

## Native charts

Same as Word: Insert → Chart, right-click → Edit Data, and loop in the data sheet — `[i]` tags on row 2, under the header row, and the matching `[i+1]` tags on row 3, one per column. The chart keeps its colors, labels and axes.
```
| (header)                 | Revenue                     |
| {d.regions[i].name}      | {d.regions[i].revenue}      |
| {d.regions[i+1].name}    | {d.regions[i+1].revenue}    |
```
For a chart image drawn from the data instead, use `:chart` → `references/advanced-features.md`.
