# Carbone XML Templates

Read this file when the user designs an XML template (e-invoice such as Factur-X / ZUGFeRD CII, SEPA pain.001 payment file, sitemap, product feed, shipping or API payload): where tags go (element text, attributes, comments), what Carbone escapes and why a double quote breaks an attribute, character references and encoding, loops over repeated elements, self-closing elements in a loop, nested loops with control sums, removing an optional element or attribute, `:drop` not existing in XML, machine date and decimal formats, totals with aggregators and `:set`, namespaces, and embedding the XML in a PDF.

---

## Where tags go

Any XML file is a template (v2.0+). Write tags in element text, in attribute values and in comments. Carbone replaces only the tags: the XML declaration, namespaces and prefixes (`g:`, `ram:`), comments and indentation stay as written. An XML template renders to XML only; omit `convertTo`.
```
<City postalCode="{d.recipient.postalCode}">{d.recipient.city}</City>
<Package weight="{d.package.weight}" unit="kg">
<!-- ref {d.ref} -->
```
```json
{ "recipient": { "postalCode": "02108", "city": "Boston" }, "package": { "weight": 4.2 }, "ref": "R-1" }
```
→ `<City postalCode="02108">Boston</City>`, `<Package weight="4.2" unit="kg">`, `<!-- ref R-1 -->`

- A missing or empty value prints an empty element: `<Note></Note>`. Most schemas reject an empty date or amount: remove the element with a conditional block ("Optional elements and attributes" below).
- Numbers print as in the JSON: `1249.99`, `4.2`.
- Write the template in a code editor and save it in UTF-8, with `encoding="UTF-8"` in the declaration.

---

## Escaping: what Carbone does, what breaks

Carbone escapes `&`, `<` and `>` in every value (text, attributes, comments) and removes the control characters XML forbids:
```
<Name>{d.recipient.name}</Name>
<loc>{d.pages[i].url}</loc>
```
`"Vandelay & Sons Industries"` → `<Name>Vandelay &amp; Sons Industries</Name>`; `"https://shop.example/p?color=green&size=2p"` → `<loc>https://shop.example/p?color=green&amp;size=2p</loc>`

**Double quotes are not escaped.** A `"` in a value printed inside an attribute closes the attribute and the report is invalid XML:
```
<Party name="{d.name}"/>                                        ← breaks on a quote in the data
<Party name="{d.name:preserveCharRef:replace('"', '&#34;')}"/>  ← safe
```
`"Vandelay \"Best\" & Co"` → first line `<Party name="Vandelay "Best" &amp; Co"/>` (invalid), second line `<Party name="Vandelay &#34;Best&#34; &amp; Co"/>`.
- Keep free text in elements, and codes or identifiers in attributes (`currencyID="EUR"`, `schemeID="0002"`). A `"` in element text needs nothing.
- A `"` inside a single-quoted argument is valid, as in `:replace('"', '&#34;')`; only double quotes used as argument delimiters are an error.

**Character references**: Carbone escapes the `&` of a reference sent in the data; `:preserveCharRef` keeps it. Use it for a receiver that requires an encoding other than UTF-8:
```
<C>{d.cafe}</C>                   "caf&#233;" → <C>caf&amp;#233;</C>
<D>{d.cafe:preserveCharRef}</D>   "caf&#233;" → <D>caf&#233;</D>
```

---

## Loops: repeat an element

Two elements: the element to repeat, with `[i]` in its tags, then a copy with `[i+1]` in one tag. Carbone repeats the element with its children and attributes, and removes the `[i+1]` element. The `[i+1]` copy needs only one tag; drop its other children. A filter goes on the `[i+1]` tag only:
```
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>{d.pages[i].url}</loc>
    <lastmod>{d.pages[i].updatedAt:formatD('YYYY-MM-DD')}</lastmod>
  </url>
  <url>
    <loc>{d.pages[i+1, noindex=false].url}</loc>
  </url>
</urlset>
```
```json
{ "pages": [
  { "url": "https://www.acme.example/", "updatedAt": "2026-11-10T08:15:00Z", "noindex": false },
  { "url": "https://www.acme.example/cart", "updatedAt": "2026-11-10T09:00:00Z", "noindex": true }
] }
```
→ one `<url>` for the home page; the cart page is left out.

