/**
 * Canonical effect metadata model for Style Settings options.
 *
 * This module provides types and builder functions that describe the
 * runtime/style effects emitted by normalized Style Settings options.
 * Downstream consumers (e.g. Quartz Themes) can use this layer to build
 * accurate selector-impact mappings: option → effect → target (class/variable)
 * and to reason about how multiple options targeting the same selector interact.
 *
 * Design notes:
 * - Effects are derived from the canonical normalized binding metadata
 *   (NormalizedStyleSettingsBinding) rather than directly from raw YAML fields.
 * - The model focuses on emitted effect primitives and leaves full CSS
 *   cascade/selector analysis to a future layer.
 * - Non-emitting setting types (heading, info-text) produce a single
 *   non-emitting effect so every setting always has a defined effect record.
 */

import {
	NormalizedStyleSettings,
	NormalizedStyleSettingsBinding,
	NormalizedStyleSettingsSchema,
} from './StyleSettingsParser';

// ---------------------------------------------------------------------------
// Effect type literals
// ---------------------------------------------------------------------------

/**
 * The kind of style effect emitted by a setting, mirroring the binding kinds
 * established in NormalizedStyleSettingsBindingKind.
 */
export type SettingEffectKind =
	/** heading / info-text: no runtime style emission. */
	| 'non-emitting'
	/** class-toggle: adds or removes a single body element class. */
	| 'body-class-toggle'
	/** class-select: sets exactly one body class from a fixed option set. */
	| 'body-class-select'
	/** variable-text/number/select/color: writes one or more CSS custom properties. */
	| 'css-variable'
	/**
	 * variable-themed-color: writes CSS custom properties scoped to the
	 * light-mode or dark-mode selector.
	 */
	| 'themed-css-variable'
	/**
	 * Derived output from an alt-format specification on a color setting;
	 * produces additional CSS variables in a different color encoding.
	 */
	| 'derived-css-variable'
	/**
	 * color-gradient: emits a range of indexed CSS custom properties
	 * interpolated between two color sources.
	 */
	| 'gradient-output';

/**
 * The kind of DOM/CSS target written by the effect.
 */
export type SettingEffectTargetKind =
	/** A class token on the <body> element. */
	| 'body-class'
	/** A CSS custom property (--name). */
	| 'css-variable'
	/** No target; the setting produces no style emission. */
	| 'none';

/**
 * How the effect writes to its target.
 *
 * Downstream consumers use this to understand how a single setting
 * interacts with its target independently of other settings.
 */
export type SettingEffectOperation =
	/** Adds or removes a single class depending on the boolean value. */
	| 'toggle'
	/** Exactly one class from the option set is active at a time. */
	| 'exclusive-select'
	/** Sets a single CSS custom property to the configured value. */
	| 'set'
	/** Sets multiple CSS custom properties (e.g. split color formats). */
	| 'set-multi'
	/** Sets a range of indexed CSS custom properties (color-gradient). */
	| 'set-range'
	/** No write operation; non-emitting setting. */
	| 'none';

/**
 * When the effect applies — relevant for themed settings that produce
 * separate light-mode and dark-mode outputs.
 */
export type SettingEffectMode =
	/** Effect applies in both light and dark modes. */
	| 'both'
	/** Effect applies only in light mode. */
	| 'light'
	/** Effect applies only in dark mode. */
	| 'dark';

/**
 * How multiple effects that share an interactionGroup interact with each other.
 *
 * Downstream consumers use this to determine the combined behavior when
 * more than one setting targets the same class or CSS variable.
 */
export type SettingEffectInteractionMode =
	/**
	 * This effect does not interact with other effects from other settings
	 * on the same target (e.g. a toggle whose class is unique to that setting).
	 */
	| 'independent'
	/**
	 * Exactly one effect in the group is active at a time (e.g. the options
	 * of a class-select setting are mutually exclusive).
	 */
	| 'exclusive'
	/**
	 * Effects from different settings accumulate on the same target; each
	 * can be independently active (e.g. multiple toggles on different classes
	 * that a single CSS selector checks together).
	 */
	| 'additive'
	/**
	 * The last write wins if multiple settings emit to the same CSS variable.
	 * Downstreams should surface this as a potential conflict.
	 */
	| 'override';

// ---------------------------------------------------------------------------
// Core effect interface
// ---------------------------------------------------------------------------

/**
 * A single canonical effect emitted by a Style Settings option.
 *
 * Each setting produces one or more SettingEffect items — one per direct
 * binding plus one per derived binding (alt-format, gradient).
 *
 * For variable-themed-color settings, separate effects are emitted for the
 * light-mode and dark-mode bindings so downstream consumers can reason about
 * mode-scoped targets independently.
 */
export interface SettingEffect {
	// -------------------------------------------------------------------
	// Identity
	// -------------------------------------------------------------------

	/** ID of the setting this effect is derived from. */
	settingId: string;
	/** Type string of the setting (e.g. 'class-toggle', 'variable-color'). */
	settingType: string;
	/** ID of the section containing the setting. */
	sectionId: string;

