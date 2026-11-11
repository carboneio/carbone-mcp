# Carbone `:set` — Advanced Patterns Reference

Read this file when the user needs to solve complex data transformation problems using `:set`: building dynamic URLs, type conversion, date aggregation, normalizing datetime fields in-place, extracting substrings onto array items, JSON restructuring, flat list grouping, pagination into N-column rows, pairing sibling arrays, filtering a parent list based on child content, or creating arrays from static strings.

---

## Building a dynamic URL with a static base path
Store a constant string into `c.` first, then prepend it onto a dynamic value:
```
{d:print('https://example.com/api/details?ref='):set(c.url)}
{d.report_items.item_code:prepend(c.url)}
```
Result: `https://example.com/api/details?ref=ITEM001` (where `item_code = "ITEM001"`).
This avoids repeating the full base URL on every tag and makes it easy to update in one place.

---

## Create a new array from a static comma-separated string defined inline
```
{d:print('val1,val2,val3'):split(','):set(d.values)}
```
Useful when you need a fixed list inside the template without adding it to the JSON.

---

## Get the newest date from a filtered list
Convert each date to a Unix timestamp first (ISO date strings cannot be compared with `aggMax` beyond year-level — months and days require numeric comparison), store the timestamp, aggregate the max, flag the winner, then filter:
```
{d.items[status!=''].endDate:formatD(X):set(.endDateX)}
{d.items[status!=''].endDateX:aggMax:ifEQ(.endDateX):show('true'):elseShow('false'):set(.newest)}
{d.items[newest=true].endDate}
```
⚠️ Do NOT use `aggMax` directly on date strings — it compares lexicographically and gives correct results only for year-level comparisons, not months or days.

---

## Store multiple aggregation results then combine in a complex condition
When conditions span multiple aggregations, store each result first, then evaluate:
```
{d.tableA.contacts[].id:aggCount:set(c.totalA)}
{d.tableB.contacts[].id:aggCount:set(c.totalB)}
{c.totalA:ifEQ(0):and(c.totalB):ifEQ(0):show('<br/>'):elseShow('')}
```

---

## Filter a parent list based on child list content
Use `:aggStr` + `:ifIN` + `:set` to write a boolean flag onto each parent based on whether a target value exists in its children:
```
{d.items[].subItems[].label:aggStr('',..name):ifIN('Target Value'):show(true):elseShow(false):set(..hasTarget)}
```
Then filter the parent loop normally:
```
{d.items[hasTarget=true, i].name}
{d.items[hasTarget=true, i+1].name}
```

### Relative `:set` dot rule

A single dot `.X` writes `X` as a sibling of the value being read (inside its direct container). Each additional dot moves the write target one container up. For a chain reading `d.A[].B[].C.name`:

- `:set(.X)` → inside `C` (sibling of `name`)
- `:set(..X)` → inside `B[i]` (sibling of `C`)
- `:set(...X)` → inside `A[i]` (sibling of `B`)

Add more dots to go further up — there is no fixed limit. Each extra dot climbs one more container level, and you can keep climbing all the way up to the root element if needed.

A **non-partitioned aggregator** followed by a relative `:set` writes the **same aggregated value onto every item at the target level**:
```
{d.orders[].lines[].product.name:aggStrD:set(...productList)}
```
After this runs, every `d.orders[i]` holds the same combined string, so `{d.orders[i].productList}` (or `{$o[i].productList}` via an alias) prints the full list regardless of `i`. Add a `partitionBy` argument to `:aggStrD(separator, partitionBy?)` if you want a per-group value instead.

**Recommendation**: prefer absolute `:set(c.X)` for clarity — it removes dot-counting entirely, and the resulting `{c.X}` works in any section (including DOCX/ODT headers and footers) with no loop context required. Reserve relative `:set` for cases where the consumer is inside the same loop and the alternative would be more verbose.

---

## Type conversion — convert a string number into a real number
```
{d.items[].data.amount:add(0):set(.amountAsNumber)}
```
Coerce a numeric string to a real number by running it through any arithmetic formatter: `:add(0)`, `:sub(0)`, `:mul(1)`, or `:abs`. This works for both integers and floats. Avoid `:int` — it is marked UNRECOMMENDED in the formatter reference and only handles integers.

---

## Retrieve the child with the highest id, per parent
`aggMax(.i)` takes the highest `id` among each parent's children (partitioned by the parent index `.i`), stores it on the parent, then a filter reads that child. It is the last child only when ids increase along the list:
```
{d.items[].children[].id:aggMax(.i):set(..lastChildIdx)}
{d.items[i].children[id=..lastChildIdx].label}
{d.items[i+1]}
```

---

## Paginate a flat list into N-column rows
Assign a row number to each item using `cumCount`, then group by row into a new structure:
```
{d.items[].name:cumCount:div(3):ceil:set(.row)}
{d.items[].row:set(c.grid[row=.row].row)}
{d.items[]:set(c.grid[row=.row].cells[])}
```
Replace `3` with your column count. Each `c.grid[i]` will have a `cells[]` array of up to 3 items.

---

