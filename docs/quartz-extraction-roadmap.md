# Quartz extraction-oriented roadmap

This fork now treats Style Settings definitions as data that should be machine-readable, diagnosable, and reproducible for downstream tooling such as Quartz Themes. This document summarizes what changed across extraction-oriented PRs and outlines the next improvements that would further strengthen extraction workflows.

## Sidecar YAML support (this PR)

This pass adds standalone sidecar YAML as a first-class parser input path on top of the shared parser core.

- Added standalone YAML document ingestion through the same parser/normalization/validation/export pipeline used by CSS `@settings` extraction.
- Added explicit sidecar mode semantics:
  - `replace`: use the sidecar YAML definitions as the authoritative settings source.
  - `override`: start from CSS-derived settings and apply deterministic YAML section/setting replacements.
- Override merge behavior is intentionally simple and deterministic:
  - section-level replacement is supported
  - setting-level replacement/addition by `id` is supported
  - removals are currently deferred
- Source provenance is preserved in structured output via source kind metadata for:
  - CSS-only (`embedded-css`)
  - YAML-only (`standalone-yaml`)
  - CSS + YAML override (`css-yaml-override`)

This enables Quartz Themes to keep maintained sidecar definitions for broken or abandoned upstream themes while still using CSS-embedded settings when available.

## Hardening pass (PR #2)

This pass addressed upstream bug classes that could poison settings, crash the parser, or produce incorrect output for Quartz automation.

### 1. Numeric input validation (`variable-number`)