	// -------------------------------------------------------------------
	// Effect classification
	// -------------------------------------------------------------------

	/** Kind of effect emitted by the setting. */
	effectKind: SettingEffectKind;
	/** Kind of DOM/CSS target written by the effect. */
	targetKind: SettingEffectTargetKind;
	/** How the effect writes to its target. */
	operation: SettingEffectOperation;
	/** When the effect applies (light-only, dark-only, or both). */
	mode: SettingEffectMode;

	// -------------------------------------------------------------------
	// Target details
	// -------------------------------------------------------------------

	/**
	 * For body-class-toggle: the class name added to or removed from
	 * the body element when the toggle is active.
	 */
	className?: string;

	/**
	 * For body-class-select: the full set of class values that this setting
	 * can write.  Exactly one is active at a time.
	 */
	classValues?: string[];

	/**
	 * The primary CSS custom property name (with leading '--') written by
	 * this effect.  Present for all css-variable, themed-css-variable,
	 * derived-css-variable, and gradient-output effects.
	 */
	variable?: string;

	/**
	 * All CSS custom property names written by this effect.  Equals
	 * [variable] for single-output settings; contains multiple entries for
	 * split formats (hsl-split, rgb-split) and multi-variable effects.
	 */
	variables?: string[];

	/**
	 * For gradient-output: the shared prefix of the indexed variable range
	 * (e.g. '--my-gradient-').
	 */
	variablePrefix?: string;

	/**
	 * For gradient-output: the naming pattern for individual range variables
	 * (e.g. '--my-gradient-{index}').
	 */
	variablePattern?: string;

	// -------------------------------------------------------------------
	// Interaction semantics
	// -------------------------------------------------------------------

	/**
	 * Identifies the logical target this effect writes to.  Effects from
	 * different settings that share an interactionGroup write to the same
	 * target and must be reasoned about together.
	 *
	 * Format by effectKind:
	 *   body-class-toggle    → 'body-class:<className>'
	 *   body-class-select    → 'body-class-select:<settingId>'
	 *   css-variable (all)   → 'css-variable:<primaryVariableName>'
	 *   gradient-output      → 'css-variable-range:<variablePrefix>'
	 *   non-emitting         → 'none:<settingId>'
	 */
	interactionGroup: string;

	/**
	 * How this effect interacts with other effects that share the same
	 * interactionGroup.
	 */
	interactionMode: SettingEffectInteractionMode;

	// -------------------------------------------------------------------
	// Provenance
	// -------------------------------------------------------------------

	/**
	 * Present on derived-css-variable effects to indicate the derivation
	 * mechanism, and on gradient-output effects.
	 */
	derivedFrom?: 'alt-format' | 'gradient';

	/**
	 * For derived-css-variable (alt-format): the primary CSS variable this
	 * effect is derived from.
	 */
	sourceVariable?: string;

	/**
	 * For gradient-output: the [from, to] source CSS variable names used to
	 * interpolate the gradient range.
	 */
	sourceVariables?: string[];

	// -------------------------------------------------------------------
	// Format / encoding metadata
	// -------------------------------------------------------------------

	/**
	 * Color format ('hex', 'hsl', 'rgb', etc.) or number unit suffix.
	 * Present when the binding carries format information.
	 */
	format?: string;

	/**
	 * Whether the opacity channel is included in the output.
	 * Present for color-related effects.
	 */
	opacity?: boolean;
}

// ---------------------------------------------------------------------------
// Per-setting effect record
// ---------------------------------------------------------------------------

/**
 * All canonical effects emitted by a single Style Settings option.
 *
 * Produced by buildSettingEffects() and grouped by buildSchemaEffects().
 */
