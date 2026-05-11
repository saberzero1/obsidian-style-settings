# Effect metadata contract for downstream consumers

This document describes the canonical **effect metadata** layer exposed by
`StyleSettingsEffects.ts` and exported via `StyleSettingsCore.ts`.

Downstream tools (e.g. Quartz Themes) can use this layer to build accurate
**selector-impact mappings**:

```
option → emitted effect → target (body class / CSS variable) → selector
```

and to reason about **how multiple options targeting the same selector
interact** without re-implementing Style Settings semantics downstream.

---

## Overview

The effect layer sits on top of the normalized-binding layer
(`NormalizedStyleSettingsBinding`) that is already exported by
`buildNormalizedStyleSettingsSchema`.

```
Raw YAML / CSS settings
       ↓
  parseStyleSettingsStandaloneYamlText / parseStyleSettingsStylesheetText
       ↓
  ParsedStyleSettingsResult
       ↓
  buildNormalizedStyleSettingsSchema
       ↓
  NormalizedStyleSettingsSchema  (sections → settings → bindings)
       ↓
  buildSchemaEffects  ← this layer
       ↓
  SettingEffectRecord[]  (one per setting, with one SettingEffect per binding)
```

Effects are derived **deterministically** from normalized bindings; they do not
require CSS cascade analysis or DOM access.

---

## Public API

All types and functions are exported from `src/StyleSettingsCore.ts`.

### Functions

#### `buildSettingEffects(setting, sectionId): SettingEffect[]`

Derives canonical effects for a single normalized setting.

```ts
import { buildSettingEffects, buildNormalizedStyleSettingsSchema } from './StyleSettingsCore';

const schema = buildNormalizedStyleSettingsSchema(parsed);
const section = schema.sections[0];
const setting = section.settings[0];
const effects = buildSettingEffects(setting, section.id);
```

Returns one `SettingEffect` per direct binding plus one per derived binding
(alt-format entries, gradient output).  Always returns at least one item — a
`non-emitting` effect for heading and info-text settings.

#### `buildSchemaEffects(schema): SettingEffectRecord[]`

Derives effects for every setting in a normalized schema.  This is the primary
entry point for whole-theme analysis.

```ts
import { buildSchemaEffects, buildNormalizedStyleSettingsSchema } from './StyleSettingsCore';

const schema = buildNormalizedStyleSettingsSchema(parsed);
const records = buildSchemaEffects(schema);
```

Returns one `SettingEffectRecord` per setting in schema order (section order,
then setting order within each section).

---

## Types

### `SettingEffect`

The core type.  Each instance represents a single runtime style emission from
one setting.

```ts
interface SettingEffect {
  // Identity
  settingId: string;
  settingType: string;
  sectionId: string;

  // Classification
  effectKind: SettingEffectKind;
  targetKind: SettingEffectTargetKind;
  operation: SettingEffectOperation;
  mode: SettingEffectMode;

  // Target details (present when relevant)
  className?: string;       // body-class-toggle: the toggled class
  classValues?: string[];   // body-class-select: all possible class values
  variable?: string;        // primary CSS variable (--name)
  variables?: string[];     // all CSS variables emitted
  variablePrefix?: string;  // gradient-output: variable range prefix
  variablePattern?: string; // gradient-output: pattern, e.g. "--id-{index}"

  // Interaction semantics
  interactionGroup: string;
  interactionMode: SettingEffectInteractionMode;

  // Provenance
  derivedFrom?: 'alt-format' | 'gradient';
  sourceVariable?: string;
  sourceVariables?: string[];

  // Encoding
  format?: string;
  opacity?: boolean;
}
```

### `SettingEffectKind`

| Value | Setting types | Description |
|---|---|---|
| `non-emitting` | `heading`, `info-text` | No runtime style emission. |
| `body-class-toggle` | `class-toggle` | Adds or removes a single body class. |
| `body-class-select` | `class-select` | Sets one body class from a fixed option set. |
| `css-variable` | `variable-text`, `variable-number`, `variable-number-slider`, `variable-select`, `variable-color` | Writes one or more CSS custom properties. |
| `themed-css-variable` | `variable-themed-color` | Writes CSS custom properties scoped to light or dark mode. |
| `derived-css-variable` | (alt-format outputs) | Additional CSS variables derived from a primary color binding. |
| `gradient-output` | `color-gradient` | Emits a range of indexed CSS custom properties. |

### `SettingEffectTargetKind`

| Value | Meaning |
|---|---|
| `body-class` | A class token on the `<body>` element. |
| `css-variable` | A CSS custom property (`--name`). |
| `none` | No target (non-emitting). |

### `SettingEffectOperation`

| Value | Meaning |
|---|---|
| `toggle` | Adds or removes a single class depending on the boolean value. |
| `exclusive-select` | Exactly one class from the option set is active. |
| `set` | Sets a single CSS custom property. |
| `set-multi` | Sets multiple CSS custom properties (split color formats). |
| `set-range` | Sets a range of indexed CSS custom properties (gradient). |
| `none` | No write operation (non-emitting). |

### `SettingEffectMode`

| Value | Meaning |
|---|---|
| `both` | Applies in both light and dark modes. |
| `light` | Applies only under the light-mode body selector. |
| `dark` | Applies only under the dark-mode body selector. |

### `SettingEffectInteractionMode`