**Self-closing elements**: when the tags of the repeated element sit only in its attributes, give it an end tag. With `<Item .../>` the `[i+1]` copy stays in the report as an empty element:
```
<Item code="{d.items[i].code}"/>              ← leaves <Item code=""/> after the last item
<Item code="{d.items[i+1].code}"/>

<Item code="{d.items[i].code}"></Item>        ← works: one <Item> per item, nothing left
<Item code="{d.items[i+1].code}"></Item>
```
Wrapping each self-closing element in a parent element works too. `<Item></Item>` and `<Item/>` are the same element for every XML parser.

---

## Nested loops and control sums

A loop can contain another loop. In this SEPA credit transfer (pain.001.001.09), `PmtInf` repeats per batch and `CdtTrfTxInf` per payment of the batch. The inner `[i+1]` element closes the inner loop, the outer `[i+1]` element the outer loop:
```
<GrpHdr>
  <NbOfTxs>{d.batches[].payments[].amount:aggCount}</NbOfTxs>
  <CtrlSum>{d.batches[].payments[].amount:aggSum:round(2)}</CtrlSum>
</GrpHdr>
<PmtInf>
  <PmtInfId>{d.batches[i].id}</PmtInfId>
  <NbOfTxs>{d.batches[i].payments[].amount:aggCount}</NbOfTxs>
  <CtrlSum>{d.batches[i].payments[].amount:aggSum:round(2)}</CtrlSum>
  <ReqdExctnDt><Dt>{d.batches[i].executionDate}</Dt></ReqdExctnDt>
  <CdtTrfTxInf>
    <PmtId><EndToEndId>{d.batches[i].payments[i].invoice}</EndToEndId></PmtId>
    <Amt><InstdAmt Ccy="EUR">{d.batches[i].payments[i].amount}</InstdAmt></Amt>
    <Cdtr><Nm>{d.batches[i].payments[i].name}</Nm></Cdtr>
  </CdtTrfTxInf>
  <CdtTrfTxInf>
    <PmtId><EndToEndId>{d.batches[i].payments[i+1].invoice}</EndToEndId></PmtId>
  </CdtTrfTxInf>
</PmtInf>
<PmtInf>
  <PmtInfId>{d.batches[i+1].id}</PmtInfId>
</PmtInf>
```
```json
{ "batches": [
  { "id": "BATCH-20261112", "executionDate": "2026-11-12", "payments": [
    { "invoice": "INV-88412", "amount": 1249.99, "name": "Globex GmbH" },
    { "invoice": "INV-88419", "amount": 860.25, "name": "Initech B.V." } ] },
  { "id": "BATCH-20261115", "executionDate": "2026-11-15", "payments": [
    { "invoice": "INV-88433", "amount": 3420.17, "name": "Umbrella Logistica S.L." } ] }
] }
```
→ header `NbOfTxs` `3`, `CtrlSum` `5530.41` (whole file, `[]` on both arrays); first `PmtInf` `2` / `2110.24`, second `1` / `3420.17` (`[i]` on the batch, `[]` on its payments = per-batch subtotal, `references/formatters.md` "Aggregator Formatters").

---

## Optional elements and attributes

**Remove an element** when its value is missing with a conditional block. Write the begin tag at the end of the line above the block and the end tag at the end of the block's last line: the removed block leaves no empty line (`:hideBegin` / `:hideEnd` work the same way):
```
<g:price>{d.products[i].price} USD</g:price>{d.products[i].salePrice:ifNEM:showBegin}
<g:sale_price>{d.products[i].salePrice} USD</g:sale_price>{d.products[i].salePrice:showEnd}
```
`"salePrice": 199.99` → the `g:sale_price` line is kept; `"salePrice": null` → removed.

**One element or the other**: close one block and open the next on the same line:
```
<g:brand>{d.products[i].brand}</g:brand>{d.products[i].gtin:ifNEM:showBegin}
<g:gtin>{d.products[i].gtin}</g:gtin>{d.products[i].gtin:showEnd}{d.products[i].gtin:ifEM:showBegin}
<g:identifier_exists>no</g:identifier_exists>{d.products[i].gtin:showEnd}
```
`"gtin": "00012345678905"` → `<g:gtin>00012345678905</g:gtin>`; `"gtin": ""` → `<g:identifier_exists>no</g:identifier_exists>`