export interface SettingEffectRecord {
	/** ID of the setting. */
	settingId: string;
	/** ID of the section containing the setting. */
	sectionId: string;
	/** Type string of the setting. */
	settingType: string;
	/**
	 * Ordered list of effects emitted by the setting.
	 *
	 * Ordering: direct binding effects come first (in bindings order),
	 * followed by derived binding effects (in derivedBindings order).
	 * Always contains at least one item (non-emitting for heading/info-text).
	 */
	effects: SettingEffect[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function variantToMode(variant: string): SettingEffectMode {
	if (variant === 'light') return 'light';
	if (variant === 'dark') return 'dark';
	return 'both';
}

function outputMode(variables: string[] | undefined): SettingEffectOperation {
	return variables && variables.length > 1 ? 'set-multi' : 'set';
}

function primaryVar(binding: NormalizedStyleSettingsBinding): string | undefined {
	return binding.variable ?? binding.variables?.[0];
}

function effectFromBinding(
	binding: NormalizedStyleSettingsBinding,
	settingId: string,
	sectionId: string,
	settingType: string
): SettingEffect {
	switch (binding.kind) {
		case 'non-emitting':
			return {
				settingId,
				settingType,
				sectionId,
				effectKind: 'non-emitting',
				targetKind: 'none',
				operation: 'none',
				mode: 'both',
				interactionGroup: `none:${settingId}`,
				interactionMode: 'independent',
			};

		case 'body-class-toggle':
			return {
				settingId,
				settingType,
				sectionId,
				effectKind: 'body-class-toggle',
				targetKind: 'body-class',
				operation: 'toggle',
				mode: 'both',
				className: binding.className,
				interactionGroup: `body-class:${binding.className}`,
				interactionMode: 'additive',
			};

		case 'body-class-select':
			return {
				settingId,
				settingType,
				sectionId,
				effectKind: 'body-class-select',
				targetKind: 'body-class',
				operation: 'exclusive-select',
				mode: 'both',
				classValues: binding.classValues,
				interactionGroup: `body-class-select:${settingId}`,
				interactionMode: 'exclusive',
			};

		case 'css-variable': {
			const pv = primaryVar(binding);
			return {
				settingId,
				settingType,
				sectionId,
				effectKind: 'css-variable',
				targetKind: 'css-variable',
				operation: outputMode(binding.variables),
				mode: 'both',
				variable: pv,
				variables: binding.variables,
				interactionGroup: `css-variable:${pv}`,
				interactionMode: 'override',
				format: binding.format,
				opacity: binding.opacity,
			};
		}

		case 'themed-css-variable': {
			const pv = primaryVar(binding);
			return {
				settingId,
				settingType,
				sectionId,
				effectKind: 'themed-css-variable',
				targetKind: 'css-variable',
				operation: outputMode(binding.variables),
				mode: variantToMode(binding.variant),
				variable: pv,
				variables: binding.variables,
				interactionGroup: `css-variable:${pv}`,
				interactionMode: 'override',
				format: binding.format,
				opacity: binding.opacity,
			};
		}

		case 'derived-css-variable': {
			const pv = primaryVar(binding);
			return {
				settingId,
				settingType,
				sectionId,
				effectKind: 'derived-css-variable',
				targetKind: 'css-variable',
				operation: outputMode(binding.variables),
				mode: variantToMode(binding.variant),
				variable: pv,
				variables: binding.variables,
				interactionGroup: `css-variable:${pv}`,
				interactionMode: 'override',
				derivedFrom: 'alt-format',
				sourceVariable: binding.sourceVariable,
				format: binding.format,
				opacity: binding.opacity,
			};
		}

		case 'gradient-output':
			return {
				settingId,
				settingType,
				sectionId,
				effectKind: 'gradient-output',
				targetKind: 'css-variable',
				operation: 'set-range',
				mode: 'both',
				variablePrefix: binding.variablePrefix,
				variablePattern: binding.variablePattern,
				interactionGroup: `css-variable-range:${binding.variablePrefix}`,
				interactionMode: 'override',
				derivedFrom: 'gradient',
				sourceVariables: binding.sourceVariables,
				format: binding.format,
			};

		default: {
			// Exhaustiveness guard — should never be reached with a valid binding kind.
			const kind = (binding as NormalizedStyleSettingsBinding).kind;
			return {
				settingId,
				settingType,
				sectionId,
				effectKind: 'non-emitting',
				targetKind: 'none',
				operation: 'none',
				mode: 'both',
				interactionGroup: `none:${settingId}`,
				interactionMode: 'independent',
				// Preserve the unknown kind for diagnostic use by callers.
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				...(kind !== undefined ? ({ _unknownKind: kind } as any) : {}),
			};
		}
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Derive canonical effect metadata for a single normalized setting.
 *
 * Returns one SettingEffect per direct binding plus one per derived binding.
 * The list always contains at least one element (a non-emitting effect for
 * settings like heading and info-text that produce no runtime style output).
 *
 * For variable-themed-color settings the list contains separate effects for
 * the light-mode and dark-mode bindings so that callers can independently
 * reason about mode-scoped selector impact.
 *
 * @param setting  - Normalized setting produced by buildNormalizedStyleSettingsSchema.
 * @param sectionId - ID of the section that contains the setting.
 */
export function buildSettingEffects(
	setting: NormalizedStyleSettings,
	sectionId: string
): SettingEffect[] {
	const effects: SettingEffect[] = [];

	for (const binding of setting.bindings) {
		effects.push(effectFromBinding(binding, setting.id, sectionId, setting.type));
	}

	for (const binding of setting.derivedBindings) {
		effects.push(effectFromBinding(binding, setting.id, sectionId, setting.type));
	}

	return effects;
}

/**
 * Derive canonical effect records for every setting in a normalized schema.
 *
 * Returns one SettingEffectRecord per setting in schema traversal order
 * (section order, then setting order within each section).
 *
 * This is the primary entry point for downstream consumers that need a
 * complete option → effect mapping for an entire theme's settings.
 *
 * @param schema - Normalized schema produced by buildNormalizedStyleSettingsSchema.
 */
export function buildSchemaEffects(
	schema: NormalizedStyleSettingsSchema
): SettingEffectRecord[] {
	const records: SettingEffectRecord[] = [];

	for (const section of schema.sections) {
		for (const setting of section.settings) {
			records.push({
				settingId: setting.id,
				sectionId: section.id,
				settingType: setting.type,
				effects: buildSettingEffects(setting, section.id),
			});
		}
	}

	return records;
}
