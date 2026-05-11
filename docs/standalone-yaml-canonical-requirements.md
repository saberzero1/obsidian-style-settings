# Standalone YAML canonical requirements

Standalone sidecar YAML files (e.g. `style-settings.yaml`) are an alternative way to provide Style Settings definitions without embedding them inside CSS comment blocks. This document describes the canonical schema requirements, the validation diagnostics produced when those requirements are violated, and common repair patterns.

---

## Document structure

A standalone YAML document must match one of the following two forms.

### Form 1 — sections array (preferred)

```yaml
mode: replace           # optional; "replace" (default) or "override"
sections:
  - id: my-section
    name: My Section
    settings:
      - ...
```

### Form 2 — single section at the top level

```yaml
id: my-section
name: My Section
settings:
  - ...
```

**Required fields:**

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique identifier for the section. |
| `name` | string | Human-readable section name. |
| `settings` | array | Array of setting objects (may be empty). |

**Diagnostic codes related to document structure:**

| Code | Severity | Cause |
|---|---|---|
| `YAML_PARSE_ERROR` | error | The document is not valid YAML. |
| `INVALID_STANDALONE_YAML_DOCUMENT` | error | The document does not have a `sections` array or a single section object. |
| `INVALID_SIDECAR_MODE` | error | `mode` is present but is not `"replace"` or `"override"`. |
| `INVALID_SECTION` | error | A section object is missing a required `name`, `id`, or `settings` field. |
| `DUPLICATE_SECTION_ID` | error | Two sections share the same `id`; only the first is kept. |

---

## Sidecar mode semantics

| Mode | Behaviour |
|---|---|
| `replace` | The sidecar YAML is the authoritative settings source. Any CSS-embedded settings are ignored. |
| `override` | The sidecar YAML is merged on top of CSS-embedded settings. Sections and settings are matched by `id`; matching entries are replaced. |

---

## Common setting required fields

Every setting object must have the following fields regardless of type.

| Field | Type | Required |
|---|---|---|
| `id` | string | ✅ Yes |
| `type` | string | ✅ Yes |
| `title` | string | ✅ Yes (except `color-gradient`) |

**Diagnostic codes for missing common fields:**

| Code | Severity | Cause |
|---|---|---|
| `MISSING_SETTING_ID` | error | `id` is absent or empty. |
| `MISSING_SETTING_TYPE` | error | `type` is absent or empty. |
| `UNSUPPORTED_SETTING_TYPE` | error | `type` is not a recognised setting type. |
| `MISSING_SETTING_TITLE` | error | `title` is absent or empty (on types that require it). |
| `DUPLICATE_SETTING_ID` | error | Two settings in the same section share the same `id`; only the first is kept. |

---

## Color setting types

Color-related settings have the strictest schema requirements. Missing or unsupported `format` values are the most common source of downstream schema violations.

### `variable-color`

Sets a single CSS custom property to a user-selected color.

**Required fields:**

