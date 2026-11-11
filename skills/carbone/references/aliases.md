# Carbone — Alias Patterns

Read this file when the user asks about aliases (`{#}` / `{$}`): filter aliases, object-pick, frozen-index, loop shorthand, alias with fallback or arithmetic, parametrized (function-style) aliases, or looping over an alias array.

For the basic alias syntax, see SKILL.md §3. This file covers production patterns that go beyond the basics.

---

## Aliases — fundamentals recap

```
{#myAlias = d.path.to.value}     ← declare (prints nothing)
{$myAlias}                        ← use anywhere in the template
{$myAlias:formatN(2)}             ← formatters chain normally
```

Aliases are **shortcuts**, not variables — they resolve to the data path at the point of use. To store a *computed result*, use `:set` (see `set-patterns.md`).

**Restriction**: an alias's right-hand side must be built from `d.`/`c.` data paths or a filter expression — it cannot reference another alias. Both `{#a = $b}` and `{#a = d.value:ifEM:show($b)}` are invalid (see SKILL.md item 25).

**Parametrized aliases** act like functions:
```
{#mealOf($weekday) = d.meals[weekday=$weekday]}
{$mealOf(2).name}
```

---

## Alias with formatted value and fallback

The alias declaration can include formatters; `:ifEM():show(-)` provides a display fallback:
```
{#score=d.benchmark.env.value:round(0):ifEM():show(-)}
```
Use `{$score}` throughout the template. Particularly useful in PPTX shapes where the same computed value appears in multiple text boxes.

---

## Alias for arithmetic reuse

Compute once, apply different formatters each time:
```
{#diff=d.benchmark.global.value:sub(.baseline)}
```
Then:
```
{$diff:ifGT(0):show(↑):elseShow(↓)}    ← direction indicator
{$diff:abs():formatN(1)}                ← magnitude
```
Without the alias, the subtraction would need to be repeated for every output tag.

---

## Multi-parameter alias for grid layouts

Function-style aliases accept multiple arguments, avoiding repeated long data accessors:
```
{#dateLabel($week,$day) = d[week=$week,day=$day].date:formatD(L)}
{#dishName($week,$day)  = d[week=$week,day=$day,mealType.sort].menuItems[dish.sort]}
```
Call with `{$dateLabel(0,1)}`, `{$dateLabel(0,2)}`, etc. to fill each cell of a weekly grid.

---

## Alias as filter

An alias whose value is a **filter expression** (not a data path) can be used inside `{d.array[$aliasName]}` to apply that filter:

```
{#incCrit = criticality.code!='-1' }
...
{d.incidents[$incCrit][i].title}
{d.incidents[$incCrit][i+1].title}
```

The alias stores the expression string `criticality.code!='-1'` literally. Wherever `$incCrit` appears inside a loop-filter bracket, Carbone substitutes it.

**Multiple AND conditions** — comma-separated conditions inside the alias are ANDed:
```
{#incCrit = criticality.code!='0',criticality.code!='-1' }
```
Use with `{d.list[$incCrit][i]}` to keep only rows where both conditions are true.

---

## Alias to pick a filtered item

Use an alias to grab one specific item from an array by filter, then access its fields throughout the template without repeating the filter:

```
{#customer = d.parties[type='Customer']}
{$customer.name}
{$customer.address}
{$customer.email}
{$customer.balance:formatC(2)}
```

---

## Alias to freeze the first array element

`[i=0]` pins the alias to index 0. Shortens repeated access to first-element fields:

```
{#inv = d[i=0].invoice[i=0]}
{$inv.invoiceDate:formatD(L)}
{$inv.totalAmount:formatC(2)}
```

---

## Alias shorthand inside a loop

Declare an alias pointing to a loop variable to shorten repeated property access within the same iteration:

```
{#q=d.qualities[i]}
{$q.pdfDisplayName}
{$q.hsCode}
{$q.quantity:formatN(3)}
{d.qualities[i+1]}
```

The loop end-marker still references the original array path `d.qualities[i+1]` — the alias is only for readability inside the loop body.

---

## Alias used in `showBegin` / `showEnd`

Test the alias directly for emptiness to gate a conditional block:

```
{$TIER1:ifNEM:showBegin}
{$TIER1.title}
...
{$TIER1:showEnd}
```

The same alias is used for both the condition and the `showEnd` marker.

---

## Alias + relative path in `:show` / `:elseShow`

When the alias points to an object, `:show` and `:elseShow` can reference sibling fields using relative `.field` notation:

```
{$record.primaryLabel:ifNEM:show(.primaryLabel):elseShow(.fallbackLabel)}
```

If `primaryLabel` is non-empty, display `primaryLabel`; otherwise display `fallbackLabel` from the same object — without repeating the full alias path.

---

## Looping over an alias array

An alias that points to an array can be iterated with `[i]` / `[i+1]`:

```
{#ip = d[i=0].invoicedetail}
{$ip[i].description}
{$ip[i].qty:formatN(2)}
{$ip[i+1]}
```

The loop end-marker uses `{$ip[i+1]}` — the alias name, not the original path.

---

## Aggregating an alias array

The silent `[]` iterator and aggregators work on alias-bound arrays the same way they work on `d.` arrays:

```
{#income = d.income_type_summary}
{$income[].percentage:aggSum:formatN(0)}
{$income[].amount:print(.tax):aggSum}
```

Useful when the same array is used both for a visible loop and for a separate total cell — declare the alias once, then reuse it for the aggregation.