| Value | Meaning |
|---|---|
| `independent` | This effect does not interact with effects from other settings on the same target. |
| `exclusive` | Only one effect in the group is active at a time (class-select options). |
| `additive` | Effects from different settings accumulate independently on the target (class-toggles). |
| `override` | Last-write-wins when multiple settings emit to the same CSS variable. |

### `SettingEffectRecord`

Groups all effects for a single setting.

```ts
interface SettingEffectRecord {
  settingId: string;
  sectionId: string;
  settingType: string;
  effects: SettingEffect[]; // at least one element
}
```

---

## Effect counts by setting type

| Setting type | Direct effects | Derived effects | Notes |
|---|---|---|---|
| `heading` | 1 (non-emitting) | 0 | |
| `info-text` | 1 (non-emitting) | 0 | |
| `class-toggle` | 1 | 0 | |
| `class-select` | 1 | 0 | |
| `variable-text` | 1 | 0 | |
| `variable-number` | 1 | 0 | |
| `variable-number-slider` | 1 | 0 | |
| `variable-select` | 1 | 0 | |
| `variable-color` | 1 | N (one per `alt-format` entry) | |
| `variable-themed-color` | 2 (light + dark) | 2×N (one per `alt-format` entry, per mode) | |
| `color-gradient` | 1 | 0 | |

---

## `interactionGroup` format

The `interactionGroup` field identifies the logical target an effect writes to.
Effects from **different settings** that share an `interactionGroup` write to
the same target and must be reasoned about together by downstream consumers.

| effectKind | interactionGroup format |
|---|---|
| `body-class-toggle` | `body-class:<className>` |
| `body-class-select` | `body-class-select:<settingId>` |
| `css-variable`, `themed-css-variable`, `derived-css-variable` | `css-variable:<primaryVariableName>` |
| `gradient-output` | `css-variable-range:<variablePrefix>` |
| `non-emitting` | `none:<settingId>` |

---

## How to use effect metadata for selector-impact analysis

### Basic option → effect → target mapping

```ts
const schema = buildNormalizedStyleSettingsSchema(parsed);
const records = buildSchemaEffects(schema);

for (const record of records) {
  for (const effect of record.effects) {
    if (effect.effectKind === 'body-class-toggle') {
      // This setting adds/removes `.${effect.className}` on <body>.
      // CSS selectors that check for this class are affected.
    } else if (effect.effectKind === 'css-variable') {
      // This setting writes `${effect.variable}` (and `effect.variables`).
      // CSS rules that consume this variable are affected.
    }
    // ...
  }
}
```

### Detecting multiple options targeting the same selector

Group effects by `interactionGroup` across all records to find settings that
write to the same target:

```ts
const byGroup = new Map<string, SettingEffect[]>();

for (const record of records) {
  for (const effect of record.effects) {
    if (!byGroup.has(effect.interactionGroup)) {
      byGroup.set(effect.interactionGroup, []);
    }
    byGroup.get(effect.interactionGroup)!.push(effect);
  }
}

// Groups with more than one effect have multiple settings on the same target.
for (const [group, effects] of byGroup) {
  if (effects.length > 1) {
    const mode = effects[0].interactionMode;
    // mode tells you how they interact: 'override', 'additive', 'exclusive'
  }
}
```

### Mode-scoped effects (light/dark)

For `variable-themed-color` settings, separate effects are emitted per mode so
you can independently reason about light and dark selectors:

```ts
for (const effect of record.effects) {
  if (effect.effectKind === 'themed-css-variable') {
    if (effect.mode === 'light') {
      // effect.variable is written under `body.theme-light.css-settings-manager`
    } else if (effect.mode === 'dark') {
      // effect.variable is written under `body.theme-dark.css-settings-manager`
    }
  }
}
```

### Derived effects (alt-format)

Alt-format outputs produce additional `derived-css-variable` effects.  Each
carries a `sourceVariable` pointing back to the primary binding so you can
trace the dependency:

```ts
for (const effect of record.effects) {
  if (effect.effectKind === 'derived-css-variable') {
    // effect.variable is the derived output (e.g. '--my-color-rgb')
    // effect.sourceVariable is the primary binding (e.g. '--my-color')
    // effect.format is the derived color format (e.g. 'rgb')
  }
}
```

---

## Non-goals

The effect layer deliberately does **not**:

- perform CSS cascade analysis or resolve selector specificity
- parse theme CSS to discover which selectors consume a variable
- compute runtime DOM state or computed style values
- fully model plugin-snippet interaction chains

These belong to a future **selector-graph layer** that can be built on top of
the effect primitives exposed here.

---

## Relationship to normalized bindings

The effect layer is a semantic view over `NormalizedStyleSettingsBinding`.  The
mapping is:

| NormalizedStyleSettingsBindingKind | SettingEffectKind |
|---|---|
| `non-emitting` | `non-emitting` |
| `body-class-toggle` | `body-class-toggle` |
| `body-class-select` | `body-class-select` |
| `css-variable` | `css-variable` |
| `themed-css-variable` | `themed-css-variable` |
| `derived-css-variable` | `derived-css-variable` |
| `gradient-output` | `gradient-output` |

The binding layer remains the authoritative source of truth; the effect layer
adds interaction semantics, mode annotations, and `interactionGroup` grouping on
top.