**One value or the other**: an inline condition, in text or in an attribute:
`{d.products[i].stock:ifGT(0):show('in_stock'):elseShow('out_of_stock')}` with `0` → `out_of_stock`

**Remove an attribute**: write the block inside the start tag:
```
<Contact{d.email:ifNEM:showBegin} email="{d.email}"{d.email:showEnd}>
```
`"a@x.example"` → `<Contact email="a@x.example">`; `""` → `<Contact>`. The template is no longer well-formed XML (the report is): edit it as text, not in an XML editor that validates. Inside a loop, give the element an end tag (see "Self-closing elements" above).

`:drop` and `:keep` do not exist in XML templates: `{d.x:ifEM:drop(p)}` stops the render with `Formatter "drop" does not exist`. Use conditional blocks.

---

## Dates and numbers in machine formats

XML schemas expect machine formats, not the formats of a language:

| Value | Tag | Result |
|---|---|---|
| Date (`xs:date`) | `{d.date:formatD('YYYY-MM-DD')}` | `2026-11-12` |
| Date and time (`xs:dateTime`) | `{d.createdAt:formatD('YYYY-MM-DDTHH:mm:ssZ')}` | `2026-11-10T09:30:00+01:00` |
| Factur-X date (format 102) | `{d.issueDate:formatD('YYYYMMDD')}` | `20261110` |
| Decimal (`xs:decimal`) | `{d.total:round(2)}` | `3152.64` |

- A date with a time is converted to the report time zone (`Europe/Paris` by default): `"2026-11-10T08:30:00Z"` → `2026-11-10T09:30:00+01:00`. Add `{o.timezone=UTC}` to the template to keep UTC. A date without a time is not converted.
- `:round(2)` always writes a dot and drops trailing zeros: `49.9` → `49.9`.
- Exactly two decimals: add `{o.lang=en-us}` to the template (it sets the language of the whole report), then `{d.price:formatN(2):replace(',', '')}`: `49.9` → `49.90`, `1249.9` → `1249.90`.
- `:formatN` and `:formatC` alone add thousands separators and follow the language (`1 234,50` in French): never use them alone for a schema value.

---

## Totals: aggregators and `:set`

Compute amounts the data does not carry. `:set` prints nothing: write it at the end of a line, above the tags that read the stored value. A stored `c.` value can feed another `:set`:
```
<ram:ApplicableHeaderTradeSettlement>{d.lines[].qty:mul(.price):aggSum:round(2):set(c.net)}
  <ram:InvoiceCurrencyCode>{d.currency}</ram:InvoiceCurrencyCode>{c.net:mul(d.vatRate):div(100):round(2):set(c.vat)}
  <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    <ram:TaxBasisTotalAmount>{c.net}</ram:TaxBasisTotalAmount>
    <ram:TaxTotalAmount currencyID="{d.currency}">{c.vat}</ram:TaxTotalAmount>
    <ram:GrandTotalAmount>{c.net:add(c.vat):round(2)}</ram:GrandTotalAmount>
    <ram:DuePayableAmount>{c.net:add(c.vat):sub(d.prepaid):round(2)}</ram:DuePayableAmount>
```
```json
{ "currency": "EUR", "vatRate": 20, "prepaid": 500,
  "lines": [ { "qty": 12, "price": 129.99 }, { "qty": 24, "price": 64.49 }, { "qty": 1, "price": 45 } ] }
```
→ `3152.64`, `630.53`, `3783.17`, `3283.17`; the two `:set` tags leave nothing on their lines.

- Factur-X MINIMUM has no invoice lines (above). BASIC, EN 16931 and EXTENDED add them: repeat `ram:IncludedSupplyChainTradeLineItem` with a loop.
- To embed the XML in the PDF invoice, generate it with the XML template, then pass it, as a Base64 data URI or a URL, in the data of the invoice template: `{d.invoiceXml:attachFile('factur-x.xml')}` (`references/advanced-features.md` "File operations: details").
- Before going live, check a few reports with the receiver's schema or validator.
