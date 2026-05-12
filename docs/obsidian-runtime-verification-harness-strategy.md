# Obsidian runtime selector verification harness strategy

This document proposes how `saberzero1/obsidian-style-settings` should evolve from a parser/export plugin into a **privileged Obsidian-side runtime selector verification and instrumentation harness** for Quartz Themes extraction.

The goal is not to make the plugin safer or more portable for general Obsidian users. The goal is to make extraction **materially more accurate, more observable, and more debuggable** for `saberzero1/quartz-themes`.

---

## Existing Quartz Themes pipeline context

`saberzero1/quartz-themes` already has a meaningful extraction and verification pipeline. This strategy should therefore be read as an extension of that pipeline, not a replacement for it.

### What Quartz already does today

From the current `justfile` and `runner/scripts/`:

- `just cli-extract`, `cli-extract-all`, and related tasks drive extraction through **Obsidian CLI**
- `just style-settings` populates Style Settings metadata for Quartz-side use
- `runner/scripts/cli-extractor.js`:
  - writes `.obsidian/appearance.json`
  - writes Style Settings plugin state into `.obsidian/plugins/obsidian-style-settings/data.json`
  - enables required plugins
  - opens a broad fixture set inside the vault
  - waits for Obsidian readiness
  - extracts computed styles for configured selector/property targets
  - deduplicates theme output against a default Obsidian baseline
- `runner/scripts/config.js` already defines a substantial mapping layer of:
  - `obsidianSelector`
  - `publishSelector`
  - `quartzSelector`
  - `pseudoElement`
  - `properties`
- `runner/scripts/verify-style-settings.mjs` already verifies runtime-evidence readiness using:
  - `style_settings.effects` from `themes.json`
  - `buildSelectorImpactGraph(...)`
  - `effectSettingIdsFromEffectRecords(...)`
  - `enumerateRuntimeObservationPayloads(...)`
  - per-mode runtime evidence sidecars
  - a smaller representative fixture subset for bounded live verification

### Implication for this document

The plugin-side strategy should not assume Quartz needs a brand-new end-to-end extraction architecture. Quartz already owns:

- static selector/property mapping into Quartz surfaces
- Obsidian CLI orchestration
- fixture inventory
- baseline diffing
- runtime evidence planning from canonical Style Settings effects

The missing piece is a more privileged **in-Obsidian observation layer** that can make Quartz's existing plans more reliable and more informative.

---

## Problem statement

Quartz-side extraction now has several major capabilities:

- selector-impact graphing
- transitive variable tracing
- runtime evidence sidecars
- multi-mode support
- multi-surface fixture-based live observation

That work moved the bottleneck. The remaining accuracy frontier is now less about Quartz orchestration and more about what can be observed and controlled **inside** Obsidian at runtime.

### Current limitation: runtime evidence only sees rendered surfaces

Quartz-side runtime evidence works by rendering known fixture surfaces and checking whether selector-linked style outputs can be observed. This is useful, but it has an unavoidable limit:

- selectors that never materialize in the rendered DOM cannot be confirmed
- selectors behind collapsed, virtualized, deferred, tabbed, or off-screen UI may be under-observed
- app-shell selectors may depend on sidebars, active leaves, modal state, workspace layout, or plugin UI state
- some selectors only become meaningful after a specific internal Obsidian lifecycle transition
- Quartz's current CLI flow can open many fixtures, but it still fundamentally observes from outside the Obsidian runtime boundary and relies on generic readiness heuristics

As a result, a theme can be statically extracted correctly while still producing weak or incomplete runtime evidence.

### Static extraction and runtime observability are different problems

It is important to keep the two problem classes separate.

#### 1. Selector discovery / static extraction

This is the Quartz-side problem of determining:

- which settings emit which body classes or CSS variables
- which selectors reference those classes or variables
- which transitive dependencies connect settings to downstream selectors

This is fundamentally a parsing and analysis problem.

#### 2. Runtime observability / selector verification

This is the Obsidian-side problem of determining:

- whether a selector actually matched live DOM during a controlled run
- which surface, mode, and workspace state caused the match
- whether changing a setting produced an observable computed-style difference
- whether a selector remained unobserved because it was impossible to materialize, not because static extraction was wrong

