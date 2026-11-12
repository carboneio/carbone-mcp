# Carbone SVG Templates

Read this file when the user designs an SVG template (event pass, KPI card, chart, product card, configurator, floor plan, seat map, social image): tags in text and in attributes (colors, sizes, positions, rotations, dash lengths), loops over groups of shapes and placing each copy with the loop index, bar heights from the data, self-closing shapes in a loop, conditions that remove or hide elements, pictures in `<image href>`, recoloring shapes by id with `:svgUpdate` / `:svgSelectiveUpdate` and their selectors, colors with plain tags, why `:drop` does not work in SVG, exporting from Illustrator or another design tool without breaking tags (kerning, `tspan`, `&apos;`, ligatures, text alignment), size and fonts, and converting the SVG to PNG, JPG, WebP or PDF.

---

## Where tags go

Any SVG file is a template (v5.0+). An SVG is XML: escaping and the attribute rules of `references/xml-templates.md` "Escaping: what Carbone does, what breaks" apply (`&`, `<`, `>` escaped, a `"` in data breaks an attribute).

| Where | For | Example |
|---|---|---|
| Text (`<text>` / `<tspan>`) | values, labels | `<tspan x="0" y="0">{d.attendee.firstName}</tspan>` |
| Attributes | colors, sizes, positions, URLs | `fill="{d.growth:ifLT(0):show('#df1b41'):elseShow('#16a34a')}"` |
| Between elements | conditional blocks | `{d.product.onSale:ifEQ(true):showBegin}` … `{d.product.onSale:showEnd}` |
| Comment, outside the updated groups | `:svgUpdate`, `:svgSelectiveUpdate` | `<!-- {d.parts[].color:svgUpdate('stroke', .id)} -->` |

- Without `convertTo` the report is an SVG; see "Size, fonts and conversion" for PNG, JPG, WebP or PDF.
- Colors need no formatter: an SVG color is plain text, so print it with a plain tag in a `fill` / `stroke` attribute, or recolor shapes by id with `:svgUpdate` (`:color` is for formats like DOCX, where colors live in separate style parts).
- Not available in SVG: `:drop` / `:keep` stop the render (`Formatter "drop" does not exist`): use conditional blocks or `display`. Alt-text features (picture placeholders, `:imageFit`, `:barcode`, `:chart`) do not apply: a picture is a URL printed in `href`.

---

## Text

The value takes the style of its text: font, size, color, letter spacing.
```
<text transform="translate(44 350)" fill="#fff" font-size="11" letter-spacing=".16em"><tspan x="0" y="0">{d.attendee.role:upperCase}</tspan></text>
<text transform="translate(28 524)" fill="#8b93a7" font-size="12"><tspan x="0" y="0">{d.event.venue} · {d.event.city}</tspan></text>
```
`"role": "Speaker"` → `SPEAKER`; `"venue": "Pier 27", "city": "San Francisco"` → `Pier 27 · San Francisco`

- Use `:upperCase`, not the All Caps style: Illustrator exports the capitals, and `{D.ATTENDEE.ROLE}` is not a tag.
- SVG text does not wrap: leave room for the longest value (a long last name).

---

## Attributes: colors, sizes, positions

A tag in an attribute lets the data change a color, a size, a rotation or a position:
```
<rect id="delta" fill="{d.growth:ifLT(0):show('#fdecef'):elseShow('#e8f7ee')}" .../>
<polygon id="arrow" fill="{d.growth:ifLT(0):show('#df1b41'):elseShow('#16a34a')}" transform="rotate({d.growth:ifLT(0):show(180):elseShow(0)} 70 210)" .../>
<circle id="margin" cx="440" cy="150" r="32" stroke-dasharray="{d.grossMargin:mul(201.06)} 201.06" transform="rotate(-90 440 150)" .../>
<circle id="target" cx="352" cy="150" r="32" stroke-dasharray="{d.revenue:div(.target):mul(201.06)} 201.06" .../>
<tspan x="0" y="0">{d.revenue:div(1000000):formatC(1)}M</tspan>
```
```json
{ "growth": 18.4, "grossMargin": 0.72, "revenue": 48200000, "target": 56000000 }
```
→ `fill="#e8f7ee"`, `fill="#16a34a"`, `rotate(0 70 210)`, `stroke-dasharray="144.76319999999998 201.06"`, `stroke-dasharray="173.0552142857143 201.06"`, `$48.2M` (with `"lang": "en-us"`)

- **Ring gauge**: a dashed circle whose dash length is the ratio × the circumference (2πr: `201.06` for `r="32"`); `rotate(-90 …)` starts it at the top.
- `.target` reads a sibling of the same object; `..scaleMax` a property of the parent object (`references/practical-examples.md` "Relative path (`..`) inside formatter arguments").
- Math results keep every decimal (`97.99999999999999`): harmless in an attribute; add `:round(2)` for a shorter value.
- Keep free text in text elements; attributes for colors, numbers and URLs.
- Write attribute tags in a code editor, after the export: Illustrator removes them when it opens the SVG. Keep the design file (`.ai`) as the source and add the attribute tags to each new export.

