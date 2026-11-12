# Carbone TXT Templates

Read this file when the user designs or debugs a plain-text template (TXT, or any text-based file: SMS, plain-text email, receipt, fixed-width bank or payroll file, ZPL label, printer commands): what Carbone keeps (spaces, line breaks, line endings, UTF-8), line breaks in values, control characters, tags that print nothing and the empty lines they leave, `:drop` not available, loops over lines or multi-line blocks (a prefix before the `[i]` tag, the line after `[i+1]`), conditional blocks that remove lines without an empty line, fixed-width records with `:padl`/`:padr`/`:substr`, amounts in cents, removing accents with `:unaccent`, receipts with aligned columns and totals stored by `:set`, ZPL shipping labels (one label per item, `^CI28`, escaping `^` and `~` with `^FH`), translations with punctuation, or converting a text report to PDF.

---

## How a text template works

Carbone replaces the tags and writes every other character as it is: spaces, tabs, line breaks and the line endings of the template (save it with CRLF to get CRLF). The report is UTF-8.
```
Hi {d.customer.firstName}, your parcel {d.parcel.tracking} arrives on {d.parcel.deliveryDate:formatD('dddd, MMMM D')} ({d.parcel.slot}).
Track or reschedule: {d.trackingUrl}
{d.carrier}
```
`{ "carrier": "Acme Logistics", "customer": { "firstName": "Jane" }, "parcel": { "tracking": "AL7829341056", "deliveryDate": "2026-11-18", "slot": "morning" }, "trackingUrl": "https://track.acme.example/AL7829341056" }` →
```
Hi Jane, your parcel AL7829341056 arrives on Wednesday, November 18 (morning).
Track or reschedule: https://track.acme.example/AL7829341056
Acme Logistics
```

- **Line breaks in a value** print as line breaks, without `:convCRLF` (that formatter is for document formats).
- **Control characters** in the data are removed, except tabs and line breaks. Write printer control codes, like the paper cut command of a receipt printer, in the template.
- **A tag that prints nothing** (alias declaration, `:set`, `{o.}` option) alone on its line leaves an empty line. Write it at the start of another line (see "Receipts").
- **`:drop` and `:keep` do not exist** in text templates: the render fails with `Formatter "drop" does not exist`. Remove lines with conditional blocks or loop filters.
- Supported: substitutions, loops, formatters, conditions, translations, aggregators and `:set`. Nothing that needs a document element: no pictures, colors, charts, barcodes or hyperlinks (`references/format-support.md`).

---

## Loops: lines and multi-line blocks

Carbone repeats the text from the first `[i]` tag to the `[i+1]` tag, line breaks included, and removes the `[i+1]` tag:
- The `[i]` tag starts the first line of the block; `{d.items[i+1]}` starts the line after the block. The rest of the `[i+1]` line prints once, after the last item: `{d.items[i+1]}------------`.
- **Text before the first `[i]` tag prints once.** To repeat a prefix, open the block with an empty `[i]` tag: `{d.items[i]}- {d.items[i].name}`, `{d.payments[i]}D{d.payments[i].account:padl(18, '0')}…`.
- Tags without `[i]` inside the block print on every copy (the shipper of each ZPL label).
- A line break right after the `[i+1]` tag leaves an empty line: the ZPL report below ends with one.
- On one line, `{d.tags[i]}, {d.tags[i+1]}` writes `a, b, c, ` (separator after the last item): use `{d.tags:arrayJoin(', ')}` instead.

Line-by-line examples, empty arrays, a value from outside the array on each line → `references/csv-templates.md` "Loops".

---

## Conditional blocks: remove lines without an empty line

`:hideBegin`/`:hideEnd` remove the text between the two tags when the condition is true, `:showBegin`/`:showEnd` when it is false. The removed text runs from the begin tag to the end tag, line breaks included, so put both tags on the same side of the line breaks:
- **End of lines**: the begin tag at the end of the line above the block, the end tag at the end of the last line of the block (example below).
- **Start of lines**: the begin tag at the start of the first line of the block, the end tag at the start of the line after it.

Mixing them breaks the layout: begin at the start of a line and end at the end of a line leaves an empty line; begin at the end of a line and end at the start of a line joins the lines around the block (`A{…:hideBegin}⏎B⏎{…:hideEnd}C` → `AC`). A block on its own single line also leaves an empty line: `{d.flag:ifEQ(true):hideBegin}text{d.flag:hideEnd}` → an empty line.
```
Subtotal: {d.order.subtotal:formatC}{d.order.discount:ifEQ(0):hideBegin}
Discount: -{d.order.discount:formatC}{d.order.discount:hideEnd}
Total:    {d.order.total:formatC} ({d.order.paid:ifEQ(true):show('paid'):elseShow('pay at pickup')}){d.order.pickup:ifEQ(false):hideBegin}

Pick it up at {d.store.name}, {d.store.address},
from {d.order.readyDate:formatD('dddd, MMMM D')}. Bring this email.{d.order.pickup:hideEnd}{d.order.giftMessage:ifEM:hideBegin}

Gift message: "{d.order.giftMessage}"{d.order.giftMessage:hideEnd}

Questions? Reply to this email.
```
`"lang": "en-us"`, `{ "order": { "subtotal": 97.42, "discount": 0, "total": 97.42, "paid": false, "pickup": true, "readyDate": "2026-11-12", "giftMessage": "Happy birthday, Tom!" }, "store": { "name": "Acme Hardware Columbus", "address": "1200 Industrial Pkwy, Columbus OH" } }` →
```
Subtotal: $97.42
Total:    $97.42 (pay at pickup)

Pick it up at Acme Hardware Columbus, 1200 Industrial Pkwy, Columbus OH,
from Thursday, November 12. Bring this email.

Gift message: "Happy birthday, Tom!"

Questions? Reply to this email.
```
- The discount line is removed with no gap; each hidden block takes its empty separator line with it.
- One block can end and the next start on the same line: `…email.{d.order.pickup:hideEnd}{d.order.giftMessage:ifEM:hideBegin}`.
- Double quotes in the template text (`"{d.order.giftMessage}"`) are plain text, outside the tag.

