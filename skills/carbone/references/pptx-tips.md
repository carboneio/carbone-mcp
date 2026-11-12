# Carbone PPTX: Slide Layout Tips

Read this file when the user designs or debugs a PowerPoint (PPTX) template: where tags work on a slide (text, speaker notes, alt text, link address, chart data sheet), what a loop repeats (table rows, bullets, shapes, chart categories, slides), why shapes below a loop do not move, table loops with totals, sort, filter, dropped rows and nested groups, splitting a long list across slides, one slide per item with an ODP template, repeating and moving shapes with `:transform` (layer order, grids, matrices, score markers), removing a row, shape, picture or chart, pictures and QR codes, `:color` in PPTX tables and shapes, or native PowerPoint charts (formatting their values).

---

## Where tags go

- **Text** of a text box, shape or table cell, the **speaker notes** (`Open with the Q3 results of {d.client}.`) and the slide master (a footer on every slide).
- **Alt text** (right-click → View Alt Text): pictures `{d.client.logo}`, barcodes, `:transform`, `:color(shape, …)`, `:drop(img)`, `:drop(chart)`. Loop tags work there too: a shape without text joins a loop through its alt text. Carbone removes the tags from the alt text of the report.
- **Link address** (Insert → Link): the address can read another field than the linked text (text `{d.resources[i].title}`, address `{d.resources[i].url}`). Select only part of a paragraph to link that part. In a loop, each item gets its own address.
- **Chart data sheet** (right-click the chart → Edit Data) → "Native charts" below.

Turn off smart quotes in PowerPoint (AutoCorrect → AutoFormat As You Type): formatters need straight quotes.

---

## What a loop repeats

The element that holds the `[i+1]` tag decides what Carbone repeats. That `[i+1]` element is removed from the report.

| `[i+1]` tag in | Carbone repeats |
|---|---|
| the next row of the table | the `[i]` row with its height, fill and borders; the table grows down |
| the next paragraph of the same text box | the `[i]` paragraph with its bullet |
| another shape, in front of the `[i]` shapes | every shape from the first `[i]` shape to the `[i+1]` shape in the layer order, at the same place ("Shapes" below) |
| the next row of a chart data sheet | the chart category (one bar, point or slice per item) |
| the next slide (ODP template only) | the slide ("One slide per item" below) |

Slides use fixed positions: nothing moves to make room. Shapes below a growing table or list stay where they are, and a text box does not grow. Leave room on the slide for the longest list, or split the list across slides.

**Not supported in PPTX yet**: loops on table columns (horizontal loops) and one slide per item.

---

## Tables

Keep the total **inside** the table, in a row after the `[i+1]` row: it moves down with the rows. Compute it with aggregators rather than sending it in the data:
```
| {d.deals[i].account}               | {d.deals[i].amount:formatC(0)}       | {d.deals[i].amount:mul(.probability):div(100):formatC(0)}        |
| {d.deals[i+1].account}             |                                      |                                                                  |
| {d.deals[].account:aggCount} deals | {d.deals[].amount:aggSum:formatC(0)} | {d.deals[].amount:mul(.probability):div(100):aggSum:formatC(0)} |
```
```json
{ "deals": [ { "account": "Globex", "amount": 240000, "probability": 75 }, { "account": "Stark Systems", "amount": 180000, "probability": 50 } ] }
```
→ `Globex | $240,000 | $180,000`, `Stark Systems | $180,000 | $90,000`, `2 deals | $420,000 | $270,000` (`lang` `en-us`).

- The `[i+1]` row needs one tag, in any cell; leave its other cells empty.
- **Remove an item's row**: write the drop tag in any cell of the `[i]` row, after the value, as in `{d.projects[i].owner}{d.projects[i].cancelled:ifEQ(true):drop(row)}`.
- **Sort and filter**: the sort attribute goes before `i` in every tag; the filter on the `[i+1]` tag only:
  ```
  | {d.accounts[renewal, i].name}                          | {d.accounts[renewal, i].renewal:formatD(LL)} |
  | {d.accounts[renewal+1, i+1, status!='Churned'].name}   |                                              |
  ```
  ISO dates (`"2026-11-20"`) sort by date; the churned accounts are left out.
- **Nested groups in one table**: a group row (give it its own fill: each copy keeps it), the item rows, the items' `[i+1]` row, then the group's `[i+1]` row:
  ```
  | {d.quarters[i].name}                    |                                       |
  | {d.quarters[i].features[i].name}        | {d.quarters[i].features[i].status}    |
  | {d.quarters[i].features[i+1].name}      |                                       |
  | {d.quarters[i+1].name}                  |                                       |
  ```

---

## Bullets and paragraphs

Write `{d.wins[i]}` and `{d.wins[i+1]}` in two consecutive bullets of a text box → one bullet per item. `wins` is an array of strings, so the tags have no attribute. Each text box holds its own loop: two lists side by side are two text boxes.
```json
{ "wins": ["Revenue up 18%", "3 new enterprise customers", "Churn down to 2.1%"] }
```
A repeated paragraph can mix several tags and a link on part of it:
```
{d.resources[i].title}  {d.resources[i].description}      ← link on the title only, address {d.resources[i].url}
{d.resources[i+1].title}
```

---

## Long lists: split across slides

Give each slide its own complete loop on the same array, and filter the loop index on the `[i+1]` tag:
```
Slide 1:  | {d.items[i].name} | … |      then      | {d.items[i+1, i<10].name} |
Slide 2:  | {d.items[i].name} | … |      then      | {d.items[i+1, i>9, i<20].name} |
```
Slide 1 shows the first 10 items, slide 2 the next 10. Filter the index with strict `<` and `>` (`i>9` starts at the 11th item). Slide 2 stays, with an empty table, when the list is short: PPTX cannot remove a slide. For an unknown number of slides, use an ODP template.

