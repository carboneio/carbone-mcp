# Carbone: Practical Examples

Read this file when the user asks about practical or real-world Carbone patterns: date/time formatting combinations, optional address blocks, checkbox rendering, an amount in words, `:ifEQ(NaN)` guard, range checks with `:and`, invoice aggregation chains, post-aggregation arithmetic, complement data (`{c.}`), `..` relative path in formatter args, `:add(0)` coercion before aggregation, debit/credit display branching with `abs():set()` / `div(-1):set()`, `:aggMax` with a filtered reference, or chained `:add` for sibling fields.

---

## Date and time formatting

**Time-only display**: reference the same field twice with different tokens to split date and time into separate cells:
```
{d.arrivalDate:formatD(DD/MM/YYYY)}   ← date column
{d.arrivalDate:formatD(HH:mm)}        ← time column
```

**Capitalised day/month names**: chain `:ucWords` after `formatD` in the locales whose day and month names are lowercase (French, Spanish, Italian, …):
```
{d.order.dateCreated:formatD('dddd LL'):ucWords()}
```
With `lang:"fr-fr"`, `"2026-05-13"` → `"mercredi 13 mai 2026"` → `:ucWords` → `"Mercredi 13 Mai 2026"`. In `en-us` the names are already capitalised (`"Wednesday May 13, 2026"`), so `:ucWords` changes nothing.

**Longer locale date format**: same pattern with a different token set:
```
{d.order.dateCreated:formatD('dddd D MMMM YYYY'):ucWords()}
```

---

## Conditional visibility

**Optional address block**: show each paragraph only when the field is non-empty. Primary form with `showBegin/showEnd` (or `hideBegin/hideEnd` with the inverse condition):
```
{d.address.street:ifNEM():showBegin}{d.address.street}{d.address.street:showEnd}
{d.address.unit:ifNEM():showBegin}{d.address.unit}{d.address.unit:showEnd}
{d.address.city:ifNEM():showBegin}{d.address.city}{d.address.city:showEnd}
{d.address.country:ifEQ(Germany):hideBegin}{d.address.country}{d.address.country:hideEnd}   ← value filter: hide the country line when it equals 'Germany'
```
Shorter alternative: one `:drop(p)` tag per paragraph, condition inverted. The tag prints nothing; the paragraph disappears entirely when the field is empty:
```
{d.address.street}{d.address.street:ifEM():drop(p)}
{d.address.unit}{d.address.unit:ifEM():drop(p)}
{d.address.city}{d.address.city:ifEM():drop(p)}
{d.address.country}{d.address.country:ifEQ(Germany):drop(p)}   ← value filter: drop the country line when it equals 'Germany'
```
Place the `:drop(p)` tag anywhere in the paragraph alongside the display field. No blank paragraph are left in the output.

**Hide a table when an array is empty** (primary form):
```
{d.order.messages:len:ifEQ(0):hideBegin}
... table contents ...
{d.order.messages:hideEnd}
```
Shorter alternative: `:drop(table)` placed in any cell of the table (e.g. a header row) removes the entire table in one tag:
```
{d.order.messages:len:ifEQ(0):drop(table)}
```
Use `:keep(table)` for the inverse: keep the table only when the condition is true.

**Conditionally show a row within a loop** (primary form with `showBegin/showEnd`):
```
{d.order.products[i].type:ifEQ(WINE):showBegin}{d.order.products[i].vintage}{d.order.products[i].type:showEnd}
{d.order.products[i+1]}
```
Shorter alternative: invert the condition and use `:drop(row)`. No `showEnd` needed:
```
{d.order.products[i].type:ifNE(WINE):drop(row)}  {d.order.products[i].vintage}
{d.order.products[i+1]}
```
The vintage row drops for every product that is not wine.

**`:elseShow` with a relative field path**: avoids repeating the full data path in the fallback:
```
{d.invoice.totalNetWeight.volume:ifEQ(T):show(MT):elseShow(.volume)}
```
`.volume` refers to the `volume` property of the same parent object (`d.invoice.totalNetWeight`).

**Multiple chained `:ifEQ:show` for value mapping**: map a field to a display symbol:
```
{d.currency:ifEQ(USD):show($):ifEQ(EUR):show(€):ifEQ(GBP):show(£)}
```
If no condition matches, the tag renders nothing. Append `:elseShow(?)` for a fallback.

**`:or` combinator**: drop a row when either of two conditions is true:
```
{d.policy.mtaDate:ifEM():or:ifEQ('N/A'):drop(row)}
```
The row drops when `mtaDate` is empty **or** equals `'N/A'`.

