# Carbone Formatters: Complete Reference

Read this file when verifying a formatter name, checking its parameters or return value, looking up date/number/currency formatting options (accounting `acc`, rounding of halves and negatives), merging identical XLSX cells with `:mergeCell`, or reviewing deprecated formatters and their modern replacements.

All formatters below are verified from official Carbone documentation. Do NOT use any formatter not listed here.

## Contents

- [Text Formatters](#text-formatters)
- [Number Formatters](#number-formatters)
- [Currency Formatters](#currency-formatters)
- [Date Formatters](#date-formatters)
- [Interval Formatter](#interval-formatter)
- [Array Formatters](#array-formatters)
- [Aggregator Formatters](#aggregator-formatters-enterprise-v4)
- [Condition Formatters](#condition-formatters)
- [Store and Transform: `:set`](#store-and-transform-set-enterprise-v5--v4-with-prereleasefeaturein)
- [Key-value Mapping](#key-value-mapping)
- [Advanced / Misc Formatters](#advanced--misc-formatters)
- [`:color` Formatter: Full Reference](#color-formatter-full-reference-enterprise-v417)
- [PDF Form Formatters](#pdf-form-formatters)

---

## Text Formatters

Example cells read: tag with JSON input → output. Inputs are written as JSON, so `"3"` is a string and `3` a number.

| Formatter | Version | Description | Example |
|---|---|---|---|
| `:lowerCase` | v0.12.5+ | All lowercase | `{d.name:lowerCase}` with `"Hello"` → `"hello"` |
| `:upperCase` | v0.12.5+ | All uppercase | `{d.name:upperCase}` with `"Hello"` → `"HELLO"` |
| `:ucFirst` | v0.12.5+ | Capitalize first letter | `{d.title:ucFirst}` with `"hello world"` → `"Hello world"` |
| `:ucWords` | v0.12.5+ | Capitalize each word | `{d.title:ucWords}` with `"hello world"` → `"Hello World"` |
| `:print(message)` | v0.13.0+ | Always return `message` regardless of input | `null:print('N/A')` → `"N/A"` |
| `:printJSON` | v4.23.0+ | Stringify object/array to JSON string | `{d.ids:printJSON}` with `[1,2]` → `"[1,2]"` |
| `:unaccent` | v1.1.0+ | Remove accents | `{d.name:unaccent}` with `"crème"` → `"creme"` |
| `:convCRLF` | v4.1.0+ | Convert `\n`/`\r\n` to document line breaks | Supported in DOCX/PPTX/ODT/ODP/ODS and XLSX (v5.17.0+). In an XLSX cell the breaks show only when the cell's **Wrap text** option is enabled. Not needed in TXT/CSV: line breaks in values print as is |
| `:html` | v3.0.0+ ENTERPRISE, use v5+ | Render HTML string as native document formatting. Exists since v3, but most of the supported elements, the parser fixes and the themes arrived in v5, so recommend v5 or later. Templates: ODT, DOCX; in HTML and Markdown templates it only turns off escaping (the string is inserted as is, no option or flag needed). Headings/tables need `{o.preReleaseFeatureIn=5002000}`, the richer elements need `5011000`. Full reference → `references/advanced-features.md` "`:html` Formatter: Full Reference" | `{d.richContent:html}` |
| `:substr(begin, end, wordMode)` | v4.18.0+ | Slice string | `{d.code:substr(0,3)}` with `"foobar"` → `"foo"` |
| `:split(delimiter)` | v4.12.0+ | Split string into array | `{d.tags:split(',')}` with `"a,b,c"` → `["a","b","c"]` |
| `:padl(targetLength, padString)` | v3.0.0+ | Left-pad string. `targetLength` max 10,000, a larger value is rejected (v5.14.4+). Never cuts a longer value: chain `:substr(0, n)` first. A missing value stays empty: chain `:ifEM:show('')` first (`txt-templates.md`) | `{d.id:padl(4,'0')}` with `"3"` → `"0003"` |
| `:padr(targetLength, padString)` | v3.0.0+ | Right-pad string. `targetLength` max 10,000, a larger value is rejected (v5.14.4+). Same rules as `:padl` | `{d.id:padr(4,'0')}` with `"3"` → `"3000"` |
| `:ellipsis(maximum)` | v4.12.0+ | Truncate at `maximum` characters and append `...` (final length = `maximum` + 3 when truncated; unchanged when input already fits) | `{d.title:ellipsis(5)}` with `"hello world"` → `"hello..."` |
| `:prepend(text)` | v4.12.0+ | Add prefix | `{d.name:prepend('hello ')}` with `"world"` → `"hello world"` |
| `:append(text)` | v4.12.0+ | Add suffix | `{d.name:append(' world')}` with `"hello"` → `"hello world"` |
| `:replace(oldText, newText)` | v4.12.0+ | Find & replace all occurrences | `{d.text:replace('foo','baz')}` with `"foo bar"` → `"baz bar"` |
| `:len` | v2.0.0+ | Length of string or array | `{d.name:len}` with `"hello"` → `5` |
| `:t` | v4.23.2+ | Translate dynamic value via i18n dictionary | `{d.status:t}` |
| `:preserveCharRef` | v4.23.8+ | Keep a character reference from the data instead of escaping its `&` (XML templates, `xml-templates.md`) | `{d.cafe:preserveCharRef}` with `"caf&#233;"` → `caf&#233;` (without: `caf&amp;#233;`); `{d.name:preserveCharRef:replace('"', '&#34;')}` encodes quotes for an attribute |

---

## Number Formatters

| Formatter | Version | Description | Example |
|---|---|---|---|
| `:formatN(precision, acc)` | v1.2.0+ | Format number using `lang` option for separators. `precision` max 40, a larger value is rejected (v5.14.4+). `acc` (v5.18.0+) writes negatives in parentheses (see "Accounting format" below) | `{d.price:formatN()}` with `1000.456` → `"1,000.456"` (`lang:"en-us"`) |
| `:round(precision)` | v1.2.0+ | Round correctly, not like toFixed (see "Rounding" below) | `{d.price:round(1)}` with `1.05` → `1.1` |
| `:add(value)` | v1.2.0+ | Add two numbers | `{d.price:add(2)}` with `1000.4` → `1002.4` |
| `:sub(value)` | v1.2.0+ | Subtract | `{d.price:sub(2)}` with `1000.4` → `998.4` |
| `:mul(value)` | v1.2.0+ | Multiply | `{d.price:mul(2)}` with `1000.4` → `2000.8` |
| `:div(value)` | v1.2.0+ | Divide | `{d.price:div(2)}` with `1000.4` → `500.2` |
| `:mod(value)` | v4.5.2+ | Modulo | `{d.qty:mod(2)}` with `3` → `1` |
| `:abs` | v4.12.0+ | Absolute value | `{d.balance:abs}` with `-10` → `10` |
| `:ceil` | v4.22.8+ | Round up to nearest integer | `{d.price:ceil}` with `1.05` → `2` |
| `:floor` | v4.22.8+ | Round down to nearest integer | `{d.price:floor}` with `1.05` → `1` |
| `:int` | v1.0.0+ | Convert to integer (UNRECOMMENDED): use `:add(0)`, `:sub(0)`, `:mul(1)`, or `:abs` to coerce a numeric string to a real number (works for floats too) | |
| `:toFixed` | v1.0.0+ | Fixed decimal string (UNRECOMMENDED): use `:round(precision)` instead | |
| `:toEN` | v1.0.0+ | English number format (UNRECOMMENDED): use `:formatN` with `lang` set via the API or `{o.lang=en-US}` in-template option | |
| `:toFR` | v1.0.0+ | French number format (UNRECOMMENDED): use `:formatN` with `lang` set via the API or `{o.lang=fr-FR}` in-template option | |
| `:toWord(type, precision, keywords…)` | v5.16.0+ | Write a number in words in the report's language (`lang`), 50 languages. See "Numbers in words" below | `{d.total:toWord}` with `1234` → `"mille deux cent trente-quatre"` (`lang:"fr-fr"`) |

**Math formula in formatters**: `add`, `mul`, `sub`, `div` accept simple expressions:
```
{d.val:add(.otherQty + .vat * d.sub.price - 10 / 2)}
```
Only `+`, `*`, `-`, `/` are allowed, without extra parentheses. `*` and `/` have higher precedence.

**Rounding** (v5.18.0+): `:round`, `:formatN` and `:formatC` round halves away from zero, negative numbers like positive ones, with or without `useHighPrecisionArithmetic`:
```
{d.value:round(0)}     // -2.5 > -3
{d.value:round(2)}     // -1.005 > -1.01
{d.value:formatN(2)}   // 1.005 > "1.01" with lang:"en-us"
{d.value:formatN(2)}   // -0.001 > "0.00"
```

---

## Currency Formatters

| Formatter | Version | Description |
|---|---|---|
| `:formatC(precisionOrFormat, targetCurrencyOrAcc)` | v1.2.0+ | Format as currency using `lang` + `currency` options. `precision` max 40 (v5.14.4+). The second argument is a target currency code, or `acc` (v5.18.0+) for negatives in parentheses (see "Accounting format" below) |
| `:convCurr(target, source)` | v1.2.0+ | Convert from one currency to another |

**`:formatC` format codes**: `'M'` = currency name in words, `'L'` = symbol + amount, `'LL'` = amount + currency name.

**Default precision** (v5.16.0+): without a `precision` argument, `:formatC` writes the number of decimals that ISO 4217 defines for the currency: none for JPY, KRW, VND, CLP, ISK, XOF, XPF and the other zero-decimal currencies, three for JOD, LYD and TND, two for most others. `{d.price:formatC}` with `1234.5` in JPY prints `¥1,235`.

**`:formatC` examples** (with `lang:"en-us"`, `currency.source:"EUR"`, `currency.target:"USD"`, rates `EUR:1, USD:2`):
```
{d.amount:formatC()}     // 1000.456 > "$2,000.91"
{d.amount:formatC('M')}  // 1000.456 > "dollars"
{d.amount:formatC('L')}  // 1000 > "$2,000.00"
{d.amount:formatC('LL')} // 1000 > "2,000.00 dollars"
```

**Accounting format `acc`** (v5.18.0+): `:formatN` and `:formatC` write negative numbers in parentheses, without the minus sign; positive numbers are unchanged. In `:formatC`, `acc` takes the place of the target currency, so the report's `currencyTarget` (or the currency of a preceding `:convCurr`) is used. With `lang:"en-us"` and USD:
```
{d.amount:formatN(2, acc)}   // -1234.5 > "(1,234.50)"
{d.amount:formatC(L, acc)}   // -1234.5 > "($1,234.50)"
{d.amount:formatC(LL, acc)}  // -1000.456 > "(1,000.46 dollars)"
{d.amount:formatC(0, acc)}   // -1000.456 > "($1,000)"
```
With `lang:"fr-fr"` and EUR: `formatN(2, acc)` → `"(1 234,50)"`, `formatC(L, acc)` → `"(1 234,50 €)"`. In XLSX the cell becomes text; to keep a number, use `:formatN` with the cell format `#,##0.00;(#,##0.00)` (→ `xlsx-tips.md`). In ODS, `acc` is ignored.

**`:convCurr` examples** (same options):
```
{d.amount:convCurr()}            // 10 > 20
{d.amount:convCurr('EUR')}       // 1000 > 1000
{d.amount:convCurr('USD')}       // 1000 > 2000
{d.amount:convCurr('USD','USD')} // 1000 > 1000
```

**Currency codes**: `:formatC`, `:convCurr` and `:toWord` accept ISO 4217 codes. Added in v5.16.0: `XAF` (Central African CFA franc, no decimals), `XCG` (Caribbean guilder, which replaces `ANG` in Curaçao and Sint Maarten), `CDF`, `STN`, `SHP`, `SVC`, `MRU`, `SLE`, `VES`, `VED` and `ZWG`. A code that `:formatC` does not know (in its argument or in the report's `currencyTarget`) fails the render with `formatC: unknown currency "XYZ"` (v5.18.0+).

---

## Numbers in words: `:toWord` (v5.16.0+)

`:toWord(type, precision, keywords…)` writes a number in words in the language of `lang` (50 languages, 72 regional variants), the same option `:formatN` and `:formatC` read.

| `type` | Output | Example (`lang:"fr-fr"`) |
|---|---|---|
| `W` (default) | Cardinal number | `{d.value:toWord}` with `1234` > `"mille deux cent trente-quatre"` |
| `O` | Ordinal number | `{d.rank:toWord(O)}` with `2` > `"deuxième"` |
| `C` | Amount with its currency | `{d.total:toWord(C)}` with `1234.5` > `"mille deux cent trente-quatre euros et cinquante centimes"` |

**Precision** (second parameter, types `W` and `C`): the number of decimals written in words, max 40. Default: 3 for `W` (like `:formatN`), the currency's minor unit for `C` (2 for EUR, 3 for TND, 0 for JPY).
```
{d.value:toWord(W, 2)}   // 1.236 > "un virgule vingt-quatre"
{d.total:toWord(C, 0)}   // 1234.5 > "mille deux cent trente-cinq euros" (rounded)
```
With `C`, a precision greater than the currency's minor unit fails the render with an explicit error.

**Currency** (type `C`): the currency and the rates are those of `:formatC` (`currencySource`, `currencyTarget`, `currencyRates`); an amount already converted with `:convCurr` is not converted twice. The currencies that can be written in words depend on the language (in English: USD, CAD, AUD, NZD, SGD, GBP, EUR, INR, ZAR, TND, MAD, KWD, BHD, JOD, IQD, OMR, LYD and a few others); any other currency fails the render with an explicit error listing the supported ones.

**Keywords** (after the precision, or in its place) change the wording when the language supports them. A keyword the language does not support is ignored; an unknown keyword fails the render with the list of accepted keywords.

| Keyword | Effect |
|---|---|
| `feminine` | Feminine form (Spanish, Portuguese, Arabic, Hebrew, Russian, Polish, …): `{d.value:toWord(W, 0, feminine)}` with `1` > `"una"` in Spanish |
| `and` / `noAnd` | Add or remove the "and" ("one hundred and one" in British English, "euros et cinquante centimes" in French) |
| `hundredPairing` | "fifteen hundred" instead of "one thousand five hundred" |
| `hyphen` | Hyphens between all words (French 1990 spelling, "deux-cent-un") |
| `informal` | Common Chinese numerals instead of the financial ones |
| `accusative` / `genitive` | Grammatical case (Arabic) |

```
{d.value:toWord(W, feminine)}
{d.rank:toWord(O, feminine)}
{d.total:toWord(C, noAnd)}       // 1234.5 > "mille deux cent trente-quatre euros cinquante centimes"
```

A value that cannot be converted (not a number, out of range, decimal or negative ordinal) is printed unchanged.

---

## Date Formatters

Input can be ISO 8601, Unix timestamp (ms), Unix timestamp in seconds (with `'X'` patternIn), or any Day.js-parseable string.

| Formatter | Version | Description |
|---|---|---|
| `:formatD(patternOut, patternIn)` | v3.0.0+ | Format date (patternIn defaults to ISO 8601) |
| `:addD(amount, unit, patternIn)` | v3.0.0+ | Add time to a date |
| `:subD(amount, unit, patternIn)` | v3.0.0+ | Subtract time from a date |
| `:startOfD(unit, patternIn)` | v3.0.0+ | Set to start of unit (day/month/year/etc.) |
| `:endOfD(unit, patternIn)` | v3.0.0+ | Set to end of unit |
| `:diffD(toDate, unit, patternFromDate, patternToDate)` | v3.0.0+ | Difference between two dates |

**Available units for `:addD`/`:subD`/`:startOfD`/`:endOfD`**: `day`, `week`, `month`, `quarter`, `year`, `hour`, `minute`, `second`, `millisecond`

**Day.js format tokens** (full list, to use in `patternOut` and `patternIn`):

| Category | Token | Output example | Description |
|---|---|---|---|
| **Year** | `YYYY` | `2026` | 4-digit year |
| | `YY` | `26` | 2-digit year |
| **Month** | `M` | `5` | Month, no padding (1 to 12) |
| | `MM` | `05` | Month, 2-digit (01 to 12) |
| | `MMM` | `May` | Abbreviated month name |
| | `MMMM` | `May` | Full month name |
| **Day** | `D` | `3` | Day of month, no padding (1 to 31) |
| | `DD` | `03` | Day of month, 2-digit (01 to 31) |
| | `Do` | `3rd` | Day of month with ordinal suffix |
| **Weekday** | `d` | `3` | Day of week, number (0=Sun, 6=Sat) |
| | `dd` | `We` | Min weekday name |
| | `ddd` | `Wed` | Short weekday name |
| | `dddd` | `Wednesday` | Full weekday name |
| **Quarter** | `Q` | `2` | Quarter of year (1 to 4) |
| **Week** | `w` / `ww` | `21` / `21` | Week of year, locale (no-pad / 2-digit) |
| | `W` / `WW` | `21` / `21` | Week of year, ISO (no-pad / 2-digit) |
| | `wo` | `21st` | Week of year, locale, with ordinal |
| | `gggg` | `2026` | Week year (locale) |
| | `GGGG` | `2026` | Week year (ISO) |
| **Hour** | `H` / `HH` | `9` / `09` | 24-hour clock (no-pad / 2-digit) |
| | `h` / `hh` | `9` / `09` | 12-hour clock (no-pad / 2-digit) |
| | `k` / `kk` | `9` / `09` | 24-hour clock starting at 1 instead of 0 |
| **Minute** | `m` / `mm` | `5` / `05` | Minute (no-pad / 2-digit) |
| **Second** | `s` / `ss` | `7` / `07` | Second (no-pad / 2-digit) |
| **Sub-second** | `SSS` | `003` | Milliseconds, 3-digit |
| **AM/PM** | `A` | `AM` | Uppercase AM/PM |
| | `a` | `am` | Lowercase am/pm |
| **Timezone** | `Z` | `+02:00` | UTC offset with colon |
| | `ZZ` | `+0200` | UTC offset without colon |
| | `z` | `CEST` | Timezone abbreviation |
| **Locale** | `L` | `05/13/2026` | Short date (locale-specific) |
| | `LL` | `May 13, 2026` | Long date |
| | `LLL` | `May 13, 2026 3:45 PM` | Date + time |
| | `LLLL` | `Wednesday, May 13, 2026 3:45 PM` | Full date + time with weekday |
| | `LT` | `3:45 PM` | Time only |
| **Unix** | `X` | `1747145107` | Unix timestamp in seconds (patternIn only) |
| | `x` | `1747145107000` | Unix timestamp in milliseconds (patternIn only) |

Locale tokens (`L`, `LL`, `LLL`, `LLLL`, `LT`) produce locale-specific output and require `lang` to be set at render time. `X` and `x` are most useful as `patternIn` to parse a source unix timestamp; when used as `patternOut` they output the unix value numerically.

**Examples** (with `lang:"en-us"`, `timezone:"Europe/Paris"`):
```
{d.date:formatD('L')}                    // "20160131" > "01/31/2016"
{d.date:formatD('LL')}                   // "20160131" > "January 31, 2016"
{d.date:formatD('LLLL')}                 // "20160131" > "Sunday, January 31, 2016 12:00 AM"
{d.timestamp:formatD('LLLL','X')}        // 1410715640 > "Sunday, September 14, 2014 7:27 PM"
{d.invoiceDate:formatD(L, YYYY-MM-DD)}  // "2024-05-13" > "05/13/2024" (explicit patternIn)
{d.date:addD(3,'day'):formatD(YYYY-MM-DD)}       // "20160131" > "2016-02-03"
{d.date:startOfD('month'):formatD(YYYY-MM-DD)}   // "20160131" > "2016-01-01"
```
`:addD`, `:subD`, `:startOfD` and `:endOfD` return a timestamp, not a readable date: always chain `:formatD` to print the result.
`L` outputs the locale's short date (e.g. `13/05/2024` in fr-FR, `05/13/2024` in en-US). Without `patternIn`, Carbone assumes ISO 8601 input.

**Unix milliseconds input (`x`)**: lowercase `x` parses the input as Unix milliseconds:
```
{d.timestampMs:formatD(DD/MM/YYYY, x)}                  // 1778630400000 > "13/05/2026"
{d.controle_date:add(10000):mul(1000):formatD(DD/MM/YYYY, x)} // unix seconds + offset > ms, then format
```
When the source is Unix seconds, multiply by 1000 before passing to `formatD`.

**`LLLL` and `LT` locale tokens** (`lang:"en-us"`, `timezone:"Europe/Paris"`):
```
{d.date:formatD(LLLL)}                                    // "2026-05-13T15:45:00Z" > "Wednesday, May 13, 2026 5:45 PM"
{d.job.started:formatD(LT)} - {d.job.started:formatD(L)} // "2026-05-13T15:45:00Z" > "5:45 PM - 05/13/2026"
```

**Abbreviated month with optional uppercase**: `MMM` = abbreviated locale month name:
```
{d.dateOfGeneration:formatD(DD/MMM/YYYY)}                    // "2026-05-13" > "13/May/2026"
{d.invoice.dateOfCreation:formatD(DD/MMM/YYYY):upperCase()}  // "2026-05-13" > "13/MAY/2026"
```

**Weekday-conditional display**: `d` outputs the numeric day of week (0=Sunday … 6=Saturday). Chain `:ifEQ` + `showBegin/showEnd` to show content only when rendered on a specific weekday:
```
{c.now:formatD(d):ifEQ(1):showBegin}
...content shown only on Mondays...
{c.now:showEnd}
```
`{c.now}` is the render timestamp. Use `{d.anyDateField}` the same way for data-driven dates.

---

## Interval Formatter

| Formatter | Version | Description |
|---|---|---|
| `:formatI(patternOut, patternIn)` | v4.1.0+ | Format intervals/durations. Input defaults to milliseconds. |

**patternOut values**: `human` `human+` `millisecond(s)`/`ms` `second(s)`/`s` `minute(s)`/`m` `hour(s)`/`h` `day(s)`/`d` `week(s)`/`w` `month(s)`/`M` `year(s)`/`y`

**Examples** (with `lang:"en"`):
```
{d.duration:formatI('second')}       // 2000 > 2
{d.duration:formatI('hour')}         // 3600000 > 1
{d.duration:formatI('human')}        // 2000 > "a few seconds"
{d.duration:formatI('human+')}       // 2000 > "in a few seconds"
{d.duration:formatI('human+')}       // -2000 > "a few seconds ago"
{d.minutes:formatI('ms','minute')}   // 60 > 3600000
{d.isoDuration:formatI('hour')}      // "P1Y2M3DT4H5M6S" > (ISO 8601 duration in hours)
```

**Convert an ISO 8601 duration to HH:mm format using two tags:**

ISO 8601 duration strings (e.g. `PT45M`, `PT1H30M`) are parsed natively by Day.js without needing a `patternIn` argument.
Since `:formatI` returns a number via `.as()`, formatted output like `HH:mm` requires two separate Carbone tags, one for hours and one for remaining minutes:
```
{d.duration:formatI('hours'):floor:padl(2,'0')}:{d.duration:formatI('minutes'):mod(60):padl(2,'0')}
```

Breakdown:
- `:formatI('hours'):floor`: total hours, rounded down to nearest integer
- `:formatI('minutes'):mod(60)`: total minutes modulo 60, giving remaining minutes after full hours
- `:padl(2,'0')`: left-pads with `0` to ensure 2-character output

| JSON value | Output |
|---|---|
| `PT45M` | `00:45` |
| `PT1H30M` | `01:30` |
| `PT2H` | `02:00` |

⚠️ `:formatI` with a format token string like `'HH:mm'` does NOT work: it internally calls Day.js `.as()` which only accepts unit identifiers (`'hours'`, `'minutes'`, `'seconds'`, etc.) and returns a number. The correct method for formatted string output would be `.format()`, but Carbone's `:formatI` uses `.as()`.

---

## Array Formatters

| Formatter | Version | Description |
|---|---|---|
| `:arrayJoin(separator, index, count)` | v4.12.0+ | Flatten array to string |
| `:arrayMap(objSeparator, attSeparator, attributes)` | v0.12.5+ | Flatten array of objects to string |
| `:count(start)` | v1.1.0+ | Row counter. `:cumCount` is the modern equivalent (v4+) and additionally supports `partitionBy` |

**`:arrayJoin` examples**:
```
{d.names:arrayJoin()}        // ["homer","bart","lisa"] > "homer, bart, lisa"
{d.names:arrayJoin(' | ')}   // ["homer","bart","lisa"] > "homer | bart | lisa"
{d.names:arrayJoin('',1)}    // ["homer","bart","lisa"] > "bartlisa" (skip first)
{d.names:arrayJoin('',1,1)}  // ["homer","bart","lisa"] > "bart" (1 item from index 1)
{d.names:arrayJoin('',0,-1)} // ["homer","bart","lisa"] > "homerbart" (all but last)
{d.names:arrayJoin('\n'):convCRLF} // one item per line in DOCX/PPTX/ODT/XLSX: :arrayJoin inserts the newline character, :convCRLF turns it into a document line break (XLSX cell with Wrap text)
```

**`:arrayMap` examples**:
```
{d.people:arrayMap()}               // [{id:2,name:'homer'},{id:3,name:'bart'}] > "2:homer, 3:bart"
{d.people:arrayMap(' ; ','|')}      // [{id:2,name:'homer'},{id:3,name:'bart'}] > "2|homer ; 3|bart"
{d.people:arrayMap(' ; ','|','id')} // [{id:2,name:'homer'},{id:3,name:'bart'}] > "2 ; 3"
```

**Practical string combinations**

**Normalise name casing**: `:lowerCase:ucWords` title-cases regardless of the input casing:
```
{d.firstName:lowerCase:ucWords}      // "JOHN" > "John"
{d.lastName:upperCase}               // "smith" > "SMITH"
{d.address.street:lowerCase:ucWords} // "HIGH STREET" > "High Street"
```

**Split a delimited string and extract one element**: the third arg of `:arrayJoin` is **count** (items to take), not an end index:
```
{d.caseCode:split(-):arrayJoin('', 0, 1)} // "ABC-123" > "ABC"
```

**Strip a known prefix from a composite code**: split on the prefix, skip the empty element before it:
```
{d.chromosome:split('chr'):arrayJoin('', 1)} // "chr7" > "7"
```
`split('chr')` on `"chr7"` → `["", "7"]`. `arrayJoin('', 1)` skips index 0 and joins the rest.

---

## Aggregator Formatters (ENTERPRISE, v4+)

Used to compute aggregates over arrays. Can be used standalone (outside loop) or inside a loop with optional `partitionBy` parameter.

| Formatter | Description |
|---|---|
| `:aggSum(partitionBy?)` | Sum of all values |
| `:aggAvg(partitionBy?)` | Average |
| `:aggMin(partitionBy?)` | Minimum value |
| `:aggMax(partitionBy?)` | Maximum value |
| `:aggCount(partitionBy?)` | Count of items |
| `:aggCountD(partitionBy?)` | Count of distinct items |
| `:aggStr(separator, partitionBy?)` | Concatenate all strings |
| `:aggStrD(separator, partitionBy?)` | Concatenate distinct strings |
| `:cumSum(partitionBy?)` | Cumulative running sum |
| `:cumCount(partitionBy?)` | Sequential row counter |
| `:cumCountD(partitionBy?)` | Sequential counter for distinct items |
| `:aggSum:cumSum` | Combined formatter for nested arrays: subtotal per group + running total across groups |

**Standalone example** (outside loop, returns total):
```
{d.cars[].qty:aggSum}               ← sum of all
{d.cars[sort>1].qty:aggSum}         ← sum with array filter
{d.cars[].qty:mul(.sort):aggSum}    ← chain formatters before agg
```

**Loop example** (inside loop, shows value per row):
```
{d[i].brand}   {d[i].qty:aggSum}    {d[i].qty:cumSum}
{d[i+1].brand}
```

**Partitioned example** (sub-total per group):
```
{d[i].brand}   {d[i].qty:aggSum(.brand)}
{d[i+1].brand}
```

**Nested array subtotals**:
```
{d[i].country}   {d[i].cities[].cars:aggSum}
{d[i+1].country}
```

**Sub-object limitation**: use `:print` to navigate into sub-objects first:
```
{d[].items:print(.sub.qty):aggSum}
```

**`:aggSum:cumSum` combined**: valid combined formatter for nested arrays. `:aggSum` computes the subtotal per group, `:cumSum` then tracks the running total across those grouped results:
```
{d[i].cities[].cars:aggSum:cumSum}
{d[i+1]}
```

**Translate then aggregate distinct strings**: chain `:t` before `:aggStrD` to collect unique translated labels in one pass:
```
{d.modeling.zones[].type:t:aggStrD}
{d.buildings[].equipments[].val[].val[].type:t:aggStrD}
```
`:t` translates each item's value via the i18n dictionary at render time; `:aggStrD` then deduplicates and joins the translated results. The separator defaults to `, `. Works at any nesting depth.

---

## Condition Formatters

### Logical operators (must be followed by an output formatter)

| Formatter | Meaning |
|---|---|
| `:ifEQ(val)` | equals |
| `:ifNE(val)` | not equal |
| `:ifGT(val)` | greater than |
| `:ifGTE(val)` | greater than or equal |
| `:ifLT(val)` | less than |
| `:ifLTE(val)` | less than or equal |
| `:ifIN(val)` | contains (string or array member) |
| `:ifNIN(val)` | does not contain |
| `:ifEM()` | is empty (null, undefined, [], {}, '') |
| `:ifNEM()` | is not empty |
| `:ifTE(type)` | type equals ('string', 'number', 'boolean', 'array', 'object') |
| `:and(val?)` | AND the next condition |
| `:or(val?)` | OR the next condition (default between conditions) |

### Output formatters (follow a logical operator)

| Formatter | Description |
|---|---|
| `:show(msg)` | Print `msg` if condition is true; if condition is false and no `:elseShow` follows, returns the original input value unchanged (single conditional only, see "Fallthrough" note below) |
| `:elseShow(msg)` | Print `msg` if condition is false |
| `:showBegin` / `:showEnd` | Show block between tags if condition is true |
| `:hideBegin` / `:hideEnd` | Hide block between tags if condition is true |
| `:drop(element, n?)` | Drop element if condition is true (ENTERPRISE) |
| `:keep(element, n?)` | Keep element if condition is true, drop otherwise (ENTERPRISE) |

**Fallthrough on `:show` without `:elseShow`**: a single condition (`:ifEQ`, `:ifNE`, `:ifGT`, `:ifGTE`, `:ifLT`, `:ifLTE`, `:ifIN`, `:ifNIN`, `:ifEM`, `:ifNEM`, `:ifTE`) followed by `:show(...)` with no `:elseShow` returns the **original input value** when the condition is false (Carbone docs call this the "initial marker"). This enables override-only patterns:
```
{d.display:ifEQ('Other'):show(..otherText)}
```
When `display = 'Other'` → prints `otherText`. When `display = '901 Gass Blvd'` → condition false, no `:elseShow`, so the original `'901 Gass Blvd'` passes through. Equivalent to `:ifEQ('Other'):show(..otherText):elseShow(.display)` without restating the input path.
**Caveat**: chains render nothing on no-match. In a chain like `{d.currency:ifEQ(USD):show($):ifEQ(EUR):show(€)}`, nothing is printed when no condition matches. Each `:show` consumes the marker for the next condition, so the fallthrough applies to a single conditional only.

**`:drop` / `:keep` elements**: `'row'` `'col'` `'p'` `'img'` `'table'` `'chart'` `'shape'` `'slide'` `'item'` `'sheet'` `'h'` `'div'` `'span'`. The `n` argument (drop/keep N consecutive) works with `'p'` and `'row'` only. Per-format support: ODS → `col`/`row`/`img`/`sheet`. XLSX → `row`/`col`. PPTX → `col`/`row`/`img`/`p`/`shape`/`chart`/`table`. HTML → `table`/`col`/`row`/`p`/`div`/`span`. DOCX/ODT → all elements.

Note: no formatters can be chained after `drop`, `keep`, `hideBegin`, `hideEnd`, `showBegin`, `showEnd`.

**Dynamic image with empty guard**: two tags in the same image alt-text placeholder:
```
{d.customer_logo:imageFit(contain)}{d.customer_logo:ifEM():drop(img)}
```
The first renders the image (or nothing if empty). The second removes the entire image element when the URL is missing.

### Legacy condition formatters (deprecated, use new ones above)

| Formatter | Replacement |
|---|---|
| `:ifEmpty(textIfTrue)` | `:ifEM():show(...)` |
| `:ifEqual(value, textIfTrue)` | `:ifEQ(value):show(...)` |
| `:ifContain(value, textIfTrue)` | `:ifIN(value):show(...)` |

### Other deprecated formatters

| Deprecated | Replacement | Notes |
|---|---|---|
| `:convDate(patternIn, patternOut)` | `:formatD(patternOut, patternIn)` | Arg order is reversed in the replacement |
| `:convert(patternIn, patternOut)` | `:formatD(patternOut, patternIn)` | Undocumented alias for `:convDate` |
| `:slice(start, end)` | `:substr(start, end)` | Shipped in v1; replaced by `:substr` |
| `:count(start)` | `:cumCount` | `:cumCount` (v4+) also supports `partitionBy` |

---

## Store and Transform: `:set` (ENTERPRISE, v5+ / v4 with preReleaseFeatureIn)

| Usage | Description |
|---|---|
| `:set(c.varName)` | Store result into complement object |
| `:set(d.varName)` | Store result into data object |
| `:set(.relativePath)` | Add/modify attribute on each item in a looped array |
| `:set(c.newArr[])` | Clone array into a new array |
| `:set(c.arr[field=.value].prop)` | Group/merge arrays with join expression |

Tags using `:set` print **nothing**. Execution order is guaranteed within same document section.

---

## Key-value Mapping

| Formatter | Version | Description |
|---|---|---|
| `:convEnum('ENUM_NAME')` | v0.13.0+ | Map index or key to label via options enum |

**Example** (with `enum: { ORDER_STATUS: ['pending','sent','delivered'] }`):
```
{d.status:convEnum('ORDER_STATUS')} // 0 > "pending"
{d.status:convEnum('ORDER_STATUS')} // 1 > "sent"
{d.status:convEnum('ORDER_STATUS')} // 5 > 5 (out of range → unchanged)
```

---

## Advanced / Misc Formatters

| Formatter | Version | Description |
|---|---|---|
| `:mergeCell(parent…)` | v5.18.0+ | XLSX only. Merge the consecutive cells of a column that have the same value into one vertically merged cell: `{d.products[i].category:mergeCell}`. Optional parents merge only within a group: `:mergeCell(.country, .region)`. Must be the last formatter; no pre-release tag needed. Details → `xlsx-tips.md` "Merged cells in a loop" |
| `:formatR` | v5.0.4+ | Format a country/region code (in the data) to a human-readable name in the report's language. Accepts ISO 3166-1 Alpha-3 (`FRA`), Alpha-2 (`FR`), or Numeric (`250`). Example: `{d.countryCode:formatR}` |
| `:imageFit(option)` | v3.2.0+ ENTERPRISE | Resize replacement image to placeholder (DOCX/ODT/PPTX). `fillWidth` (default), `contain`, `fill` |
| `:autoOrient` | v5.6.0+ ENTERPRISE | Auto-rotate a JPEG image according to its EXIF orientation (camera/smartphone). DOCX only. Use before `:imageFit` (compatible with `contain` and `fillWidth`, not with `fill`). Non-JPEG images are ignored. Example: `{d.photo:autoOrient:imageFit(contain)}` |
| `:barcode(type, options?)` | v3.4.6+ ENTERPRISE | Insert barcode/QR as image. Write in the alt-text of a placeholder image (DOCX/ODT/PPTX/XLSX/…) or in `<img src="">` for HTML and Markdown templates (Markdown: v5.13.0+). `type`: `qrcode`, `code128`, `ean13`, `ean8`, `pdf417`, and 100+ others. `svg:true` for vector output. Options (second arg, `key:value` pairs): `width`, `height`, `scale` (1 to 10), `includetext`, `textsize`, `textxalign` (left/center/right/justify), `textyalign` (below/center/above), `rotate` (N/R/L/I), `barcolor` (#RRGGBB), `textcolor` (#RRGGBB), `backgroundcolor` (#RRGGBB), `eclevel` (L/M/Q/H, QR only). `scale` defaults to 3. Limits (v5.14.4+): `width`/`height` max 1,000 mm and `textsize` max 100 pt (a bigger value is ignored, not reduced); above 25 million pixels (`scale` included) the barcode is replaced by the error image |
| `:chart` | v4.0+ ENTERPRISE | Inject an ECharts v5 chart as an image. Write in the alt-text of a placeholder image (DOCX/ODT/PPTX/XLSX/…) or in `<img src="">` for HTML and Markdown templates (Markdown: v5.13.0+). JSON must contain a full ECharts config with `type:"echarts@v5a"` |
| `:color(scope, type)` | v4.17.0+ ENTERPRISE | Apply dynamic hex color to text, cells, rows, or shapes ([see full reference](#color-formatter-full-reference-enterprise-v417)) |
| `:appendFile(where?)` | v4.22.0+ ENTERPRISE | Append PDF at end (`'end'`, default) or `'start'` of generated PDF |
| `:attachFile(name, type)` | v4.23.0+ ENTERPRISE | Attach file inside PDF (Factur-X, ZUGFeRD). `name` defaults to `'factur-x.xml'`, which auto-detects the Factur-X level. `type` is the PDF relationship: `Data` (default), `Source`, `Alternative`, `Supplement`, `Unspecified`, `FormData`, `Schema`. Any other value (a MIME type) is an error |
| `:appendTemplate(templateIdOrVersionId, position?)` | v5.0.3+ ENTERPRISE | Generate another template with current data and append its PDF. `position`: `'end'` (default) or `'start'`. Works in loops. **PDF output only** (silently ignored otherwise). Only `lang`, `timezone`, `currencySource`, `currencyTarget`, `currencyRates`, `enum`, `converter`, `translations`, and complement data are forwarded to the nested template. No recursion |
| `:defaultURL(url)` | v3.1.6+ ENTERPRISE | Fallback URL if dynamic hyperlink is invalid. Place before `:html` when combined |
| `:sign` | v5.0.0+ ENTERPRISE | Place signature field; returns position coordinates in API response. Prints nothing. PDF output with the `carbone-version: 5` header; write the tag in Arial/Calibri with the opening `{` in the background color (→ `advanced-features.md`) |
| `:transform(axis, unit)` | v4.22.11+ ENTERPRISE | Move shapes and pictures on X or Y axis (PPTX/ODP/ODT). In v4, requires `{o.preReleaseFeatureIn=4022011}`. axis: `'x'`/`'y'`. unit: `'cm'` `'mm'` `'in'` (or `'inch'`) `'pt'`. Not on lines or groups (render error) |
| `:svgUpdate(attrName, selectorVal, selectorType?)` | v5.0.0+ ENTERPRISE | SVG templates only. Sets `attrName` to the tag value on the shapes selected by id, in a comment; prints nothing: `{d.parts[].color:svgUpdate('stroke', .id)}`. selectorType: `'id > *'` (default: the element if it is a shape, plus its direct child shapes), `'id'` (the element only), `'id *'` (every shape inside). A missing attribute is added. Only rect, circle, ellipse, line, polyline, polygon, path → `svg-templates.md` |
| `:svgSelectiveUpdate(attrName, attrVal, selectorType?)` | v5.0.0+ ENTERPRISE | SVG templates only. The tag value is the id of the shapes to update; sets `attrName` to `attrVal` (fixed, or an item `.path`): `{d.rooms[status='busy'].id:svgSelectiveUpdate('fill', '#fdecef')}`. Same selectorType as `:svgUpdate` |

---

## `:color` Formatter: Full Reference (ENTERPRISE, v4.17+)

```
{d.hexColor:color(scope, type)}
{d.val:ifEQ('ok'):show(007700):elseShow(FF0000):color(row, text)}
```

**Computed color from condition**: evaluate a condition to produce the hex string, then apply it:
```
{d.reportInfo.edition.id:ifLT(3):show(#808080):elseShow(#000000):color(row, text)}
```
The value passed to `:color` must be a valid CSS hex color (`#rrggbb`).

Color must be 6-digit hex, with or without `#`. Invalid values → replaced with `#888888`.

| `scope` | Element |
|---|---|
| `p` (default) | Current paragraph |
| `row` | Current table row |
| `cell` | Current table cell |
| `shape` | Current shape |
| `part` | Inline section within a paragraph (ODT only) |

| `type` | What changes |
|---|---|
| `text` (default) | Text color |
| `highlight` | Text highlight (**not supported in DOCX**) |
| `background` | Cell/row/shape background |
| `border` | Shape border only |

**Limitations:** Cannot use in aliases. Cannot combine with aggregators. PPTX (v5.6.0+): scopes `row`/`cell`/`shape` (not `p`); `border` for shapes only. For ODP (text, tables, shapes) and ODT (shapes only): a non-default style must already be applied in the template. Complex nested tables with sub-table colors are not fully supported.

## PDF Form Formatters

Used in PDF form templates only.

| Formatter | Description |
|---|---|
| `:fill` | Fill the text field behind the tag annotation (annotation must overlap the field) |
| `:check` | Check the checkbox or radio button behind the tag annotation when the condition is true; otherwise unchecks a checkbox |
| `:uncheck` | Uncheck the checkbox behind the tag annotation when the condition is true; otherwise checks it |
| `:fillField('fieldName')` | Fill a text field by name anywhere in the document. On a radio group, selects the option whose name is the value; on a checkbox, any non-empty value checks it |
| `:checkField('fieldName')` | Check a checkbox by name if the condition is true; otherwise unchecks it → `pdf-templates.md` |

Example that selects a radio button option:
```
{d.genre:ifEQ('boy'):show(male):ifEQ('girl'):show(female):fillField('genderGroup')}
```