| Field | Type | Required | Valid values |
|---|---|---|---|
| `format` | string | ✅ Yes | See [supported color formats](#supported-color-formats) |
| `default` | string | No | CSS color string starting with `#`, `rgb`, or `hsl` |
| `opacity` | boolean | No | `true` / `false` |
| `alt-format` | array | No | Array of `{ id, format }` entries (see [alt-format](#alt-format)) |

**Example (valid):**

```yaml
- id: my-accent-color
  type: variable-color
  title: Accent Color
  format: hex
  default: "#7c3aed"
```

**Common repair patterns:**

| Problem | Repair |
|---|---|
| `format` is absent | Add `format: hex` (or any other supported format). |
| `format` is `oklch`, `lab`, etc. | Replace with a supported format: `hex`, `hsl`, `rgb`, etc. |
| `default` is not a CSS color string | Change to a value starting with `#`, `rgb(`, or `hsl(`. |

**Diagnostic codes:**

| Code | Severity | Cause |
|---|---|---|
| `MISSING_COLOR_FORMAT` | error | `format` is absent. |
| `UNSUPPORTED_COLOR_FORMAT` | error | `format` is not in the supported set. |
| `INVALID_DEFAULT` | error | `default` does not start with `#`, `rgb`, or `hsl`. |
| `INVALID_ALT_FORMAT` | error | An `alt-format` entry has a missing/unsupported `id` or `format`. |

---

### `variable-themed-color`

Sets separate CSS custom properties for light and dark themes.

**Required fields:**

| Field | Type | Required | Valid values |
|---|---|---|---|
| `format` | string | ✅ Yes | See [supported color formats](#supported-color-formats) |
| `default-light` | string | ✅ Yes | CSS color string starting with `#`, `rgb`, or `hsl` |
| `default-dark` | string | ✅ Yes | CSS color string starting with `#`, `rgb`, or `hsl` |
| `opacity` | boolean | No | `true` / `false` |
| `alt-format` | array | No | Array of `{ id, format }` entries (see [alt-format](#alt-format)) |

**Example (valid):**

```yaml
- id: my-themed-color
  type: variable-themed-color
  title: Themed Color
  format: hex
  default-light: "#ffffff"
  default-dark: "#000000"
```

**Diagnostic codes:**

| Code | Severity | Cause |
|---|---|---|
| `MISSING_COLOR_FORMAT` | error | `format` is absent. |
| `UNSUPPORTED_COLOR_FORMAT` | error | `format` is not in the supported set. |
| `MISSING_THEMED_COLOR_FIELDS` | error | `default-light` or `default-dark` is absent. The message identifies which field is missing. |
| `INVALID_DEFAULT` | error | `default-light` or `default-dark` is not a valid CSS color string. |
| `INVALID_ALT_FORMAT` | error | An `alt-format` entry has a missing/unsupported `id` or `format`. |

---

### `color-gradient`

Emits a sequence of CSS custom properties interpolated between two colors.

**Required fields:**

| Field | Type | Required | Valid values |
|---|---|---|---|
| `from` | string | ✅ Yes | CSS color string starting with `#`, `rgb`, or `hsl` |
| `to` | string | ✅ Yes | CSS color string starting with `#`, `rgb`, or `hsl` |
| `format` | string | ✅ Yes | `hex`, `hsl`, or `rgb` |
| `step` | number | ✅ Yes | Positive integer |
| `pad` | number | No | Non-negative integer |

**Example (valid):**

```yaml
- id: my-gradient
  type: color-gradient
  format: hex
  from: "#000000"
  to: "#ffffff"
  step: 1
```

**Diagnostic codes:**

| Code | Severity | Cause |
|---|---|---|
| `MISSING_GRADIENT_FIELDS` | error | `from`, `to`, `format`, or `step` is absent. The message identifies which field is missing. |
| `UNSUPPORTED_GRADIENT_FORMAT` | error | `format` is not `hex`, `hsl`, or `rgb`. |
| `INVALID_GRADIENT_STEP` | error | `step` is zero or negative. |

---

## Supported color formats

The `format` field on `variable-color` and `variable-themed-color` must be one of the following values:

| Format | CSS variable output |
|---|---|
| `hex` | `#rrggbb` |
| `hsl` | `hsl(H, S%, L%)` |
| `hsl-split` | Three separate variables for H, S, L |
| `hsl-split-decimal` | Three separate variables for H, S (decimal), L (decimal) |
| `hsl-values` | `H, S%, L%` (comma-separated, no `hsl()` wrapper) |
| `rgb` | `rgb(R, G, B)` |
| `rgb-split` | Three separate variables for R, G, B |
| `rgb-values` | `R, G, B` (comma-separated, no `rgb()` wrapper) |

The `format` field on `color-gradient` accepts only: `hex`, `hsl`, `rgb`.

---

## alt-format

The optional `alt-format` field on `variable-color` and `variable-themed-color` emits additional CSS variables in different color formats alongside the primary variable.

Each entry must be an object with:

| Field | Type | Required |
|---|---|---|
| `id` | string | ✅ Yes — used as the CSS variable name suffix |
| `format` | string | ✅ Yes — must be one of the [supported color formats](#supported-color-formats) |

**Example:**

```yaml
- id: my-color
  type: variable-color
  title: Accent Color
  format: hex
  default: "#7c3aed"
  alt-format:
    - id: my-color-rgb
      format: rgb
    - id: my-color-hsl
      format: hsl
```

---

## Other setting types

### `variable-number`

| Field | Required |
|---|---|
| `default` (numeric) | ✅ Yes |
| `format` (string suffix) | No |

### `variable-number-slider`

| Field | Required |
|---|---|
| `default` (numeric) | ✅ Yes |
| `min` (numeric) | ✅ Yes |
| `max` (numeric) | ✅ Yes |
| `step` (numeric, > 0) | ✅ Yes |
| `format` (string suffix) | No |

### `variable-text`

| Field | Required |
|---|---|
| `default` (string) | ✅ Yes |
| `quotes` (boolean) | No |

### `variable-select`

| Field | Required |
|---|---|
| `default` (must match an option value) | ✅ Yes |
| `options` (non-empty array) | ✅ Yes |

### `class-toggle`

| Field | Required |
|---|---|
| `default` (boolean) | No |

### `class-select`

| Field | Required |
|---|---|
| `options` (non-empty array) | ✅ Yes |
| `allowEmpty` (boolean) | ✅ Yes |
| `default` (must match option or be `"none"` when `allowEmpty: true`) | Conditional |

### `heading`

| Field | Required |
|---|---|
| `level` (integer 1–6) | ✅ Yes |
| `collapsed` (boolean) | No |

### `info-text`

| Field | Required |
|---|---|
| `markdown` (boolean) | No |

---

## Override mode specifics

When `mode: override` is set at the document level, the sidecar is merged on top of CSS-derived settings.

- Per-section `replace: true` overrides the document-level mode for that section.
- Setting removal (`remove: true`) is not yet supported in override mode; entries with this flag are ignored and a `UNSUPPORTED_OVERRIDE_REMOVE` warning is emitted.
- Sections with no effective override settings emit an `EMPTY_OVERRIDE_SECTION` warning.

---

## Diagnostic severity summary

| Severity | Meaning |
|---|---|
| `error` | The setting or section cannot be used; it is dropped from the parsed output. |
| `warning` | The setting or section was accepted but something unexpected was found. |

Consumers of `buildNormalizedStyleSettingsSchema` should treat any `error`-severity diagnostic as a signal to repair the sidecar YAML before relying on the parsed output.
