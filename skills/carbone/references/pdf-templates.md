# Carbone PDF Templates Reference

Read this file when the user asks about using a PDF as a Carbone template, filling PDF form fields (AcroForm), where to write the tags in a PDF form (in the field, in a text box over the field, in one text box anywhere), the `:fill` / `:check` / `:uncheck` / `:fillField` / `:checkField` formatters, checking or unchecking a checkbox, selecting a radio button, the font of the filled values, which tool to use to write tags in a PDF, or what a PDF template can and cannot do.

Version: 5.0+ | ENTERPRISE
Output format: PDF only. The document stays a PDF: render it without `convertTo`

A **fillable PDF (AcroForm)** can be used directly as a template: an official government form, an HR document, or a form built in Adobe Acrobat. Carbone fills its fields and returns the same PDF. It updates an **existing** form; to design a new fillable form, build an ODT template in LibreOffice and render it to PDF (`advanced-features.md` "ODT Dynamic Forms").

Supported field types: **text fields, checkboxes, radio buttons**. Buttons and other field types are silently ignored: no error is raised.

**What you need**: a PDF that already contains its form fields (created in Adobe Acrobat, PDFescape or LibreOffice Draw), and a tool to write the tags. For all three methods, use Adobe Acrobat or the built-in PDF viewer of Firefox (type a tag in a field, or add a text box with the **Text** tool, then **Save**). The built-in viewer of Google Chrome can only type tags in fields (method 1), then **Download** > **With your changes**.

**Pick the method** by what you can change in the form (the methods can be mixed in one template):

| Method | Use it when |
|---|---|
| 1: tag in the field | You can edit the form fields (a form you own). Text fields only |
| 2: text box over the field | The form must stay untouched (official or third-party form) |
| 3: target the field by name | The tags cannot sit on the fields, for radio groups, or for forms with many fields |

---

## Contents

- [Tested form](#tested-form)
- [Method 1: tag in the field](#method-1-tag-in-the-field)
- [Method 2: text box over the field](#method-2-text-box-over-the-field)
- [Method 3: target a field by name](#method-3-target-a-field-by-name)
- [What works, what does not](#what-works-what-does-not)
- [Gotchas](#gotchas)

---

## Tested form

The three methods below were rendered on the same vendor form: five text fields named `company`, `taxId`, `contact`, `email`, `address`; a radio group `paymentTerms` with the options `net30` and `net60`; a checkbox `termsAccepted` (unchecked in the template) and a checkbox `newsletter` (checked in the template). Data:

```json
{ "company": "Bluebird Logistics", "taxId": "12-3456789", "contact": "Emma Johnson",
  "email": "emma.johnson@bluebird.example", "address": "350 Fifth Avenue, Suite 4100, New York, NY 10118",
  "paymentTerms": "net60", "termsAccepted": true, "newsletter": false }
```

Report: the text fields hold the values, Net 60 is selected, `termsAccepted` is checked, `newsletter` is unchecked.

---

## Method 1: tag in the field

Type the tag as the value of a text field: `{d.company}` in the field `company` → `Bluebird Logistics`.

- The field stays editable in the report.
- The value is drawn in Helvetica, at the font size and in the color set in the field properties.
- Loops work inside a text field, so one field can repeat content for each item of an array.
- Checkboxes and radio buttons have no text value, so this method fills text fields only. Fill them in the same template with method 2 or 3.

---

## Method 2: text box over the field

Add a text box comment (a FreeText annotation, made with Acrobat's **Add text box** tool) over each field, and type a tag ending with one of these formatters. Carbone updates the field behind the text box and removes the text box from the report.

| Formatter | Effect |
|---|---|
| `:fill` | Fills the text field behind the tag |
| `:check` | Checks the checkbox or radio button behind the tag when the condition is true. Otherwise, unchecks a checkbox |
| `:uncheck` | Unchecks the checkbox behind the tag when the condition is true. Otherwise, checks it |

Tested tags, one text box each:

```
{d.company:fill}                        ← one text box per text field: company, taxId, contact, email, address
{d.paymentTerms:ifEQ('net30'):check}    ← over the "Net 30 days" radio button: not selected
{d.paymentTerms:ifEQ('net60'):check}    ← over the "Net 60 days" radio button: selected
{d.termsAccepted:ifEQ(true):check}      ← checked
{d.newsletter:ifEQ(false):uncheck}      ← checked in the template, unchecked in the report
```

- **Placement**: the text box must overlap its field; a small box inside a text field is enough. For a checkbox or a radio button, draw the box on the option's row so that it covers the button.
- If a text box overlaps several fields, Carbone updates the one it covers most; if it overlaps none, Carbone returns an error.
- Each radio button gets its own text box and condition.
- The style of the text box (color, font) does not matter: it is removed.

---

## Method 3: target a field by name

Write the tags in a text box comment anywhere in the PDF (a sticky note works too). Each tag targets a field by its name (in Acrobat, **Prepare a form** shows the field names). Carbone fills the fields and removes the text box from the report.

| Formatter | Effect |
|---|---|
| `:fillField('fieldName')` | Fills the text field named `fieldName`. On a radio group, selects the option whose name is the value. On a checkbox, any non-empty value checks it |
| `:checkField('fieldName')` | Checks the checkbox named `fieldName` when the condition is true. Otherwise, unchecks it |

Tested: one text box below the form, over no field, one tag per line:

```
{d.company:fillField('company')}
{d.taxId:fillField('taxId')}
{d.contact:fillField('contact')}
{d.email:fillField('email')}
{d.address:fillField('address')}
{d.paymentTerms:fillField('paymentTerms')}                  ← radio group: selects the option named net60
{d.termsAccepted:ifEQ(true):checkField('termsAccepted')}    ← checked
{d.newsletter:ifEQ(true):checkField('newsletter')}          ← false: the checkbox, checked in the template, is unchecked
```

**Radio buttons**: pass the name of the radio group to `:fillField()`, and use the name of the option as the value (in Acrobat, the option name is the button's **Radio Button Choice**). When the data holds another value, map it to an option name with conditions, here with data `{"paymentDays": 60}`:

```
{d.paymentDays:ifEQ(30):show(net30):ifEQ(60):show(net60):fillField('paymentTerms')}
```

If the radio group has no option with the resulting name, Carbone returns an error.

---

## What works, what does not

**Works**: substitutions, repetitions (inside a text field), formatters, translations, conditions, simple math, aggregators, form filling.

**Not available in a PDF template**: pictures, colors, `:html`, charts, barcodes, hyperlinks, `:transform`, file operations, signatures. Never suggest them for a PDF template: use DOCX, ODT or HTML when the report needs them.

---

## Gotchas

- Some viewers do not show filled forms, and the native **macOS Preview** app can break forms that contain radio buttons: check the report in Adobe Acrobat Reader or another standards-compliant viewer
- Buttons and unsupported field types are **silently ignored** rather than raising an error