---

## Loops: repeat a group

1. In the design tool, group the elements of one item (Object > Group): the bar, its value, its label.
2. Duplicate the group and write `[i+1]` in its tags. Its other attributes can stay as exported.

Carbone repeats the first group for each item and removes the second. Every copy starts at the position of the first group: move each one with the loop index `.i` (0, 1, 2…, `references/loops-advanced.md` "Accessing the loop iterator value"):
```
<line x1="40" y1="300" x2="560" y2="300" stroke="#2a3150"/>
<g transform="translate({d.quarters[i].label:print(.i):mul(130)} 0)">
  <rect x="65" y="{d.quarters[i].revenue:div(..scaleMax):mul(-180):add(300)}" width="80" height="{d.quarters[i].revenue:div(..scaleMax):mul(180)}" fill="url(#bar)"/>
  <text transform="translate(105 326)" text-anchor="middle"><tspan x="0" y="0">{d.quarters[i].label}</tspan></text>
</g>
<g>
  <rect x="195" y="180" width="80" height="120" fill="url(#bar)"/>
  <text transform="translate(235 326)" text-anchor="middle"><tspan x="0" y="0">{d.quarters[i+1].label}</tspan></text>
</g>
<tspan x="0" y="0">{d.quarters[].revenue:aggSum:div(1000000):formatC(1)}M</tspan>
```
```json
{ "scaleMax": 18000000, "quarters": [ { "label": "Q1", "revenue": 9800000 }, { "label": "Q2", "revenue": 11400000 } ] }
```
→ `translate(0 0)` then `translate(130 0)`; Q1 bar `y="202"` and height ≈ `98`; total `$21.2M` (with `"lang": "en-us"`).

- **Bar height**: value ÷ scale maximum × the tallest bar (`180`). SVG `y` points down, so a bar standing on a baseline gets `y` = baseline − height: `:mul(-180):add(300)`.
- **Self-closing shape alone in a loop**: the `[i+1]` copy stays as an empty shape (`<circle cx="" …/>`, drawn at 0). Wrap each one in a group:
  ```
  <circle cx="{d.pts[i].x}" cy="5" r="2"/>              ← leaves <circle cx="" cy="5" r="2"/>
  <circle cx="{d.pts[i+1].x}" cy="5" r="2"/>
  <g><circle cx="{d.pts[i].x}" cy="9" r="2"/></g>       ← works
  <g><circle cx="{d.pts[i+1].x}" cy="9" r="2"/></g>
  ```

---

## Conditions: remove, switch or hide

**Remove a group**: write the block tags as plain text between two elements, around the group:
```
{d.product.onSale:ifEQ(true):showBegin}
<g id="save">
  <rect x="330" y="286" width="104" height="26" rx="13" fill="#fff1e6"/>
  <text transform="translate(344 304)"><tspan x="0" y="0">Save {d.product.saving:formatC(0)}</tspan></text>
</g>
{d.product.onSale:showEnd}
```
`"onSale": false` → the Save badge is removed.

**Switch a value** in an attribute or a text:
```
<circle id="dot" fill="{d.product.stock:ifGT(0):show('#16a34a'):elseShow('#d97706')}" .../>
<tspan x="0" y="0">{d.product.stock:ifGT(0):show(&apos;In stock&apos;):elseShow(&apos;Ships in 2 weeks&apos;)}</tspan>
```
`"stock": 0` → `fill="#d97706"`, `Ships in 2 weeks`. Illustrator exports a `'` typed in a text as `&apos;`: the tag still works, leave it as is.

**Hide without removing**: print the `display` attribute:
`display="{d.product.stock:ifLT(5):show('inline'):elseShow('none')}"`

**Remove an attribute**: a block inside the start tag. `<rect{d.x:ifNEM:showBegin} stroke="{d.x}"{d.x:showEnd} width="10" height="10"/>` with `"#123456"` → `<rect stroke="#123456" width="10" height="10"/>`, `""` → `<rect width="10" height="10"/>` (`references/xml-templates.md` "Optional elements and attributes").

---

## Pictures: a tag in `href`

Print a public URL or a Base64 data URI in the `href` of an `<image>`:
```
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ...>
  <image width="80" height="80" transform="translate(40 36) scale(.45)" xlink:href="{d.brand.logo}"/>
```
`"logo": "data:image/svg+xml;base64,PHN2Zy…"` → `xlink:href="data:image/svg+xml;base64,PHN2Zy…"`

- In Illustrator, place any picture and export with **Images: Link**: the file name goes in the `href`; replace it with the tag. Use Embed for fixed pictures.
- The `<image>` `width`, `height` and `transform` set the box; SVG fits the picture inside it (`preserveAspectRatio`, centered by default).
- Carbone downloads URL pictures when it converts the SVG to an image or a PDF. For an SVG report shown in a browser, send the pictures as data URIs.

---

## Recolor shapes by id: `:svgUpdate`, `:svgSelectiveUpdate` (ENTERPRISE)