**Array non-empty / empty check for `showBegin`**: test an array for emptiness without iterating:
```
{d.primaryFindings:ifNEM:showBegin}
... section visible only when the array is non-empty ...
{d.primaryFindings:showEnd}
{d.primaryFindings:ifEM:showBegin}
No results found.
{d.primaryFindings:showEnd}
```
Use the bare array name (no `[i]`) for the condition. Both forms use the same field name for their `showEnd` tag.

**`:ifIN` in `showBegin`**: show a block when a string contains a substring:
```
{d.document.status:ifIN('igned'):showBegin}
... shown when status contains "igned" (e.g. "Signed", "Countersigned") ...
{d.document.status:showEnd}
```

---

## Checkbox patterns

**Two-cell PDF checkbox**: two cells in the same row, each checks for a different value. Exactly one shows `x`:
```
{d.confirmed:ifEQ('Yes I confirm'):show('x'):elseShow('')}
{d.confirmed:ifEQ('No I do not confirm'):show('x'):elseShow('')}
```
Common in compliance forms, insurance questionnaires, and regulatory documents.

**Unicode checkbox**: works in all document formats without `:imageFit` or PDF form fields:
```
{d.isApproved:ifEQ(true):show(☑):elseShow(☐)}
```

**Conditional inline separator**: show a separator only when content follows:
```
{d.item.type:ifNE(BUNDLE):showBegin}{d.item.size} | {d.item.type:showEnd}
```

---

## NaN protection and range checks (`:ifEQ(NaN)`, `:and`)

**Drop image when arithmetic produces NaN**: subtraction of two numeric fields returns `NaN` when either value is null/missing. `:ifEQ(NaN)` handles this case explicitly:
```
{d.score:sub(.benchmark):ifEQ(NaN):drop(img)}
{d.score:sub(.benchmark):ifGTE(10):drop(img)}
{d.score:sub(.benchmark):ifLTE(-10):drop(img)}
```
Three image placeholders sit in the same cell: only the matching one survives. The NaN guard is required: without it, a null value leaves all three placeholders in place.

**Range check with `:and`**: test whether a value is strictly between two bounds in a single tag:
```
{d.diff:ifGT(-10):and(.diff):ifLT(10):drop(img)}
```
`:and(.diff)` re-reads `.diff` (relative to the same parent object) before evaluating the second condition. This drops the image when the value is between -10 and +10 exclusive.

---

## Compute totals

**Line total → aggregate**: `[]` iterates without generating rows. Place the tag in a totals row below the loop:
```
{d.products[].qty:mul(.unit):aggSum:formatC(2)}
```
`.unit` is a sibling field on each product item.

**VAT-inclusive total in one pass**: Carbone evaluates simple arithmetic expressions inside formatter arguments (`*`, `/` before `+`, `-`, no parentheses):
```
{d.products[].qty:mul(.unit):mul(.vat / 100):add(.qty *.unit):aggSum:formatC(2)}
```

**Store aggregate, then use downstream**:
```
{d.products[].qty:mul(.unit):mul(.vat / 100):add(.qty *.unit):aggSum:set(d.total)}
{d.invoicePaymentList[typeSelect=Payment].amount:aggSum:set(d.paid)}
{d.total:sub(.paid):formatC(2)}
```
`[typeSelect=Payment]` filters the array before aggregating. The result is stored in `d.paid` and referenced in the balance cell.

**Amount in words next to the figure**: cheques, contracts and invoices repeat the total in letters (v5.16.0+):
```
{d.total:formatC} ({d.total:toWord(C)})
```
With `lang:"fr-fr"` and EUR, `1234.5` gives `1 234,50 € (mille deux cent trente-quatre euros et cinquante centimes)`. Both formatters read the same `lang` and currency options, so the two never disagree. Types, precision and wording keywords → `formatters.md` "Numbers in words".

**Divide a periodic total into installments**: all three cells reference the same source field:
```
{d.annualPremium:div(2):round(2):formatN(2)}    ← semi-annual
{d.annualPremium:div(4):round(2):formatN(2)}    ← quarterly
{d.annualPremium:div(12):round(2):formatN(2)}   ← monthly
```
Always `:round(2)` before `:formatN` to avoid floating-point artifacts in the displayed value.

**`:add(0)` coercion before aggregation**: when source data may contain string-encoded numbers (e.g. `"42"` instead of `42`), `:add(0)` silently converts them to numeric before aggregation. Without it, `aggSum` returns `NaN`:
```
{d.rows[].value:add(0):aggSum():round(2):formatN(2)}
```