This is fundamentally a harness and instrumentation problem.

Quartz can reason about selectors statically. Obsidian is the better place to force those selectors to become visible, measure them, and explain why they did or did not fire.

### The practical bottleneck in the current split

Today Quartz already performs three important jobs well:

1. **static target definition**
   - canonical Style Settings effects from `style_settings.effects`
   - selector-impact graph construction
   - property-target configuration via `runner/scripts/config.js`
2. **external orchestration**
   - Obsidian CLI commands
   - theme/mode/snippet/style-settings state setup
   - fixture opening
3. **downstream normalization**
   - baseline diffing
   - result sidecars
   - verification reports

What Quartz does **not** control precisely enough yet is the internal Obsidian state needed to guarantee that selector targets are actually materialized and stable when the observation occurs.

---

## Why the Obsidian plugin is the right layer

The plugin can do things that external orchestration cannot do reliably.

### 1. Direct workspace and view control

The plugin can aggressively control:

- workspace splits and leaf creation
- which view type is active in each leaf
- which file is opened where
- preview vs source/editor state
- sidebar expansion/collapse
- tab groups, stacked tabs, popovers, search panes, graph view, backlinks, outgoing links, properties, outline, and other app surfaces

Quartz-side automation can request these states, but the plugin can create and verify them from inside the app lifecycle itself.

### 2. Access to internal Obsidian APIs

For this repository, using internal APIs is acceptable. That matters because accurate observation may require:

- direct workspace state inspection
- internal view refresh hooks
- forcing leaf realization or rerender
- probing view internals for readiness
- accessing private DOM containers or internal component trees

This repo does not need to preserve community-plugin portability if portability reduces extraction accuracy.

### 3. Ability to use invasive instrumentation

The plugin can install instrumentation that would be awkward or impossible from outside:

- MutationObserver and ResizeObserver probes on app-shell containers
- computed-style snapshots at chosen checkpoints
- CSSOM walks over loaded stylesheets
- selector match counting via `querySelectorAll`, `matches`, or targeted selector probes
- render stabilization loops based on internal signals instead of blind sleeps
- Electron/browser hooks if useful for stylesheet or frame inspection

### 4. Better distinction between “not matched” and “not observable yet”

External orchestration often collapses several failure modes into one:

- selector never matched
- view never rendered
- surface existed but was collapsed
- surface existed but virtualized
- selector matched but no sampled node was included
- setting changed but evidence was unchanged

The plugin can emit richer reasons because it can see workspace state, leaf state, DOM state, and internal readiness state together.

---

## Architectural options

The best end state is likely a hybrid design, but the tradeoffs are worth making explicit.

### Option A: Controlled fixture/view orchestration inside Obsidian

The plugin owns a deterministic “verification run” that:

- opens a known verification workspace
- creates specific leaves and views
- loads fixture notes and other targets
- toggles required sidebar/app-shell states
- waits for render stabilization
- performs per-setting observations in each mode

**Pros**

- closest to real Obsidian behavior
- best fit for preview/editor/app-shell selectors
- gives reliable provenance for where a selector was observed

**Cons**

- more harness logic
- still limited by what can be made to render in the real app
- requires careful stabilization logic to avoid flaky results

### Option B: Selector coverage / observability reporting

The plugin does not try to solve every materialization problem immediately. Instead, it focuses first on explaining observability:

- which candidate selectors were checked
- which selectors matched at least one node
- which selectors were never observed
- which surfaces were active when checks ran
- whether a selector was skipped as unsupported, unstable, or non-materialized

**Pros**

- fastest path to actionable insight
- immediately tells Quartz where undercoverage remains
- low-risk first phase

**Cons**

- improves diagnosis more than raw coverage
- does not by itself materialize more DOM

### Option C: Dedicated verification workspace / leaves

The plugin maintains a purpose-built internal workspace layout solely for extraction verification, with dedicated leaves for:

- reading view
- source/editor view
- properties/frontmatter
- backlinks/outgoing links/outline
- search or graph surfaces
- plugin or modal surfaces where relevant

This can be reset between runs for deterministic behavior.

**Pros**