`:svgUpdate(attrName, selectorValue, selectorType)` sets an attribute on the shapes whose `id` matches, with no tag in the shapes: product configurators, maps, floor plans, seat maps. The tag value is the attribute value. Write it in a comment outside the groups it updates (for example right after `<defs>`); it prints nothing (`<!--  -->` stays). Any comment inside an updated group stops the update of its shapes and recolors the shapes after the group:
```
<!-- {d.parts[].color:svgUpdate('stroke', .id)} -->
<g id="tires">
  <circle cx="190" cy="270" r="68" fill="none" stroke="#1f2329" stroke-width="9"/>
  <circle cx="410" cy="270" r="68" fill="none" stroke="#1f2329" stroke-width="9"/>
</g>
```
```json
{ "parts": [ { "id": "frame", "color": "#ff5a4e" }, { "id": "tires", "color": "#b88a5e" } ] }
```
→ both circles get `stroke="#b88a5e"`; the shapes of `<g id="frame">` get `#ff5a4e`; the `<g>` elements themselves are unchanged.

| `selectorType` | Updates |
|---|---|
| omitted (`'id > *'`) | the element with this id if it is a shape, and its direct child shapes; shapes in a nested group are not updated |
| `'id'` | only the element with this id, which must be a shape (on a group, nothing changes) |
| `'id *'` | the element and every shape inside it, nested groups included |

The first word can be another attribute than `id`: `'class *'`, `'data-seat'`.

- Only basic shapes get the attribute: `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon`, `path`. The attribute is added when the shape has none.
- **`:svgSelectiveUpdate(attrName, attrValue, selectorType)`**: the data selects the shapes, and the value is fixed or read from the item:
  ```
  <!-- {d.rooms[status='busy'].id:svgSelectiveUpdate('fill', '#fdecef')} -->
  <!-- {d.rooms[status='busy'].id:svgSelectiveUpdate('opacity', .op)} -->
  ```
  `{ "rooms": [ { "id": "room1", "status": "busy", "op": 0.5 }, { "id": "room2", "status": "free", "op": 1 } ] }` → `room1` gets `fill="#fdecef"` and `opacity="0.5"`; `room2` is unchanged.
- Name the shapes or groups in the Layers panel and export with **Object IDs: Layer Names**: the names become ids.
- Export with **Styling: Presentation Attributes**. With Internal CSS, the CSS classes win over the attributes set by `:svgUpdate`.

---

## Export from a design tool without breaking tags

Illustrator: File > Export > Export As, select SVG, check **Use Artboards**, then:

| Option | Value | Why |
|---|---|---|
| Styling | Presentation Attributes | Each element keeps its colors; `:svgUpdate` can change them |
| Font | SVG | Text stays text. Convert To Outlines turns the tags into paths |
| Images | Link | The file name of a placed picture goes in `href`, ready for a tag |
| Object IDs | Layer Names | Layer names become ids, for `:svgUpdate` |
| Minify | Off | One element per line, easier to edit |
| Responsive | Off | Keeps the `width` and `height` of the artboard |

Type the tags with these rules:
- **Point text**: click with the Type tool and do not drag a text box, because a text box is exported line by line at fixed positions.
- **Kerning 0** (Character panel). Auto or Optical kerning splits a tag into several `tspan`: Carbone joins the split tag, but the next `tspan` keeps its position and the text overlaps.
- **One style per tag**: a change of font, size or color inside a tag starts a new `tspan`.
- **Alignment**: Illustrator exports centered and right-aligned text at the position of its first character. Add `text-anchor="middle"` or `text-anchor="end"` with the x of the center or right edge: `transform="translate(560 92)" text-anchor="end"` for a price.
- Carbone replaces the ligature characters (ff, fi, fl, ffi, ffl, ft, st) anywhere in the SVG, so the ligatures Illustrator and Affinity Designer insert no longer break tags (v5.1.2+).

Any other tool: export text as text (never outlines), colors as presentation attributes rather than CSS classes, layer names as ids, then open the file in a code editor and check that each tag is in one piece.

---

## Size, fonts and conversion

- **Size**: keep `width`, `height` and `viewBox` on the `<svg>` element. The PNG and the PDF take this size; the PDF has one page of that size.
- **Fonts**: set them once on the `<svg>` element, with fallbacks: `font-family="Helvetica Neue, Inter, Arial, sans-serif"`. The converter uses the first font of the list it has. A Google font imported in a `<style>` element is downloaded during the conversion.
- **Convert**: render to `png`, `jpg`, `webp` or `pdf`; the SVG is drawn like in a browser, letter spacing included, on a white background.
- `"lang"` sets the formatters' language. For `"en-us"`: `{d.event.date:formatD('dddd, MMMM D')}` with `"2026-12-08"` → `Tuesday, December 8`; `{d.price:formatC(0)}` with `1290` → `$1,290`.
- XML entities declared in a DOCTYPE are not supported by the conversion: remove the DOCTYPE from old exports.
