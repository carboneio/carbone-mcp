# Carbone Loops — Advanced Reference

Advanced loop patterns. Read this file when the user asks about: filtering with negative index or OR logic, bidirectional or horizontal loops, sorting, distinct values, lookup (JOIN), parallel loops, loops on primitive arrays or nested arrays, object attribute search, or row repetition.

---

## Filtering — advanced patterns

**Negative index — access or exclude last N items:**
```
{d[i=-1].name}           ← last item only
{d[i, i!=-1].name}       ← exclude the last item
{d[i, i<-2].name}        ← exclude the last 2 items
{d[i+1, i<-2].name}
```

**Advanced filter with `:set` (v5+)** — for OR logic or computed conditions, compute a flag first then filter:
```
{d[].name:ifIN('Model 3'):or:ifIN('Falcon 9'):show(1):elseShow(0):set(.isShown)}
{d[i].name}
{d[i+1, isShown=1].name}
```

---

## Bidirectional loop (DOCX/HTML/MD — v4.8.0+)
Creates rows AND columns simultaneously:
```
{d.titles[i].name}     {d.titles[i+1].name}
{d.cars[i].models[i]}  {d.cars[i].models[i+1]}
{d.cars[i+1].models[i]}
```

---

## Horizontal loop (grow a table sideways)
A normal table loop grows **downward** — `[i]` in one row, the `[i+1]` end-marker in the row below. To grow **sideways** (one new **column** per item), put `[i]` in one column and the `[i+1]` end-marker in the column immediately to its right, on the same row. Format-agnostic — works in any table (DOCX, ODT, XLSX, ODS, PPTX, HTML, Markdown):
```
{d.products[i].name}    {d.products[i+1].name}
{d.products[i].price}   {d.products[i+1].price}
```
⚠️ **One `[i+1]` per `[i]` tag.** A vertical loop closes with a single `[i+1]` row for the whole block; a horizontal loop is detected **per row**, so every row containing an `[i]` tag needs its own `[i+1]` marker in the adjacent column. Miss one and Carbone throws:
```
The marker {d.products[i].price} has no corresponding [i+1] for array "products".
```
The end-marker can be the bare `{d.products[i+1]}` (attributes after `[i+1]` are ignored — see SKILL.md item 20), but it must appear once per `[i]` tag. To grow rows **and** columns at once from nested arrays, see "Bidirectional loop" above.

---

## Accessing the loop iterator value
Use `:add(.i)` style to get the current index. Dots indicate level in the hierarchy:
```
{d[i].cars[i].other.wheels[i].tire.subObject:add(.i):add(..i):add(...i)}
```
- `.i` → index of `cars[i]`
- `..i` → index of `d[i]`
- `...i` → index of `wheels[i]`

⚠️ Note: the dot count is currently **inverted** (a known Carbone bug maintained for backward compat).

---

## Sorting
Sort ascending by placing the attribute name as the iterator. Pairs of attribute/iterator define sort priority:
```
{d.cars[power  , i].brand}
{d.cars[power+1, i+1].brand}
```
Multiple sort attributes:
```
{d.cars[power  , sub.size  , i].brand}
{d.cars[power+1, sub.size+1, i+1].brand}
```
⚠️ Descending sort is coming in v5 — not yet available.

---

## Distinct
Print only the first occurrence of each distinct value:
```
{d[type].brand}
{d[type+1].brand}
```

---

## Lookup (v5.2+ — requires pre-release flag)
Join two arrays by matching IDs (like SQL JOIN or VLOOKUP).
Requires `{o.preReleaseFeatureIn=5002000}` in the template.
```
{d.movies[i].actorId:print(..actors[id=.actorId].firstName)}
```

---

## Parallel loop
Access a second array at the same index using the iterator:
```
{d.cars[i].id}   {d.cars[i].id:print(..brands[.i].name)}
{d.cars[i+1].id}
```

---

## Loop on array of strings or numbers (v4.9.0+)
When the array contains primitive values (strings, numbers) rather than objects:
```
{d.myArray[i]}
{d.myArray[i+1]}
```
Direct access also works: `{d.myArray[0]:upperCase}`

⚠️ If at least one tag accesses a property (e.g. `{d.myArray[i].id}`), Carbone treats the array as an array of objects and `{d.myArray[i]}` prints nothing.

---

## Loop on array of arrays (v4.9.0+)
Nested arrays can themselves be arrays (unlimited depth):
```
{d.myArray[i][i].val}
{d.myArray[i][i+1].val}
{d.myArray[i+1].val}
```

---

## Object attribute search (v4.22.5+)
Search an object's properties by attribute name or value (without looping):
```
{d.myObject[.att = jack].val}    ← find value where key = "jack"
{d.myObject[.val = 20].att}      ← find key where value = 20
```
Where `myObject` is `{ paul: '10', jack: '20', bob: '30' }` — `.att` is the key, `.val` is the value.

---

## Row repetition (experimental)
Repeat a row N times based on a JSON value. `qty` is the number of repetitions:
```
{d[i].id} - {d[i+1*qty].id}
```
Maximum: 400 repetitions. Row is duplicated `qty` times; rows with `qty=0` are skipped.

---

## Nested loops (multi-level)

**Two-level loop** — both the inner and outer loop-end rows are required. Each end row carries only the `[i+1]` for the level it closes:
```
{d.bundles[i].components[i].code}
{d.bundles[i].components[i].qty:formatN(2)}
{d.bundles[i].components[i+1]}        ← inner loop-end
{d.bundles[i+1]}                      ← outer loop-end
```

**Nested data at different depths in the same table**:
```
{d.pages[i]}                                     ← page-level field
{d.pages[i].positions[i].description}            ← position-level field
{d.pages[i].positions[i+1].description}          ← inner end
{d.pages[i+1]}                                   ← outer end
```

**Three-level (and deeper) loops** — Carbone supports arbitrary nesting depth. Each level requires its own end-row with `[i+1]`. End-rows must appear in innermost-first order:
```
{d.training[i].child[i].sessionTraining[i].examSession}
{d.training[i].child[i].sessionTraining[i+1]}   ← closes sessionTraining loop
{d.training[i].child[i+1]}                       ← closes child loop
{d.training[i+1]}                                ← closes training loop
```
A 4-level loop adds one more `[i]` nesting and one more end-row following the same pattern.