**Store absolute value and sign-flipped value for display branching**: useful for debit/credit or positive/negative layouts where both the magnitude and the sign label are needed separately:
```
{d.balance:abs():set(d.balanceAbs)}
{d.balance:div(-1):set(d.balanceNeg)}
```
Reference `{d.balanceAbs}` for the magnitude display, then use a condition on the original `{d.balance}` to pick the correct sign label.

**Post-aggregation arithmetic before storing**: any arithmetic formatter (`:mul`, `:div`, `:round`) may follow an aggregator before `:set`. The aggregated number is treated like any other value at that point:
```
{d.invoicingQualities[]:print(.totalPrice.quantity):aggSum():mul(1000):set(d.totalQuantityGrams)}
```
`:aggSum()` totals the extracted quantities; `:mul(1000)` converts units (e.g. tons → kg); `:set` stores the derived total. Chain `:round(2)` before `:set` when floating-point precision matters.

---

## Percentage and ratio patterns

**Display a 0 to 1 ratio as a percentage (any non-spreadsheet template, or a plain-text XLSX/ODS cell)**: multiply by 100 and append the `%` character yourself:
```
{d.completionRatio:mul(100):formatN(0)} %
```

**Percentage of total from two sibling fields**: always `:round` after division to avoid floating-point artifacts:
```
{d.stats.passed:mul(100):div(.logicallyTested):round(2)}%
{d.stats.failed:mul(100):div(.logicallyTested):round(2)}%
```