- strong repeatability
- good foundation for broader app-shell coverage
- easier to attribute matches to known surfaces

**Cons**

- can diverge from casual user layouts
- more brittle against Obsidian internal layout changes

### Option D: Forced materialization, scrolling, and render stabilization

The plugin deliberately drives surfaces into observable states by:

- expanding collapsed containers
- switching hidden tabs into the foreground
- scrolling virtualized regions
- forcing refresh/reflow checkpoints
- waiting for DOM quiescence, image loads, markdown render completion, and internal view readiness

**Pros**

- directly attacks under-observation
- essential for long lists, virtual panes, and lazy UI

**Cons**

- high complexity
- easy to make flaky if stabilization rules are naive

### Option E: Synthetic DOM harnesses / dedicated verification containers

The plugin creates special containers whose only purpose is verifying selectors or CSS-variable effects. Examples:

- rendering curated HTML/Markdown fixtures into dedicated hidden or off-screen containers
- mounting verification-only markup for callouts, tables, embeds, headings, lists, properties, tabs, and plugin-like components
- applying mode and body-class state in a controlled sandbox

**Pros**

- can cover selectors that are hard to coerce in the real app
- deterministic and dense coverage
- useful for narrow selector families

**Cons**

- risk of diverging from real Obsidian DOM
- may prove a selector is theoretically matchable without proving it occurs naturally in app runtime

Synthetic harnesses should be treated as a supplement, not the canonical truth, unless clearly labeled as synthetic evidence.

### Option F: CSSOM and computed-style instrumentation

The plugin collects richer evidence by inspecting runtime styling directly:

- stylesheet inventory and ownership
- selector-text enumeration
- computed-style snapshots before and after setting changes
- matched-node counts for target selectors
- per-node before/after property diffs for a selected property subset

**Pros**

- richer evidence payloads
- helps distinguish “matched but unchanged” from “never matched”
- useful for verification and debugging

**Cons**

- can be expensive
- full CSSOM introspection may be noisy or restricted for some sheets
- needs careful normalization to stay useful downstream

### Option G: Internal Obsidian APIs and Electron/browser hooks

If needed, the plugin can reach deeper:

- internal view refresh or readiness hooks
- WebContents/browser-level inspection
- devtools protocol style/layout inspection
- lower-level stylesheet or frame hooks

**Pros**

- maximum control
- potential escape hatch for otherwise unobservable states

**Cons**

- highest brittleness
- most invasive implementation path
- should be reserved for concrete coverage gaps that cannot be solved more simply

### Recommended architectural stance

The best direction is a **hybrid**:

1. start with observability reporting and deterministic real-app orchestration
2. add forced materialization and stabilization
3. expand to dedicated verification workspace/app-shell coverage
4. emit richer selector-level evidence payloads for Quartz
5. use synthetic harnesses or deeper hooks only for stubborn coverage gaps

That preserves real-app fidelity while still allowing privileged fallbacks when accuracy demands them.

Concretely, the plugin should plug into Quartz's **existing** flow:

- Quartz continues to derive candidate observations from `style_settings.effects`
- Quartz continues to build selector-impact graphs and own the Obsidian→Quartz target mapping layer
- the plugin becomes the privileged executor and explainer for whether those candidate selectors actually materialized inside Obsidian

In other words, the plugin should initially improve the **execution and evidence** side of the pipeline, not replace Quartz's current planning and analysis model.

---

## Recommended staged plan

### Phase 1: Observability and coverage reporting

Primary goal: explain what the current run can and cannot observe.

Plugin responsibilities:

- accept a selector verification plan or selector candidate list from Quartz
- align with Quartz's existing observation-planning units rather than inventing a parallel schema if avoidable
- record active surfaces, leaves, view types, and mode during each observation window
- report selector outcomes with categories such as:
  - `matched`
  - `unobserved`
  - `matched-no-style-change`
  - `materialization-failed`
  - `skipped`
- report simple match counts where practical

Expected outcome:

- immediate visibility into whether the accuracy frontier is missing selectors or missing surfaces
- better prioritization for later harness work

### Phase 2: Deterministic fixture orchestration and render stabilization

Primary goal: make real-app observation reproducible and less under-observed.