---

## One slide per item: use an ODP template

Open the deck in LibreOffice Impress and save it as ODP. Duplicate the slide to repeat and replace the tags of the copy with one `[i+1]` tag; Carbone repeats the first slide for each item and removes the copy. Loops inside the slide (here a table of specs) restart for each item. Render with `"convertTo": "pptx"` to get a PowerPoint file.
```
Slide 1:  {d.products[i].name}
          {d.products[i].tagline}
          | {d.products[i].specs[i].label}   | {d.products[i].specs[i].value} |
          | {d.products[i].specs[i+1].label} |                                |
          {d.products[i].price:formatC(0)} per device, {d.products[i].warranty}
Slide 2:  {d.products[i+1].name}
```
In an ODP template, `{d.discontinued:ifEQ(true):drop(slide)}` in a text box removes the slide that contains it.

---

## Shapes: repeat and move each copy with `:transform`

A loop on shapes or pictures repeats them **at the same place**. Rules:
- Write the `[i]` tags in each shape of the block, in its text or its alt text, and the `[i+1]` tag in a separate shape (`{d.initiatives[i+1].name}`), removed from the report.
- The `[i+1]` shape must be **in front of** all `[i]` shapes in the layer order (right-click → Bring to Front). Otherwise the render fails: `The marker {d.initiatives[i+1].name} has no corresponding {d.initiatives[i]...} marker before or is not placed correctly`.
- **Every shape between the first `[i]` shape and the `[i+1]` shape in the layer order is repeated**, even without tags. Keep the loop shapes consecutive: move unrelated shapes behind the `[i]` shapes or in front of the `[i+1]` shape.
- `:transform(axis, unit)` in the alt text moves each copy from its template position (prints nothing; positive = right/down; units `cm`, `mm`, `in`/`inch`, `pt`). Draw the loop shapes where the value `0` sits (the origin of the axes), so the distance is value × scale. To move several shapes together, write the same `:transform` tags in each one.

**By index**: `.i` is the loop index, from 0. One card every 212 pt: `{d.products[i].name:print(.i):mul(212):transform(x, pt)}`.

**Grid**: 5 cards per row, 6 cm apart, rows 4 cm apart (both tags in the alt text of the card):
```
{d.stars[i].starName:print(.i):mod(5):mul(6):transform(x,cm)}
{d.stars[i].starName:print(.i):div(5):floor:mul(4):transform(y,cm)}
```

**Matrix from the data**: a halo, a dot and a label per initiative, all drawn at the origin. The halo and the dot carry, in their alt text:
```
{d.initiatives[i].effort:mul(10):transform(x, mm)} {d.initiatives[i].impact:mul(-8):transform(y, mm)} {d.initiatives[i].color:color(shape, background)}
```
The label holds `{d.initiatives[i].name}` and the same two `:transform` tags in its alt text.
```json
{ "initiatives": [ { "name": "Instant payouts", "color": "#635BFF", "effort": 4, "impact": 9 } ] }
```
→ the three shapes move 40 mm right and 72 mm up; the halo and the dot are filled with `#635BFF`.

**Marker on a scale** (no loop): a switch-case picks the distance, and the first true condition wins:
```
{d.DPE:ifLT(51):show(0):ifLT(91):show(0.75):ifLT(151):show(1.5):ifLT(231):show(2.25):ifLT(331):show(3):ifLT(451):show(3.75):ifLT(45100):show(4.5):transform(y,cm)}
```
`"DPE": 232` → the cursor moves 3 cm down. Write the tag on the cursor and on every shape that moves with it.

`:transform` on a line or a group stops the render with an error: draw lines as thin rectangles (0.5 pt high) and ungroup the shapes to move.

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

- The image keeps the width of the temporary picture and takes its own height from its proportions, from the top edge down: a portrait image grows below the temporary picture. `:imageFit(contain)` keeps it inside the temporary picture, `:imageFit(fill)` stretches it to its size.
- A barcode also takes the width of the temporary picture: draw a square for a QR code, `{d.proposalUrl:barcode(qrcode, scale:6)}`.

---

## Colors in PPTX

- Scopes: `cell`, `row`, `shape`. The `p` scope is not supported in PPTX yet, so color the text of the cell or shape instead.
- Table cell text: the tag sits in the cell, right after the value:
  `{d.services[i].status}{d.services[i].status:ifEQ('Operational'):show('15803D'):ifEQ('Degraded'):show('B45309'):elseShow('B91C1C'):color(cell, text)}`
- Shape fill: the text of the status pill is `{d.overall}`, its alt text:
  `{d.overall:ifEQ('Operational'):show('DCFCE7'):elseShow('FEF3C7'):color(shape, background)}`
- In a table, `background` works only on cells **without borders**; on a bordered cell it changes a border color. Color the text, or use an ODP template.

---

## Native charts

Insert → Chart, right-click → Edit Data, and loop in the data sheet: series names in the header row, `[i]` tags on row 2, the matching `[i+1]` tags on row 3, one per column. The chart keeps its colors, labels and axes.
```
| (header)                 | Revenue                     |
| {d.regions[i].name}      | {d.regions[i].revenue}      |
| {d.regions[i+1].name}    | {d.regions[i+1].revenue}    |
```
- Leave the value tags without a formatter and set the display format in the chart (Format Data Labels → Number, e.g. `[$$-409]#,##0` prints `$1,240,000`) → `references/advanced-features.md` "Native Charts".
- The chart of the report holds the values but no embedded data sheet: change the chart in the template.
- For a chart image drawn from the data instead, use `:chart` → `references/advanced-features.md`.
