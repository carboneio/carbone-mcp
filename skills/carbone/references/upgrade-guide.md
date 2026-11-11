# Carbone Upgrade Guide

Read this file when the user asks about upgrading or migrating between Carbone versions, the `carbone-version` header, differences between v4 and v5, `templateId` vs `versionId`, LibreOffice rendering changes, breaking changes between versions, or Studio Web Component migration (`openTemplate`, `template:saved`, `template:updated` events).

References:
- https://carbone.io/company/carbone-v5-news.html
- https://carbone.io/documentation/developer/on-premise-installation/upgrade-guide.html

---

## v4 → v5

### Activating v5

Migration is **instant and non-blocking**. Add a single header to your API calls:

```http
carbone-version: 5
```

The API defaults to v4 — your existing calls are unaffected until you add this header. You can enable v5 per environment, per request, or gradually, at your own pace. Rolling back is as simple as removing the header.

### Before you switch

**1. Stricter template syntax detection**

Carbone v5 detects template errors more strictly than v4. The most common issue is a **missing `[i+1]` end-marker row** at the end of a loop, which v4 sometimes accepted silently.

- Templates that work correctly in v4 will continue to work in v5
- If an error exists, v5 will report it explicitly rather than silently producing incorrect output — this is a good thing
- **Recommended**: test your templates in Carbone Studio and verify documents generate without errors under v5 before switching production traffic

**Escape hatch — v4 compatibility mode (v5.13.0+)**

If legacy templates block the switch, a pre-release version code **below `5000000`** (e.g. `{o.preReleaseFeatureIn=4025011}`) stops v5 reporting the missing `[i+1]` end-marker. Set globally via `CARBONE_PRE_RELEASE_FEATURE_IN` to migrate a fleet of templates without editing them.

⚠️ It disables every v5 feature and fix at the same time — go live, then fix the templates and remove it. Semantics and values → `in-template-options.md`.

**2. New document converter — LibreOffice 25.2**

The Carbone Cloud v5 uses **LibreOffice 25.2** (vs 7.5 in v4). PDF rendering — especially from DOCX templates — may vary slightly. Output is generally improved, but visual differences are possible.

**Recommended**: compare before/after renders on a representative sample of your templates before switching production.

### `templateId` vs `versionId` — opt-in only

v5 introduces a **stable `templateId`** that persists across template updates (useful for versioning workflows). This is **opt-in** and only activated if you pass `versioning: true` when uploading a template:

```http
POST /template
{ "versioning": true, ... }
```

Without `versioning: true`:
- Your existing calls using the SHA-256 template identifier continue to work exactly as before
- That identifier is now called `versionId` in v5 nomenclature, but behaves identically
- You can safely ignore this feature until it becomes useful to you

---

## v5.0 → v5.1.1

> Applies only if you use the **Embedded Studio Web Component**.

### New embedded modes

The studio starts in `embedded` mode by default (same as v5.0). In v5.1.1, the **"Save" button has been removed** from this mode. Review the two execution modes carefully before upgrading.

### Function changes

`openTemplate(templateObj, options)` is deprecated in v5.1.1. Given these constants:

```js
const _previewOptions = { data: {} }
const _templateObject = {
  templateId: '212121212121212',
  extension:  'docx',
  comment:    'file name'
}
```

**Before (v5.0):**
```js
studio.openTemplate(_templateObject, _previewOptions);
```

**After (v5.1.1+):**
```js
studio.setRenderOptions(_previewOptions, false);
studio.openTemplateVersionId(_templateObject.templateId, _templateObject.extension, _templateObject);
```

Or use one of the 5 new methods to open a template for forward compatibility.

### Event changes

**`options:updated`** — v5.1 adds `lang`, `timezone`, `converter`, `currencySource` to the event payload:
```js
studio.addEventListener('options:updated', (e) => {
  // e.detail in v5.1+:
  // { data, complement, enum, translations, lang, timezone, converter, currencySource }
});
```

**`template:updated`** — v5.1 always returns a valid data-URI with `createdAt`. v5.0 sometimes returned a plain base64 string without the `data:` prefix:
```js
// v5.1+: { createdAt: 1767108187, type: "html", dataURI: "data:text/html;base64,..." }
// v5.0:  { type: "html", dataURI: "PCFET0NUW..." }  ← no data-URI prefix, no createdAt
```

**`template:saved`** — v5.1 returns the full internal template object. Clone it before modifying (direct reference). Internal fields starting with `_` may change in future versions:
```js
// v5.1+: { versionId, id, createdAt, expireAt, deployedAt, size, type, name, comment, tags, origin, sample }
// v5.0:  { templateId, extension }  ← minimal object
```

---

## Migration checklist

- [ ] Test templates in Carbone Studio with v5 — check for loop end-marker errors
- [ ] Compare PDF output on a sample of templates
- [ ] Add `carbone-version: 5` header to a staging environment
- [ ] Validate document output matches expectations
- [ ] Roll out to production — remove header to roll back at any time