Plugin responsibilities:

- create a deterministic verification workspace
- open a known set of fixture notes and auxiliary leaves
- reuse Quartz's existing fixture inventory and representative verification subset as the initial source of truth
- switch through required preview/editor/mode combinations
- add stabilization checkpoints for DOM quietness and view readiness
- optionally scroll/expand known lazy or virtualized regions

Expected outcome:

- fewer false “unobserved” results caused by timing or hidden-state issues
- stronger repeatability across runs

### Phase 3: Dedicated verification workspace and app-shell coverage

Primary goal: cover selectors outside a single note surface.

Plugin responsibilities:

- maintain a dedicated workspace topology for verification
- include app-shell surfaces such as sidebars, tabs, search, graph, outline, backlinks, properties, notices, modals, and other known selector targets
- attribute evidence to surface categories and concrete view types

Expected outcome:

- materially better coverage for selectors tied to Obsidian chrome and non-note UI

### Phase 4: Rich selector-level evidence payloads

Primary goal: give Quartz better raw evidence rather than only pass/fail signals.

Plugin responsibilities:

- emit per-selector or per-setting evidence records
- include matched-node counts, sampled node identifiers, and computed-style diffs
- distinguish:
  - observed and changed
  - observed and unchanged
  - unobserved
  - observed indirectly through transitive variable effects

Expected outcome:

- better downstream normalization
- easier conflict analysis
- stronger justification for retaining or discarding candidate impacts

### Optional future phase: Synthetic verification containers

Use only where real-app orchestration still leaves major gaps.

Good targets:

- hard-to-materialize but structurally simple selectors
- selectors for component subtrees that can be faithfully reproduced
- special verification of variable-driven style changes

Synthetic evidence should remain explicitly labeled so Quartz can weight it differently from real-app evidence.

### Optional future phase: Deeper engine hooks

Reserve for cases where even the dedicated workspace cannot expose enough information.

Potential uses:

- deeper stylesheet inspection
- devtools protocol snapshots
- lower-level frame/style instrumentation

This should be the last resort, not the first milestone.

---

## Repo boundary: what lives where

The split between repositories should stay sharp.

### `saberzero1/obsidian-style-settings`

Owns privileged runtime instrumentation and environment control:

- internal Obsidian workspace/view orchestration
- fixture realization inside the app
- render stabilization and forced materialization
- selector probing and match counting
- computed-style capture and before/after runtime measurements
- app-shell and verification-workspace management
- privileged evidence generation using internal APIs or Electron hooks
- any verification-only DOM containers or test surfaces

In short: this repo should produce the **raw runtime truth signals** that are easiest to capture from inside Obsidian.

### `saberzero1/quartz-themes`

Owns normalization, analysis, storage, and extraction orchestration:

- the current `justfile` task surface that runs extraction and verification
- the static `runner/scripts/config.js` mapping from Obsidian selectors/properties to Quartz targets
- static parsing and selector-impact analysis
- transitive variable tracing
- generation of verification plans and candidate selectors
- current Obsidian CLI process orchestration (`runner/scripts/cli-extractor.js`)
- ingestion of plugin-produced evidence payloads
- evidence sidecar normalization and persistence
- conflict analysis, confidence scoring, and extraction decisions
- reporting across themes, modes, fixtures, and runs

In short: Quartz should decide **what needs to be checked** and how to interpret the results, while the plugin should decide **how to observe it most accurately in Obsidian**.

### Near-term boundary recommendation

In the first harness milestone, `obsidian-style-settings` should **not** try to absorb:

- Quartz's static selector/property map
- Quartz's baseline diffing
- Quartz's report generation
- Quartz's theme-wide extraction scheduling

Instead, it should provide richer privileged evidence back into the same Quartz-side commands that already exist today.

---

## Evidence model ideas

The plugin should emit data rich enough for Quartz to distinguish different runtime realities without needing to re-open Obsidian.

### Minimum useful evidence fields

- theme identifier
- mode (`light` / `dark`)
- fixture identifier
- surface category
- view type / leaf identifier
- setting identifier
- selector
- observation outcome
- matched node count
- optional reference back to the Quartz planning unit (setting ID / payload ID / selector-impact key)

