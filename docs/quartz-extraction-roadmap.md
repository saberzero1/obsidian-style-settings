# Quartz extraction-oriented roadmap

This fork now treats Style Settings definitions as data that should be machine-readable, diagnosable, and reproducible for downstream tooling such as Quartz Themes. This document summarizes what changed in this PR and outlines the next improvements that would further strengthen extraction workflows.

## What changed in this PR

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

## Architectural recommendations for future extraction-focused work

### A. Add standalone YAML support

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

### E. Add schema versioning guarantees

Automation consumers need a stable contract.

Recommended direction:

- define a documented schema versioning policy
- increment schema version for breaking export changes
- optionally provide migration helpers or compatibility shims
- document which fields are stable versus experimental

### F. Improve diagnostics further

The current diagnostics are already much better than silent failures, but future work could improve them further.

Recommended direction:

- distinguish parse, validation, normalization, and runtime diagnostics
- add diagnostic categories/tags
- include end-user remediation hints
- include exact setting paths and, where possible, YAML line/column spans
- allow callers to request only errors or full warning streams

### G. Support extraction from non-DOM inputs

Today the plugin runtime still discovers stylesheets via the DOM. For Quartz tooling, direct file-based extraction would be more robust.

Recommended direction:

- add helpers that accept raw file text plus a source path
- support batch parsing of multiple files in a single call
- produce deterministic output ordering for build pipelines

### H. Add fixture-based parser coverage

This repository does not currently have parser-focused automated tests. Future work should add fixture-driven coverage for extraction behavior.

Recommended coverage areas:

- multiple blocks in one stylesheet
- duplicate IDs
- malformed YAML
- invalid option structures
- slider/default validation
- color/themed-color validation
- normalized schema snapshots

## Suggested next-step PRs

If future contributors want a clean follow-up sequence, this is a good order:

1. Add parser fixtures and schema snapshot tests.
2. Add standalone YAML support.
3. Add richer binding/dependency metadata.
4. Add strict extraction mode with configurable severity.
5. Publish or expose the parser as a pure standalone consumable module.
6. Formalize schema versioning and diagnostics taxonomy.

## Guidance for future contributors

When making extraction-focused changes in this fork:

- prioritize deterministic machine-readable output over permissive UI behavior
- preserve provenance whenever parsing or normalization changes
- prefer structured diagnostics over silent fallbacks
- keep parsing logic reusable outside Obsidian UI code
- update the normalized schema contract deliberately and document any breaking changes

That direction should keep this fork well aligned with Quartz Themes and other downstream automation use-cases.