**Display a percentage in an XLSX cell that has a native `%` format**: keep the cell's Excel percentage format (e.g. `0.00%`), inject the raw 0 to 1 decimal, and add `:formatN` so Carbone writes a **native number** rather than text:
```
{d.value:formatN}     ← cell formatted 0.00% → 0.032 renders as 3.20%
```
Do NOT pre-multiply by 100 here: the cell format already does ×100 and appends `%`. The cell format controls how many decimals are shown; the precision argument to `:formatN(...)` is **ignored in XLSX/ODS** (see `references/xlsx-tips.md`), so `:formatN` and `:formatN(0)` behave identically. Use the `:mul(100):append('%')` text approach above for all other template formats (anything that isn't XLSX/ODS), or for a plain-text XLSX/ODS cell with no percentage format.

---

## Complement data ({c.})

The complement object (`{c.}`) supports the exact same JSON types and the exact same formatter/filter/loop syntax as `{d.}`. Every pattern that works with `{d.}` (nested objects, arrays of strings, arrays of objects, loop iterators, aggregators, conditional formatters) also works with `{c.}`. The only semantic difference is that `{c.}` data is passed alongside the main dataset at render time and is typically pre-computed by the server.

`{c.}` accesses the **complement object** passed alongside the main data at render time. It is not a reserved namespace: every `{c.field}` except `{c.now}` is provided by the caller or created with `:set`.

**`{c.now}`** is the only built-in complement value: the render timestamp (UTC).
```
{c.now:formatD('YYYY-MM-DD HH:mm:ss')}   ← ISO timestamp
{c.now:formatD(DD/MM/YYYY)}               ← European short date
{c.now:formatD(LL)}                       ← Long locale date
```

**Complement data for template branching**: the caller passes a flag in the complement object; the template uses it to show or hide sections:
```
{c.tiered:ifGT(0):drop(table)}     ← drop when tiered > 0
{c.scCount:ifEQ(0):drop(table)}    ← drop when a precomputed count is zero
```
This lets one template serve multiple layouts without duplicating files.

**Computed complement values with `:set`**: store an aggregated value into `c.` for use in other parts of the same document:
```
{d.special_condition[].text:aggCount:set(c.scCount)}
```
Then reference `{c.scCount}` anywhere in the template, including in conditional drops as shown above.

**Multiply by a complement value, store back to complement**: formatter arithmetic arguments can reference `c.` values directly:
```
{d.overview.main_leasingrate:mul(c.taxRate):set(c.leasing_tax_amount)}
{d.leasing.events[is_special_payment=true].amount:mul(c.taxRate):set(c.sp_tax)}
```
Then reference `{c.leasing_tax_amount:formatC(2,EUR)}` elsewhere in the template.

---

## Aggregate with array filter

**Filter, count, store**:
```
{d.endorsements[group='Endorsements']:aggCount:set(d.endorsementCount)}
{d.endorsements[group='Subjectivities']:aggCount:set(d.subjectivitiesCount)}
```

**Aggregate a nested field using `:print`**: `:print` navigates into a sub-object before the aggregation; `:formatN` with a dynamic precision argument reads a sibling field:
```
{d.invoicingItems[].id:print(.grossWeight.quantity):aggSum():formatN(.precision)}
```

**`:aggMax` with a filter that references a previously `:set` value**: combine a relative-path filter with a `..` reference to a value stored earlier in the template:
```
{d.config.asOfDate:set(d.dateFilter)}
{d.records[.startDate=..dateFilter,region='EUR'].score:aggMax}
```
`..dateFilter` navigates up from the array item to find `dateFilter` at the root of the data object. Always `:set` the reference value before the tag that reads it.

---

## Chained formatter patterns

**Aggregate nested arrays in one pass**: `[]` on each level iterates silently; `aggSum()` sums across all levels:
```
{d.containers[].loadings[].quantityInTons:aggSum():formatN(3)}
```
No nested loop tag needed: the `[]` iterator produces no output rows.

**Sum multiple sibling fields and divide**: chain `:add` for each sibling field before dividing; useful for per-person or per-unit averages:
```
{d.costs.materials:add(.labor):add(.overhead):div(.units)}
```
Each `.field` is relative to the same parent object as the starting field.

**Filter, multiply sibling, aggregate**: combine array filter with per-item arithmetic before aggregating:
```
{d.Projects[].Phases[].Tasks[].Charges[Jobcodes!=''].decimal_hours:mul(.rate):aggSum:formatC}
```
Step by step: `[Jobcodes!='']` filters to non-empty job code rows → `:mul(.rate)` multiplies `decimal_hours` by sibling `rate` → `:aggSum` totals all products → `:formatC` formats as currency. `Fieldname!=''` is the pattern for "field is non-empty" in array filters.

**Scoped `aggSum(..parentField)` for partial sums per parent**:
```
{d.Projects[].OrphanCharges[Jobcodes!=''].decimal_hours:mul(.rate):aggSum(..id):set(..ChargesTime)}
```
`aggSum(..id)` scopes the aggregation to the parent `Projects` item identified by `..id` (`..` navigates up one level from `OrphanCharges`). `:set(..ChargesTime)` stores the result on the parent object: one `ChargesTime` per project, not a global total.

**Absolute `d.` path as arithmetic formatter argument**: not only relative `.sibling` paths are allowed:
```
{d.policy.financials.grossPremium:add(d.policy.financials.accessoriesFeeSum):add(d.policy.financials.IPT):formatN(2)}
```
Use absolute paths when the field to add is not a sibling of the current value.

**Unix timestamp arithmetic before `formatD`**: chain arithmetic when the source timestamp requires pre-processing:
```
{d.rawTimestamp:add(10000):mul(1000):formatD(DD/MM/YYYY, x)}
```
`:add(10000)` offsets the raw seconds value → `:mul(1000)` converts seconds to milliseconds → `:formatD(DD/MM/YYYY, x)` parses as Unix milliseconds.

**Build a date from separate month/day/year fields**: `:append` concatenates sibling fields before formatting:
```
{d.records[0].date[0].parts[0].month:append(.day):append(.year):formatD(M/D/YYYY, MMDDYYYY)}
```
`:append(.day)` → concatenate sibling `day` → `:append(.year)` → concatenate `year` → `:formatD` parses the concatenated string as `MMDDYYYY`.

**`:append` to add a formatted suffix**: useful for percentage display:
```
{d.returns.value:mul(100):formatN(2):append(%)}
```
`:mul(100)` converts a 0 to 1 ratio → `:formatN(2)` formats with 2 decimal places → `:append(%)` appends the literal `%` character. Output: `12.34%`.

---

## Relative path (`..`) inside formatter arguments

SKILL.md documents `..` for navigating up one level in a data path (e.g. `{d.child..parentProp}`). The same notation works **inside formatter arguments** to reference a field at a higher level in the hierarchy.

**Use `..` (or `.`) instead of nesting a tag inside `:show()`**: to display a different field as the output of a condition, reference it with a relative path rather than embedding a full `{d...}` or `{$alias}` tag inside the argument. The relative path is shorter, and it avoids placing an alias in argument position (an alias cannot be derived from another alias, see SKILL.md item 25).
```
{d.select.display:ifEQ('Other'):show(..freeText)}   ← relative path: preferred
{d.select.display:ifEQ('Other'):show({$dy.freeText})}   ← nested alias tag: avoid
```


Given:
```json
{
  "stats": { "passed": 45, "failed": 5 },
  "totals": { "rulesPerformed": 100 }
}
```

From inside `d.stats`, use `..` to reach a sibling of `stats` at the root level:
```
{d.stats.passed:mul(100):div(..totals.rulesPerformed):round(2)}%
```
`..totals.rulesPerformed` resolves to `d.totals.rulesPerformed`. One `..` = up one level. Two `...` = up two levels.