### High-value optional fields

- sampled matched node descriptors
  - tag name
  - stable class subset
  - data attributes if relevant
  - surface-local path or selector fingerprint
- before/after computed-style snapshots for selected properties
- list of properties changed
- unchanged-but-observed flag
- whether the selector was observed directly or via transitive variable reasoning
- workspace state metadata
  - active leaf
  - sidebar state
  - tab state
  - modal state
  - scroll/materialization checkpoints reached
- timing metadata
  - render wait durations
  - retry counts

### Outcome categories worth preserving

Quartz will be much more effective if the plugin distinguishes at least:

- **observed-changed**: selector matched and a relevant style difference appeared
- **observed-unchanged**: selector matched, but the tested setting value produced no meaningful difference
- **observed-no-sampled-diff**: selector matched, but the sampled property set did not capture the effect
- **unobserved**: selector did not match any node in the available surfaces
- **materialization-failed**: target surface could not be brought into a trustworthy rendered state
- **skipped**: selector intentionally not checked

That is much better than a binary “worked / failed” model.

---

## Risks and tradeoffs

### Internal API brittleness

This strategy explicitly accepts internal API usage, which means some harness code will be brittle across Obsidian releases.

Mitigation:

- isolate privileged adapters behind narrow interfaces
- record Obsidian version in evidence payloads
- prefer higher-level harness steps until a lower-level hook is truly needed

### Divergence from real DOM when synthetic harnesses are used

Synthetic containers can improve coverage, but they can also mislead.

Mitigation:

- keep synthetic evidence clearly labeled
- prefer real-app evidence when both exist
- use synthetic harnesses mainly for gap-filling and targeted verification

### Complexity versus accuracy

A fully invasive harness can become difficult to reason about.

Mitigation:

- ship in phases
- add observability first, then materialization logic
- keep evidence schemas explicit so harness complexity yields measurable value

### Performance and runtime cost

Per-setting, per-mode, per-surface verification can become expensive.

Mitigation:

- support selective plans instead of always verifying everything
- sample computed styles narrowly
- reuse stabilized surfaces where possible
- let Quartz request deeper evidence only for ambiguous settings/themes

### Fallback behavior for permanently unobservable selectors

Some selectors may remain unobservable even with a privileged harness.

Recommended fallback:

- preserve them as statically discovered candidates
- mark them with explicit runtime status rather than silently discarding them
- allow Quartz to assign lower confidence instead of forcing a binary reject

---

## Concrete recommendation

The first implementation milestone should be:

> **Build Phase 1 + the narrowest useful slice of Phase 2: a plugin-side selector observability report with deterministic verification workspace setup, basic fixture/view orchestration, and render stabilization checkpoints, but keep Quartz's existing planning (`style_settings.effects` → selector-impact graph → observation payloads) as the control plane.**

That is the highest-value next step because it answers the most important open questions quickly:

- Which selectors are currently going unobserved?
- Which misses are due to missing surfaces versus bad selector analysis?
- Which surfaces contribute the most new evidence?
- How much improvement comes from deterministic in-app orchestration alone before synthetic harnesses or deep hooks are considered?

---

## Actionable next steps

1. Define the smallest plugin-facing verification payload that can be derived from Quartz's **existing** plan model.
   - mode list
   - fixture list
   - selector candidates grouped by setting or selector-impact entry
   - requested surface categories
   - stable IDs that Quartz can round-trip into its current reports
2. Implement a deterministic verification workspace bootstrap inside `obsidian-style-settings`.
3. Mirror Quartz's current representative verification fixtures first, before expanding beyond them.
4. Add selector observability reporting with outcome categories, matched counts, and surface attribution.
5. Add basic render stabilization checkpoints before each observation pass, replacing Quartz-side blind readiness guesses with privileged in-app checks where possible.
6. Export the resulting raw evidence in a Quartz-ingestable JSON format designed to slot into the existing `verify-style-settings.mjs` / runtime-evidence sidecar workflow.
7. Run it first on a small set of high-value themes with known under-observation patterns.

If this milestone is successful, Phase 3 and Phase 4 can be prioritized using actual coverage data instead of speculation.