## Multi-level JSON restructuring — pair two sibling arrays into a combined child list
Use `cumCount(.i)` to number the items of each sibling array within the same parent (the count restarts for every parent), then use that number as the join key to align the two arrays:
```
{d.source.items[].key:set(c.output[key=.key].key)}
{d.source.items[].children[]:set(c.output[key=..key].childItems[])}
{d.source.items[].sideA[].value:cumCount(.i):set(.id)}
{d.source.items[].sideB[].value:cumCount(.i):set(.id)}
{d.source.items[].sideA[].id:set(c.output[key=..key].pairs[id=.id].id)}
{d.source.items[].sideA[].value:set(c.output[key=..key].pairs[id=.id].before)}
{d.source.items[].sideB[].value:set(c.output[key=..key].pairs[id=.id].after)}
```
With two parents `K1` (children ×2, sideA `a1`,`a2`, sideB `b1`,`b2`) and `K2` (one of each), `c.output` holds `K1` with 2 `childItems` and pairs `a1/b1`, `a2/b2`, then `K2` with pairs `a3/b3`. Both sibling arrays must be numbered, and `..key` (two dots) reaches the parent from a child value — a third dot overshoots and sends everything into one keyless entry.

---

## Group a flat list by a computed attribute
Extract the grouping key into a local variable first, then build the grouped structure and compute totals:
```
{d.records[].price.qty:set(..p)}
{d.records[].p:set(c.groups[price=.p].price)}
{d.records[].price.volume:set(c.groups[price=..p].volume)}
{d.records[].label:set(c.groups[price=.p].label)}
{d.records[]:print(.price.qty):aggSum(.p):set(c.groups[price=.p].total)}
{c.groups[].total:mul(.price):set(.grandTotal)}
```

---

## Transform an object with dynamic keys into a searchable flat list
Useful when object keys are dynamic/unknown (e.g. a product SKU like `SKU20240` that changes every time). Use `:set` to convert the object into a flat array where `.att` = key and `.val` = value, then filter by known keys to isolate the unknown one:
```
{d.product_data[].val:set(..list[attr=.att].val)}
```
This creates a `list` array at the same level as `product_data`. Then use `!=` filters to exclude known keys:
```
{d.product_data.is_certified:ifNE('Yes'):drop(p)}
Supplier – {d.product_data.supplier}
Origin – {d.product_data.origin}
{d.list[i, attr!='supplier', attr!='origin', attr!='is_certified', attr!='item_grade'].attr} – {d.list[i, attr!='supplier', attr!='origin', attr!='is_certified', attr!='item_grade'].val}
{d.list[i+1, attr!='supplier', attr!='origin', attr!='is_certified', attr!='item_grade'].attr}
```
Note: uses `..list` (relative path — one level up from `product_data`). The `!=` operator is valid in array filters alongside `>`, `<`, `>=`, `<=`, `=`.

---

## Restructure two flat lists into a grouped structure with row pagination
Merge two lists by a shared key, then paginate items into rows of N columns:
```
{d.categories[]:set(c.output[name=.name])}
{d.items[]:set(c.output[name=.category].items[])}
{c.output[].items[].name:cumCount(..name):div(2):ceil:set(.row)}
{c.output[].items[].row:set(..rows[row=.row].row)}
{c.output[].items[]:set(c.output[name=..name].rows[row=.row].items[])}
```
Replace `2` with your column count.

---

## Split a string into an array, store it, then access by index
```
{d.policy.policyNo:split('_'):set(d.fixedPolicyNo)}
{d.fixedPolicyNo[0]}
```
Use `[0]`, `[1]`, `[2]` etc. to access each segment. Useful when a composite key encodes multiple values separated by a delimiter.

---

## Split into an array, compute a derived index, store both
`:len` returns the array size as a number and chains directly into math formatters:
```
{d.rawList:split(';'):set(d.items)}
{d.items:len:div(2):floor:set(d.midIndex)}
{d.midIndex:add(1):set(d.midIndex2)}
```
`d.items` is the split array, `d.midIndex` is the floor-divided midpoint, `d.midIndex2` is one past the midpoint. Use them in conditions and arithmetic (`{d.items:len:ifGT(d.midIndex):show(long):elseShow(short)}`). A stored number cannot be used as an array index: `{d.items[d.midIndex]}` is rejected and `{d.items[i=d.midIndex]}` prints nothing — a bracket index is a literal (`[i=2]`, `[i=-1]`) or a filter on an attribute.

---

## Normalize datetime elements in-place with `:startOfD:formatD:set`

For each item in an array, truncate an ISO datetime to the start of day, reformat as a date string, and store as a new field on that same item. This makes subsequent filters like `[date='2026-05-13']` and grouping by date reliable:
```
{d.flights.flight[].returnFlight.outboundFlight.arrivalDateTime:startOfD('day'):formatD('YYYY-MM-DD'):set(.date)}
```
- `:startOfD('day')` — snaps the datetime to midnight in the render timezone
- `:formatD('YYYY-MM-DD')` — produces a consistent, sortable date string
- `:set(.date)` — writes the result back as `.date` on each array item (relative path)

Use this form when locale/timezone normalization matters (e.g. when input timestamps are in UTC but the report timezone is local).

---

## Extract date substring and store as new field

When the source is already a consistent ISO string, `:substr(0,10)` is a simpler alternative that produces the same result without timezone conversion:
```
{d.flights.flight[].returnFlight.outboundFlight.arrivalDateTime:substr(0,10):set(.date)}
```
`"2026-05-13T15:45:00Z"` → `"2026-05-13"`. Use `:startOfD:formatD:set` instead when the input format is inconsistent or timezone normalization is required.