---

## Fixed-width records

Each field starts at a set position and has a set length. Build the fields with formatters:

| Field | Tag | Input → output |
|---|---|---|
| Text, left-aligned, cut to 25 | `{d.name:unaccent:upperCase:substr(0, 25):padr(25)}` | `"Café Lumière"` → `CAFE LUMIERE` + 13 spaces |
| Number, zero-filled | `{d.account:padl(18, '0')}` | `"88120034"` → `000000000088120034` |
| Amount in cents | `{d.amount:mul(100):round(0):padl(12, '0')}` | `356.9` → `000000035690` |
| Date | `{d.date:formatD('YYYYMMDD')}` | `"2026-11-12"` → `20261112` |
| Item count | `{d.payments:len:padl(6, '0')}` | 3 items → `000003` |

- `:padl` and `:padr` never cut a value: write `:substr(0, n)` before them.
- A missing value prints nothing and shifts every following field: write `:ifEM:show('')` before `:padr` so it still fills its width (`{d.reference:ifEM:show(''):padr(8)}`).
- `:unaccent` removes accents (`ü` → `u`, `é` → `e`) for systems that read only ASCII or count widths in bytes (Carbone counts characters). Letters such as `ø`, `ł`, `æ` and `ß` stay: replace them with `:replace`.
- A line break in the data splits a record: remove line breaks from the data.

Payment file with a header `H`, one detail `D` per payment and a trailer `T`, 64 characters per record, template saved with CRLF:
```
H{d.batch.date:formatD('YYYYMMDD')}{d.company.id:padr(10)}{d.company.name:upperCase:substr(0, 45):padr(45)}
{d.payments[i]}D{d.payments[i].account:padl(18, '0')}{d.payments[i].name:unaccent:upperCase:substr(0, 25):padr(25)}{d.payments[i].amount:mul(100):round(0):padl(12, '0')}{d.payments[i].reference:substr(0, 8):padr(8)}
{d.payments[i+1]}T{d.payments:len:padl(6, '0')}{d.payments[].amount:aggSum:mul(100):round(0):padl(15, '0'):padr(57)}
```
`{ "company": { "id": "ACME000142", "name": "Acme Corporation" }, "batch": { "date": "2026-11-12" }, "payments": [ { "account": "4471209386", "name": "Müller Präzisionsteile GmbH", "amount": 12480, "reference": "INV-2041" }, { "account": "88120034", "name": "Café Lumière", "amount": 356.9, "reference": "INV-2042" }, { "account": "5500123497", "name": "Northwind Industrial Supply Co.", "amount": 7015.25, "reference": "INV-2043" } ] }` → (CRLF line endings)
```
H20261112ACME000142ACME CORPORATION                             
D000000004471209386MULLER PRAZISIONSTEILE GM000001248000INV-2041
D000000000088120034CAFE LUMIERE             000000035690INV-2042
D000000005500123497NORTHWIND INDUSTRIAL SUPP000000701525INV-2043
T000003000000001985215                                          
```
- The empty `{d.payments[i]}` tag repeats the record type `D` on each line.
- `:padr(57)` after the zero-padded total fills the trailer with spaces up to 64 characters. `:aggSum` is ENTERPRISE.

---

## Receipts: aligned columns and totals