Upstream issue class: [obsidian-community/obsidian-style-settings#189](https://github.com/obsidian-community/obsidian-style-settings/issues/189)

The `onChange` handler in `VariableNumberSettingComponent` previously called `parseFloat`/`parseInt` on raw user input without checking for `NaN`. Typing an invalid value (e.g. letters, empty string) would save `NaN` to settings, poisoning the stored state and producing broken CSS variables.

**Fix**: Validate the parsed result with `Number.isFinite` before persisting. Invalid input is silently ignored, leaving the last valid value in place.

### 2. `variable-text` empty-string default propagation

Upstream issue class: [obsidian-community/obsidian-style-settings#187](https://github.com/obsidian-community/obsidian-style-settings/issues/187)

Two related bugs affected text settings with empty-string values:

- The UI component used a truthy check (`value ?`) to decide whether to display the saved value or the default. Because empty string is falsy, explicitly saving an empty string would cause the UI to display the default instead of the saved value.
- The CSS variable emission in `getCSSVariables` used `text !== '""'` to detect the empty-string sentinel, but did not also guard against an actual zero-length string, which could result in wrapping an empty string in quotes (`''`) when `quotes: true`.

**Fix**: Changed the UI component check to `value !== undefined` and updated the quotes guard to `text && text !== '""'` so that both the sentinel and true empty string emit an empty value.

### 3. `rgb-values` / `rgb-split` format correctness

Upstream issue class: [obsidian-community/obsidian-style-settings#191](https://github.com/obsidian-community/obsidian-style-settings/issues/191)

`chroma.js` `.rgb()` can return floating-point channel values (e.g. `254.99999`). The previous code emitted raw floats, producing output like `254.99999,0,0` instead of the documented `255, 0, 0`. This would break any downstream consumer (including Quartz) that feeds these values into `rgb()` or `rgba()`.

**Fix**: Applied `Math.round()` to all three channels in both `rgb-values` and `rgb-split` cases, and added spaces after commas in `rgb-values` to match the documented format.

### 4. Parser/schema hardening for "not iterable" crashes

Upstream issue class: [obsidian-community/obsidian-style-settings#200](https://github.com/obsidian-community/obsidian-style-settings/issues/200)

Two places assumed array-ness without defensive checks:

- `removeClasses` in `CSSSettingsManager` called `multiToggle.options.forEach(...)` without verifying that `options` is actually an array, which would throw if a `class-select` setting reached the config with a malformed/missing options list.
- `setConfig` called `s.settings.forEach(...)` unconditionally, which would throw if `settings` was `null` or `undefined` on a parsed section (possible with malformed or partially-parsed input).

**Fix**: Wrapped both loops in `Array.isArray(...)` guards so that malformed input is silently skipped instead of throwing.

### 5. YAML parsing safety

Upstream issue class: [obsidian-community/obsidian-style-settings#206](https://github.com/obsidian-community/obsidian-style-settings/issues/206)

Advisory database confirms `js-yaml@4.1.0` has no known vulnerabilities. The v4 series already removed all `!!js/` type tags that were the source of prototype-pollution issues in v3.x.

**Fix**: Added an explicit `schema: yaml.DEFAULT_SCHEMA` option to the `yaml.load` call to make the safe schema selection visible and intention-clear, and to ensure any future js-yaml version changes cannot silently revert to a less safe default.

## What changed in PR #1

### 1. Block-local parsing and provenance

- `@settings` parsing now operates on each matched block independently instead of deriving metadata from the entire stylesheet text.
- Multiple `@settings` blocks in the same stylesheet are parsed separately and retain their own provenance.
- Parsed sections now preserve source metadata such as:
  - stylesheet/source name
  - block index
  - line range
  - raw YAML
  - raw comment text

This makes debugging extraction failures much easier and prevents metadata bleed between blocks.

### 2. Stronger semantic validation with structured diagnostics

The parser now emits structured diagnostics instead of silently accepting malformed definitions. Validation currently covers high-value extraction issues including:

- duplicate section IDs
- duplicate setting IDs within a section
- missing required section fields
- missing required setting fields by type
- malformed or empty option arrays
- invalid select defaults
- invalid slider defaults and ranges
- invalid color defaults
- invalid `alt-format` structures
- unsupported setting types

The parser stays resilient by skipping invalid units where practical while still collecting warnings and errors with source context.

### 3. First-class normalized schema export

This PR introduces a normalized schema export pipeline in `src/StyleSettingsParser.ts` and a debugging command in Obsidian:

- **Copy normalized Style Settings schema JSON**

The normalized schema includes:

- sections
- normalized settings
- normalized options
- defaults/default maps
- type information
- binding-oriented metadata
- source metadata
- structured diagnostics

This should reduce the amount of parser duplication needed in Quartz-side tooling.

### 4. Parser architecture improvements

The parsing logic is now extracted into a reusable module instead of living entirely inside the plugin runtime flow. That makes it easier to:

- reuse the same parsing rules in automation
- reason about parser behavior independently from the UI
- evolve validation and normalization without touching unrelated UI code

The parser now also exposes reusable stage entry points:

- `extractStyleSettingsSourcesFromCssText(...)`
- `parseStyleSettingsSources(...)`
- `buildNormalizedStyleSettingsSchema(...)`

and a dedicated re-export module at `src/StyleSettingsCore.ts` for downstream consumers. Source metadata also includes a `sourceKind` discriminator (`embedded-css` now, `standalone-yaml` reserved) to keep future sidecar YAML support additive.

## Architectural recommendations for future extraction-focused work

### A. Add standalone YAML support

Status: ✅ Completed in this PR (including explicit `replace` / `override` sidecar semantics on top of the shared parser core).

The biggest remaining extraction ergonomics improvement would be first-class support for sidecar files such as:

- `style-settings.yaml`
- `theme.style-settings.yaml`

Benefits:

- easier linting and validation
- cleaner diffs
- no dependence on CSS comment formatting
- easier generation by external tools
- simpler Quartz-side ingestion

Recommended direction:

- support both embedded comment blocks and standalone YAML
- preserve a source kind in provenance metadata (`embedded-css`, `standalone-yaml`, etc.)
- define deterministic precedence rules when both are present

### B. Extract the parser as a pure standalone module/package

The current parser is reusable within the repo, but future work should make it consumable without the rest of the plugin bundle.

Recommended direction:

- keep the parser free of Obsidian/runtime imports
- expose stable entry points for:
  - block extraction
  - validation
  - normalization
  - schema export
- consider publishing a small standalone package or subpath export for automation consumers

This would let Quartz Themes and other tooling consume exactly the same parser behavior as the plugin.

### C. Add strict extraction mode

Because this fork is explicitly extraction-oriented, a stricter mode would be valuable for CI and batch processing.

Possible behavior:

- fail closed on duplicate IDs
- require fully normalized option objects
- reject ambiguous defaults
- reject unsupported fields/types
- optionally elevate warnings to errors

Recommended direction:

- support both permissive mode and strict extraction mode
- include strictness metadata in the exported schema
- make strict mode usable from both commands and programmatic APIs

### D. Expand binding metadata

The current binding metadata is intentionally lightweight. Quartz-focused consumers would benefit from richer derived semantics such as:

- explicit CSS variable names produced by split/alternate color formats
- themed selector metadata beyond hard-coded light/dark targets
- generated variable ranges for gradients
- body class application rules for `class-select`
- dependency metadata for settings that derive variables from other settings

Recommended direction:

- add canonical `binding.kind` variants
- include derived output variable lists
- add machine-readable dependency edges between settings

### E. Add schema/value compatibility validation for values JSON

Status: ✅ Completed in this PR (theme-aware filtering + validation for mixed-theme exported values JSON).

Quartz and future sync tooling need a robust way to validate imported/exported values JSON against the structured Style Settings schema.

This pass adds a parser-core-friendly compatibility API that:

- preserves and exposes key identity semantics (`sectionId@@settingId` and themed `@@light` / `@@dark` modifiers)
- filters mixed-theme exports by schema relevance and ignores unrelated sections gracefully
- validates relevant keys against schema-defined setting types, options, modifiers, numeric constraints, and color validity
- returns categorized machine-readable results (`accepted`, `ignored`, `rejected`) plus a cleaned accepted-values object

This will prevent configuration drift and catch incompatible values early before they reach runtime/theme generation.

### F. Add schema versioning guarantees

Automation consumers need a stable contract.

Recommended direction:

- define a documented schema versioning policy
- increment schema version for breaking export changes
- optionally provide migration helpers or compatibility shims
- document which fields are stable versus experimental

### G. Improve diagnostics further

The current diagnostics are already much better than silent failures, but future work could improve them further.

Recommended direction:

- distinguish parse, validation, normalization, and runtime diagnostics
- add diagnostic categories/tags
- include end-user remediation hints
- include exact setting paths and, where possible, YAML line/column spans
- allow callers to request only errors or full warning streams

### H. Support extraction from non-DOM inputs

Today the plugin runtime still discovers stylesheets via the DOM. For Quartz tooling, direct file-based extraction would be more robust.

Recommended direction:

- add helpers that accept raw file text plus a source path
- support batch parsing of multiple files in a single call
- produce deterministic output ordering for build pipelines

### I. Add fixture-based parser coverage

This repository does not currently have parser-focused automated tests. Future work should add fixture-driven coverage for extraction behavior.

Recommended coverage areas:

- multiple blocks in one stylesheet
- duplicate IDs
- malformed YAML
- invalid option structures
- slider/default validation
- color/themed-color validation
- normalized schema snapshots

### J. Add binding-impact metadata and/or static impact analysis

Quartz Themes mapping quality improves when tooling can answer which settings affect which classes, variables, and rendered elements.

Recommended direction:

- extend binding metadata with explicit impact targets where deterministic
- optionally add static impact analysis to trace class/variable/selector effects
- expose this in machine-readable form for high-confidence `themes.json.styleSettings` generation

This is especially valuable for future Quartz Syncer workflows that need highly accurate downstream mapping.

## Suggested next-step PRs

If future contributors want a clean follow-up sequence, this is a good order:

1. Add parser fixtures and schema snapshot tests.
2. Add richer binding/dependency metadata (including impact analysis where feasible).
3. Add strict extraction mode with configurable severity.
4. Publish or expose the parser as a pure standalone consumable module.
5. Formalize schema versioning and diagnostics taxonomy.

## Guidance for future contributors

When making extraction-focused changes in this fork:

- prioritize deterministic machine-readable output over permissive UI behavior
- preserve provenance whenever parsing or normalization changes
- prefer structured diagnostics over silent fallbacks
- keep parsing logic reusable outside Obsidian UI code
- update the normalized schema contract deliberately and document any breaking changes

That direction should keep this fork well aligned with Quartz Themes and other downstream automation use-cases.
