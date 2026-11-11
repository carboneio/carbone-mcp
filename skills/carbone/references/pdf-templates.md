# Carbone PDF Templates Reference

Read this file when the user asks about using a PDF as a Carbone template, filling PDF form fields (AcroForm), the `:fill` / `:check` / `:uncheck` / `:fillField` / `:checkField` formatters, or what a PDF template can and cannot do.

Version: 5.0+ | ENTERPRISE (Cloud or On-Premise) — **not available in Embedded Carbone JS**
Output format: PDF only — the document stays a PDF, so no `convertTo` is needed

A **fillable PDF (AcroForm)** can be used directly as a template: an official government form, an HR document, or a form built in Adobe Acrobat. Carbone fills its fields and returns the same PDF.

Supported field types: **text fields, checkboxes, radio buttons**. Buttons and other field types are silently ignored — no error is raised.

---

## Contents

- [Method 1 — tag in the field value](#method-1--tag-in-the-field-value)
- [Method 2 — annotation above the field](#method-2--annotation-above-the-field)
- [Method 3 — target a field by name](#method-3--target-a-field-by-name)
- [What works, what does not](#what-works-what-does-not)
- [Gotchas](#gotchas)
- [API call](#api-call)

---

## Method 1 — tag in the field value

Write the Carbone tag directly in the form field's default value:

```
{d.user.firstName}
```

Loops are supported inside a text field, so a single field can repeat content for each item of an array.

---

## Method 2 — annotation above the field

Add a text annotation positioned **over** the target field:

```
{d.myText:fill}                        ← fills the text field behind the tag
{d.myCondition:ifEQ(true):check}       ← checks the checkbox/radio behind the tag
{d.myCondition:ifEQ(false):uncheck}    ← unchecks the checkbox behind the tag
```

The annotation must overlap the field. If no field sits beneath it, Carbone returns an error.

---

## Method 3 — target a field by name

No positional overlay needed — the tag can sit anywhere in the document:

```
{d.text:fillField('fieldName')}                             ← fill a text field or check a checkbox
{d.genre:ifEQ('boy'):show(male):fillField('radioGroup')}    ← select a radio button option
{d.confirm:ifEQ(true):checkField('fieldName')}              ← check a checkbox if the condition is true
```

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
