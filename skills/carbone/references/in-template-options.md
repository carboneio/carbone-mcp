# Carbone In-Template Options — `{o.}` Reference

Read this file when the user asks about in-template options (`{o.}` tags): timezone, language/locale, converter settings, complement data, hard refresh, pre-release feature flags (`preReleaseFeatureIn` version codes such as `5018000` for XLSX formulas and merged cells that follow loop rows, v4 compatibility mode, disabling the missing `[i+1]` error in v5), or any `{o.}` option.

In-template options are placed anywhere in the template — body, header, footer or a spreadsheet cell. They are removed from output and apply globally to the render, and **take precedence over the same option passed in the API call**. Whitespace inside the tag is ignored. An option name Carbone does not know is removed silently, with no error — so a misspelled or invented `{o.}` option simply does nothing.

| Option | Description |
|---|---|
| `{o.useHighPrecisionArithmetic=true}` | Enables arbitrary-precision decimal arithmetic (v4.22.4+) |
| `{o.hardRefresh=true}` | Forces converter processing even when input and output format are the same — useful to refresh XLSX formulas after data injection (v5.4.4+) |
| `{o.preReleaseFeatureIn=VERSION}` | Activates pre-release features up to the given version code (e.g. `5011000`) — see the section below |
| `{o.timezone=Europe/Paris}` | Forces the timezone used by date formatters; overrides the API option (v5.4.3+) |
| `{o.lang=en-US}` | Forces the language/locale; overrides the API option. Accepts upper or lowercase (v5.4.3+) |
| `{o.converter=L}` | Forces the conversion engine: `L` = LibreOffice, `O` = OnlyOffice, `C` = Chromium, `I` = Carbone ICE (DOCX and ODT to PDF, v5.14.0+). Only these four values are accepted (v5.4.3+) |
| `{o.exportFormattedValuesAsText=true}` | Forces `:formatN` to output localized text strings instead of native XLSX number format. **XLSX templates only** (v5.4.3+) |
| `{o.styleSource=templateOrVersionId}` | Applies the text styles (headings, `Body Text`, `Table Heading`, `Table Contents`) and the page (size, margins, header, footer) of a DOCX/ODT template to a Markdown template converted to PDF. The style template can contain tags filled with the report data — see `markdown-templates.md` "Style template" (v5.8.0+) |

---

## How `{o.preReleaseFeatureIn=VERSION}` works

`VERSION` is a version code — major, minor and patch on 3 digits each: v5.11.0 → `5011000`, v4.22.11 → `4022011`.

It is a **threshold**: everything introduced up to that version is enabled, everything above it stays off — so set the highest version you need. It can be written in the template, passed in the API render options, or set globally on-premise with `CARBONE_PRE_RELEASE_FEATURE_IN`.

| Value | Enables |
|---|---|
| `4022011` | v4 `:set`, `:transform`, whitespace in JSON key names |
| `4025011` | All v4 pre-release features up to v4.25.11 |
| `5002000` | `:html` headings `<h1>`–`<h6>`, tables, `break-before` / `break-after` page breaks; lookup / JOIN between arrays (`loops-advanced.md`) |
| `5004002` | Direct object access combined with object iteration on the same object |
| `5011000` | The `:html` rich elements and parser fixes of v5.11.0 and v5.13.0 (list → `advanced-features.md`) |
| `5018000` | XLSX templates: formulas, merged cells, conditional formatting, data validations, tables, charts, pivot tables, hyperlinks, named ranges, the print area and page breaks follow the rows added by loops (→ `xlsx-tips.md`) |

**Below `5000000` = v4 compatibility (v5.13.0+)**: any value under `5000000` also turns off v5's missing-`[i+1]` detection, so legacy templates that v4 tolerated still render. It disables every v5 feature at the same time — use it to unblock a migration, not as a permanent setting (→ `upgrade-guide.md`).
