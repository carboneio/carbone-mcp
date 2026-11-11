# Carbone PDF Templates Reference

Read this file when the user asks about using a PDF as a Carbone template, filling PDF form fields (AcroForm), the `:fill` / `:check` / `:uncheck` / `:fillField` / `:checkField` formatters, selecting a radio button, which tool to use to write tags in a PDF, or what a PDF template can and cannot do.

Version: 5.0+ | ENTERPRISE (Cloud or On-Premise) — **not available in Embedded Carbone JS**
Output format: PDF only — the document stays a PDF, so no `convertTo` is needed

A **fillable PDF (AcroForm)** can be used directly as a template: an official government form, an HR document, or a form built in Adobe Acrobat. Carbone fills its fields and returns the same PDF.

Supported field types: **text fields, checkboxes, radio buttons**. Buttons and other field types are silently ignored — no error is raised.

**Tools to write the tags**: Adobe Acrobat, or the built-in PDF viewer of Firefox (type a tag in a field, or add a text box with the **Text** tool, then **Save**) work for all three methods. The built-in viewer of Google Chrome can only type tags in fields (method 1), then **Download** > **With your changes**.

**Pick the method** by what you can change in the form — the methods can be mixed in one template:

| Method | Use it when |
|---|---|
| 1 — tag in the field | You can edit the form fields (a form you own). Text fields only |
| 2 — text box over the field | The form must stay untouched (official or third-party form) |
| 3 — target the field by name | The tags cannot sit on the fields, for radio groups, or for forms with many fields |

---

## Contents

- [Method 1 — tag in the field](#method-1--tag-in-the-field)
- [Method 2 — text box over the field](#method-2--text-box-over-the-field)
- [Method 3 — target a field by name](#method-3--target-a-field-by-name)
- [What works, what does not](#what-works-what-does-not)
- [Gotchas](#gotchas)
- [API call](#api-call)

---

## Method 1 — tag in the field

Type the tag as the value of a text field:

```
{d.company}
```

Carbone replaces it with the value from the data, and the field stays editable in the report. Loops work inside a text field, so one field can repeat content for each item of an array.

Checkboxes and radio buttons have no text value, so this method fills text fields only. Fill them in the same template with method 2 or 3.

---

## Method 2 — text box over the field

Add a text box comment (a FreeText annotation — Acrobat's **Add text box** tool) over each field, and type a tag ending with one of these formatters. Carbone updates the field behind the text box and removes the text box from the report.

| Formatter | Effect |
|---|---|
| `:fill` | Fills the text field behind the tag |
| `:check` | Checks the checkbox or radio button behind the tag when the condition is true. Otherwise, unchecks a checkbox |
| `:uncheck` | Unchecks the checkbox behind the tag when the condition is true. Otherwise, checks it |

Data `{"company": "Bluebird Logistics", "paymentTerms": "net60", "termsAccepted": true, "newsletter": false}`, one text box per tag:

```
{d.company:fill}
{d.paymentTerms:ifEQ('net30'):check}    ← over the "Net 30" radio button
{d.paymentTerms:ifEQ('net60'):check}    ← over the "Net 60" radio button: selected
{d.termsAccepted:ifEQ(true):check}      ← checked
{d.newsletter:ifEQ(false):uncheck}      ← checked in the template, unchecked in the report
```

Each radio button gets its own text box and condition. The text box must overlap its field: if it overlaps several fields, Carbone updates the one it covers most; if it overlaps none, Carbone returns an error.

---

## Method 3 — target a field by name

Write the tags in a text box comment anywhere in the PDF (a sticky note works too) — one text box can hold all the tags, one per line. Each tag targets a field by its name (in Acrobat, **Prepare a form** shows the field names). Carbone fills the fields and removes the text box from the report.

| Formatter | Effect |
|---|---|
| `:fillField('fieldName')` | Fills the text field named `fieldName`. On a radio group, selects the option whose name is the value. On a checkbox, any non-empty value checks it |
| `:checkField('fieldName')` | Checks the checkbox named `fieldName` when the condition is true. Otherwise, unchecks it |

Same data as method 2:

```
{d.company:fillField('company')}
{d.paymentTerms:fillField('paymentTerms')}                  ← radio group: selects the option named net60
{d.termsAccepted:ifEQ(true):checkField('termsAccepted')}
{d.newsletter:ifEQ(true):checkField('newsletter')}          ← false: unchecked
```

**Radio buttons**: pass the name of the radio group to `:fillField()`, and use the name of the option as the value (in Acrobat, the option name is the button's **Radio Button Choice**). When the data holds another value, map it to an option name with conditions — data `{"paymentDays": 60}`:

```
{d.paymentDays:ifEQ(30):show(net30):ifEQ(60):show(net60):fillField('paymentTerms')}
```

If the radio group has no option with the resulting name, Carbone returns an error.

---

## What works, what does not

**Works**: substitutions, repetitions (inside a text field), formatters, translations, conditions, simple math, aggregators, form filling.

**Not available in a PDF template**: pictures, colors, `:html`, charts, barcodes, hyperlinks, `:transform`, file operations, signatures. Never suggest them for a PDF template — use DOCX, ODT or HTML when the report needs them.

---

## Gotchas

- Carbone Studio's embedded PDF viewer **cannot display filled forms** — download the file to check the result
- Buttons and unsupported field types are **silently ignored** rather than raising an error
- The native **macOS Preview** app can break PDF forms containing radio buttons — use Adobe Acrobat Reader

---

## API call

The output stays a PDF, so `convertTo` is omitted:

```bash
curl --request POST 'https://api.carbone.io/render/template?download=true' \
  --header 'carbone-version: 5' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer API_TOKEN' \
  --data-raw '{
    "data": {},
    "template": "<BASE64_ENCODED_PDF>"
  }' \
  --output result.pdf
```