A 42-character receipt: pad every column to a fixed width, format numbers before padding them.
```
ITEM                     QTY        AMOUNT
{d.items[i].name:substr(0, 24):padr(24)}{d.items[i].qty:padl(5)}{d.items[i].qty:mul(.price):formatN(2):padl(13)}
{d.items[i+1]}------------------------------------------
{d.items[].qty:mul(.price):aggSum:set(c.subtotal)}SUBTOTAL{c.subtotal:formatN(2):padl(34)}
TAX{c.subtotal:mul(d.taxRate):formatN(2):padl(39)}
TOTAL{c.subtotal:mul(d.taxRate):add(c.subtotal):formatN(2):padl(37)}
```
`"lang": "en-us"`, `{ "items": [ { "name": "Hex bolts M8x40, box of 50", "qty": 2, "price": 12.49 }, { "name": "Safety glasses, clear", "qty": 1, "price": 8.99 }, { "name": "Nitrile gloves L, 100 pcs", "qty": 3, "price": 14.5 }, { "name": "Measuring tape 25 ft", "qty": 1, "price": 19.95 } ], "taxRate": 0.0725 }` →
```
ITEM                     QTY        AMOUNT
Hex bolts M8x40, box of     2        24.98
Safety glasses, clear       1         8.99
Nitrile gloves L, 100 pc    3        43.50
Measuring tape 25 ft        1        19.95
------------------------------------------
SUBTOTAL                             97.42
TAX                                   7.06
TOTAL                               104.48
```
- The `:set` tag (ENTERPRISE) prints nothing: it starts the SUBTOTAL line instead of standing alone, which would leave an empty line. The TAX and TOTAL lines reuse `{c.subtotal}`.
- Width of a label + value line = label length + `:padl` width: `TAX` (3) + `padl(39)` = 42.
- `:padl` pads numbers too: `{d.items[i].qty:padl(5)}` with `2` → `    2`. Right-align a date with `{d.receipt.date:formatD('ll'):padl(20)}` → `Nov 9, 2026` padded to 20.

---

## ZPL labels

Zebra printers read ZPL, a text language: `^FO` places a field, `^FD` holds its text, `^FS` ends it, `^BC` draws a Code 128 barcode. Put the tags in the `^FD` fields; loop around `^XA` … `^XZ` for one label per item:
```
{d.packages[i]}^XA
^CI28
^PW812^LL1218
^FO40,40^A0N,28,28^FDFROM: {d.shipper.name}^FS
^FO40,205^A0N,45,45^FD{d.recipient.name}^FS
^FO500,495^A0N,40,40^FDPKG {d.packages[i].number} OF {d.packages:len}^FS
^FO80,600^BY3^BCN,220,Y,N,N^FD{d.packages[i].tracking}^FS
^FO40,920^A0N,30,30^FDORDER {d.orderId}  WEIGHT {d.packages[i].weight:formatN(1)} LB^FS
^XZ
{d.packages[i+1]}
```
`{ "orderId": "SO-58213", "shipper": { "name": "Acme Hardware DC" }, "recipient": { "name": "Ana Sánchez" }, "packages": [ { "number": 1, "weight": 12.4, "tracking": "1AC2026111200001" }, { "number": 2, "weight": 8.75, "tracking": "1AC2026111200002" } ] }` → two labels, the second one:
```
^XA
^CI28
^PW812^LL1218
^FO40,40^A0N,28,28^FDFROM: Acme Hardware DC^FS
^FO40,205^A0N,45,45^FDAna Sánchez^FS
^FO500,495^A0N,40,40^FDPKG 2 OF 2^FS
^FO80,600^BY3^BCN,220,Y,N,N^FD1AC2026111200002^FS
^FO40,920^A0N,30,30^FDORDER SO-58213  WEIGHT 8.8 LB^FS
^XZ
```
- The empty `{d.packages[i]}` tag before `^XA` repeats the whole label; `{d.shipper.name}` and the other root tags print on every label; `{d.packages:len}` gives the total.
- `^CI28` tells the printer the text is UTF-8, the encoding of the report, so `Sánchez` prints correctly.
- `^` and `~` start ZPL commands, so a value containing them breaks the label. Add `^FH` before `^FD` and encode `_`, `^`, `~` in hexadecimal, `_` first:
  ```
  ^FH^FD{d.recipient.company:replace('_', '_5F'):replace('^', '_5E'):replace('~', '_7E')}^FS
  ```
- The printer draws the barcode from `^BC` and the tracking number in `^FD`; `:barcode` is not supported in text templates.

---

## Translations

```
{t(Hi)} {d.customer.firstName}, {t(your parcel)} {d.parcel.tracking} {t(arrives on)} {d.parcel.deliveryDate:formatD('dddd LL')} ({d.parcel.slot:t}).
{t(Track or reschedule:)} {d.trackingUrl}
```
`"lang": "fr-fr"`, translations `{ "fr-fr": { "Hi": "Bonjour", "your parcel": "votre colis", "arrives on": "arrive le", "morning": "matin", "Track or reschedule:": "Suivre ou reprogrammer :" } }`, same data as the SMS above →
```
Bonjour Jane, votre colis AL7829341056 arrive le mercredi 18 novembre 2026 (matin).
Suivre ou reprogrammer : https://track.acme.example/AL7829341056
```
- Translated text is XML-encoded: `'` prints `&apos;`, `&` prints `&amp;`. Write apostrophes as `’` in the dictionary.
- `{t(...)}` keys can hold spaces and punctuation. Put the punctuation in the key when it changes with the language, like the space before a colon in French: `{t(Track or reschedule:)}`.
- `:t` translates a value from the data (`morning` → `matin`); dates follow the language (`:formatD('dddd LL')`).

---

## Encoding and output

- Save the template in UTF-8, the encoding of the report. For a system that reads only ASCII, remove the accents with `:unaccent`.
- `convertTo` `"pdf"`, `"docx"`, `"odt"` or `"html"` prints the text in a monospace font, so padded columns stay aligned.
