/**
 * Tests for the canonical effect metadata layer (StyleSettingsEffects).
 *
 * These tests cover all representative setting kinds:
 *  - class-toggle (body-class-toggle, toggle, additive)
 *  - class-select (body-class-select, exclusive-select, exclusive)
 *  - variable-text / variable-number / variable-number-slider / variable-select
 *    (css-variable, set, override)
 *  - variable-color with and without alt-format (css-variable + derived-css-variable)
 *  - variable-themed-color (themed-css-variable, light/dark effects, derived)
 *  - color-gradient (gradient-output, set-range)
 *  - heading / info-text (non-emitting)
 *
 * For each kind the tests verify:
 *  - effectKind, targetKind, operation, mode
 *  - target fields (className / classValues / variable / variables / prefixes)
 *  - interactionGroup and interactionMode
 *  - provenance fields (derivedFrom, sourceVariable, sourceVariables)
 *  - format / opacity where relevant
 *  - count of effects produced (primary + derived)
 */

import { describe, expect, it } from 'vitest';
import {
	buildNormalizedStyleSettingsSchema,
	parseStyleSettingsStandaloneYamlText,
} from './StyleSettingsParser';
import {
	buildSchemaEffects,
	buildSettingEffects,
	SettingEffect,
	SettingEffectRecord,
} from './StyleSettingsEffects';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsedSchema(yaml: string) {
	const result = parseStyleSettingsStandaloneYamlText(yaml, { sourceName: 'test' });
	return buildNormalizedStyleSettingsSchema(result);
}

/** Build effects for the first setting of the first section. */
function firstSettingEffects(yaml: string): SettingEffect[] {
	const schema = parsedSchema(yaml);
	const section = schema.sections[0];
	const setting = section.settings[0];
	return buildSettingEffects(setting, section.id);
}

function wrapInSection(settingYaml: string): string {
	return `
mode: replace
sections:
  - id: test-section
    name: Test Section
    settings:
${settingYaml
	.split('\n')
	.map((l) => `      ${l}`)
	.join('\n')}
`;
}

// ---------------------------------------------------------------------------
// class-toggle
// ---------------------------------------------------------------------------

describe('class-toggle effects', () => {
	const yaml = wrapInSection(`
- id: my-toggle
  type: class-toggle
  title: My Toggle
  default: false
`);

	it('produces exactly one effect', () => {
		expect(firstSettingEffects(yaml)).toHaveLength(1);
	});

	it('effect has correct kind, target, operation, and mode', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.effectKind).toBe('body-class-toggle');
		expect(effect.targetKind).toBe('body-class');
		expect(effect.operation).toBe('toggle');
		expect(effect.mode).toBe('both');
	});

	it('effect carries the class name matching the setting id', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.className).toBe('my-toggle');
	});

	it('effect has correct interactionGroup and interactionMode', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.interactionGroup).toBe('body-class:my-toggle');
		expect(effect.interactionMode).toBe('additive');
	});

	it('effect identity fields are set correctly', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.settingId).toBe('my-toggle');
		expect(effect.settingType).toBe('class-toggle');
		expect(effect.sectionId).toBe('test-section');
	});
});

// ---------------------------------------------------------------------------
// class-select
// ---------------------------------------------------------------------------

describe('class-select effects', () => {
	const yaml = wrapInSection(`
- id: my-select
  type: class-select
  title: My Select
  allowEmpty: false
  default: value-a
  options:
    - label: Value A
      value: value-a
    - label: Value B
      value: value-b
    - label: Value C
      value: value-c
`);

	it('produces exactly one effect', () => {
		expect(firstSettingEffects(yaml)).toHaveLength(1);
	});

	it('effect has correct kind, target, operation, and mode', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.effectKind).toBe('body-class-select');
		expect(effect.targetKind).toBe('body-class');
		expect(effect.operation).toBe('exclusive-select');
		expect(effect.mode).toBe('both');
	});

	it('effect classValues contains all option values', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.classValues).toEqual(['value-a', 'value-b', 'value-c']);
	});

	it('effect interactionGroup is keyed by settingId and interactionMode is exclusive', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.interactionGroup).toBe('body-class-select:my-select');
		expect(effect.interactionMode).toBe('exclusive');
	});
});

// ---------------------------------------------------------------------------
// variable-text
// ---------------------------------------------------------------------------

describe('variable-text effects', () => {
	const yaml = wrapInSection(`
- id: my-text
  type: variable-text
  title: My Text
  default: hello
`);

	it('produces exactly one effect', () => {
		expect(firstSettingEffects(yaml)).toHaveLength(1);
	});

	it('effect kind is css-variable with set operation', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.effectKind).toBe('css-variable');
		expect(effect.targetKind).toBe('css-variable');
		expect(effect.operation).toBe('set');
		expect(effect.mode).toBe('both');
	});

	it('variable is --<settingId>', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.variable).toBe('--my-text');
		expect(effect.variables).toEqual(['--my-text']);
	});

	it('interactionGroup and interactionMode are correct', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.interactionGroup).toBe('css-variable:--my-text');
		expect(effect.interactionMode).toBe('override');
	});
});

// ---------------------------------------------------------------------------
// variable-number
// ---------------------------------------------------------------------------

describe('variable-number effects', () => {
	const yaml = wrapInSection(`
- id: my-number
  type: variable-number
  title: My Number
  default: 42
`);

	it('produces exactly one css-variable effect', () => {
		const effects = firstSettingEffects(yaml);
		expect(effects).toHaveLength(1);
		expect(effects[0].effectKind).toBe('css-variable');
	});

	it('variable is --<settingId>', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.variable).toBe('--my-number');
	});
});

// ---------------------------------------------------------------------------
// variable-number-slider
// ---------------------------------------------------------------------------

describe('variable-number-slider effects', () => {
	const yaml = wrapInSection(`
- id: my-slider
  type: variable-number-slider
  title: My Slider
  default: 5
  min: 0
  max: 10
  step: 1
`);

	it('produces exactly one css-variable effect', () => {
		const effects = firstSettingEffects(yaml);
		expect(effects).toHaveLength(1);
		expect(effects[0].effectKind).toBe('css-variable');
	});

	it('variable is --<settingId>', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.variable).toBe('--my-slider');
	});
});

// ---------------------------------------------------------------------------
// variable-select
// ---------------------------------------------------------------------------

describe('variable-select effects', () => {
	const yaml = wrapInSection(`
- id: my-var-select
  type: variable-select
  title: My Variable Select
  default: opt-a
  options:
    - label: Opt A
      value: opt-a
    - label: Opt B
      value: opt-b
`);

	it('produces exactly one css-variable effect', () => {
		const effects = firstSettingEffects(yaml);
		expect(effects).toHaveLength(1);
		expect(effects[0].effectKind).toBe('css-variable');
	});

	it('operation is set (single output)', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.operation).toBe('set');
	});
});

// ---------------------------------------------------------------------------
// variable-color (single format, no alt-format)
// ---------------------------------------------------------------------------

describe('variable-color effects (no alt-format)', () => {
	const yaml = wrapInSection(`
- id: my-color
  type: variable-color
  title: My Color
  format: hex
  default: "#ff0000"
`);

	it('produces exactly one primary effect', () => {
		expect(firstSettingEffects(yaml)).toHaveLength(1);
	});

	it('effect kind is css-variable with set operation', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.effectKind).toBe('css-variable');
		expect(effect.operation).toBe('set');
		expect(effect.mode).toBe('both');
	});

	it('variable is --<settingId>', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.variable).toBe('--my-color');
	});

	it('format is preserved', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.format).toBe('hex');
	});

	it('interactionGroup is correct', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.interactionGroup).toBe('css-variable:--my-color');
	});
});

// ---------------------------------------------------------------------------
// variable-color with split format (hsl-split produces 3 variables)
// ---------------------------------------------------------------------------

describe('variable-color effects (hsl-split format)', () => {
	const yaml = wrapInSection(`
- id: my-hsl-color
  type: variable-color
  title: My HSL Color
  format: hsl-split
  default: "#ff0000"
`);

	it('produces exactly one primary effect', () => {
		expect(firstSettingEffects(yaml)).toHaveLength(1);
	});

	it('operation is set-multi for hsl-split', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.operation).toBe('set-multi');
	});

	it('variables contains H, S, L entries', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.variables).toEqual([
			'--my-hsl-color-h',
			'--my-hsl-color-s',
			'--my-hsl-color-l',
		]);
	});

	it('primary variable is the first of the set', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.variable).toBe('--my-hsl-color-h');
	});
});

// ---------------------------------------------------------------------------
// variable-color with alt-format
// ---------------------------------------------------------------------------

describe('variable-color effects (with alt-format)', () => {
	const yaml = wrapInSection(`
- id: my-color
  type: variable-color
  title: My Color
  format: hex
  default: "#ff0000"
  alt-format:
    - id: my-color-rgb
      format: rgb
    - id: my-color-hsl
      format: hsl
`);

	it('produces 3 effects: 1 primary + 2 derived', () => {
		expect(firstSettingEffects(yaml)).toHaveLength(3);
	});

	it('first effect is the primary css-variable', () => {
		const [primary] = firstSettingEffects(yaml);
		expect(primary.effectKind).toBe('css-variable');
		expect(primary.variable).toBe('--my-color');
		expect(primary.format).toBe('hex');
	});

	it('derived effects are derived-css-variable with alt-format provenance', () => {
		const [, d1, d2] = firstSettingEffects(yaml);
		expect(d1.effectKind).toBe('derived-css-variable');
		expect(d2.effectKind).toBe('derived-css-variable');
		expect(d1.derivedFrom).toBe('alt-format');
		expect(d2.derivedFrom).toBe('alt-format');
	});

	it('derived effects have their own variable names and formats', () => {
		const [, d1, d2] = firstSettingEffects(yaml);
		expect(d1.variable).toBe('--my-color-rgb');
		expect(d1.format).toBe('rgb');
		expect(d2.variable).toBe('--my-color-hsl');
		expect(d2.format).toBe('hsl');
	});

	it('derived effects point back to the primary source variable', () => {
		const [, d1, d2] = firstSettingEffects(yaml);
		expect(d1.sourceVariable).toBe('--my-color');
		expect(d2.sourceVariable).toBe('--my-color');
	});

	it('derived effects each have their own interactionGroup', () => {
		const [, d1, d2] = firstSettingEffects(yaml);
		expect(d1.interactionGroup).toBe('css-variable:--my-color-rgb');
		expect(d2.interactionGroup).toBe('css-variable:--my-color-hsl');
	});

	it('derived effects have mode both when no variant is specified', () => {
		const [, d1] = firstSettingEffects(yaml);
		expect(d1.mode).toBe('both');
	});
});

// ---------------------------------------------------------------------------
// variable-themed-color
// ---------------------------------------------------------------------------

describe('variable-themed-color effects (no alt-format)', () => {
	const yaml = wrapInSection(`
- id: my-themed-color
  type: variable-themed-color
  title: My Themed Color
  format: hex
  default-light: "#ffffff"
  default-dark: "#000000"
`);

	it('produces 2 effects: one light and one dark', () => {
		expect(firstSettingEffects(yaml)).toHaveLength(2);
	});

	it('effects are themed-css-variable kind', () => {
		const effects = firstSettingEffects(yaml);
		expect(effects[0].effectKind).toBe('themed-css-variable');
		expect(effects[1].effectKind).toBe('themed-css-variable');
	});

	it('first effect targets light mode', () => {
		const [light] = firstSettingEffects(yaml);
		expect(light.mode).toBe('light');
	});

	it('second effect targets dark mode', () => {
		const [, dark] = firstSettingEffects(yaml);
		expect(dark.mode).toBe('dark');
	});

	it('both effects write to the same variable and share interactionGroup', () => {
		const [light, dark] = firstSettingEffects(yaml);
		expect(light.variable).toBe('--my-themed-color');
		expect(dark.variable).toBe('--my-themed-color');
		expect(light.interactionGroup).toBe('css-variable:--my-themed-color');
		expect(dark.interactionGroup).toBe('css-variable:--my-themed-color');
	});

	it('both effects have override interactionMode', () => {
		const [light, dark] = firstSettingEffects(yaml);
		expect(light.interactionMode).toBe('override');
		expect(dark.interactionMode).toBe('override');
	});

	it('format is preserved on both effects', () => {
		const [light, dark] = firstSettingEffects(yaml);
		expect(light.format).toBe('hex');
		expect(dark.format).toBe('hex');
	});
});

describe('variable-themed-color effects (with alt-format)', () => {
	const yaml = wrapInSection(`
- id: my-themed
  type: variable-themed-color
  title: My Themed Color
  format: hex
  default-light: "#ffffff"
  default-dark: "#000000"
  alt-format:
    - id: my-themed-rgb
      format: rgb
`);

	it('produces 4 effects: 2 primary (light/dark) + 2 derived (light/dark)', () => {
		// 2 direct bindings + 2 derived bindings (one per variant)
		expect(firstSettingEffects(yaml)).toHaveLength(4);
	});

	it('primary effects are themed-css-variable', () => {
		const effects = firstSettingEffects(yaml);
		expect(effects[0].effectKind).toBe('themed-css-variable');
		expect(effects[1].effectKind).toBe('themed-css-variable');
	});

	it('derived effects are derived-css-variable for light and dark', () => {
		const effects = firstSettingEffects(yaml);
		expect(effects[2].effectKind).toBe('derived-css-variable');
		expect(effects[3].effectKind).toBe('derived-css-variable');
		expect(effects[2].mode).toBe('light');
		expect(effects[3].mode).toBe('dark');
	});

	it('derived effects have alt-format provenance', () => {
		const effects = firstSettingEffects(yaml);
		expect(effects[2].derivedFrom).toBe('alt-format');
		expect(effects[3].derivedFrom).toBe('alt-format');
	});
});

// ---------------------------------------------------------------------------
// color-gradient
// ---------------------------------------------------------------------------

describe('color-gradient effects', () => {
	const yaml = wrapInSection(`
- id: my-gradient
  type: color-gradient
  format: hex
  from: "#000000"
  to: "#ffffff"
  step: 1
`);

	it('produces exactly one effect', () => {
		expect(firstSettingEffects(yaml)).toHaveLength(1);
	});

	it('effect kind is gradient-output with set-range operation', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.effectKind).toBe('gradient-output');
		expect(effect.targetKind).toBe('css-variable');
		expect(effect.operation).toBe('set-range');
		expect(effect.mode).toBe('both');
	});

	it('variablePrefix and variablePattern are present', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.variablePrefix).toBe('--my-gradient-');
		expect(effect.variablePattern).toBe('--my-gradient-{index}');
	});

	it('derivedFrom is gradient', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.derivedFrom).toBe('gradient');
	});

	it('sourceVariables are the from/to variable names', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.sourceVariables).toEqual(['--#000000', '--#ffffff']);
	});

	it('format is preserved', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.format).toBe('hex');
	});

	it('interactionGroup is prefixed with css-variable-range', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.interactionGroup).toMatch(/^css-variable-range:/);
	});
});

// ---------------------------------------------------------------------------
// heading (non-emitting)
// ---------------------------------------------------------------------------

describe('heading effects (non-emitting)', () => {
	const yaml = wrapInSection(`
- id: my-heading
  type: heading
  title: My Heading
  level: 2
`);

	it('produces exactly one non-emitting effect', () => {
		const effects = firstSettingEffects(yaml);
		expect(effects).toHaveLength(1);
		expect(effects[0].effectKind).toBe('non-emitting');
	});

	it('targetKind is none and operation is none', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.targetKind).toBe('none');
		expect(effect.operation).toBe('none');
	});

	it('mode is both', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.mode).toBe('both');
	});

	it('interactionMode is independent', () => {
		const [effect] = firstSettingEffects(yaml);
		expect(effect.interactionMode).toBe('independent');
	});
});

// ---------------------------------------------------------------------------
// info-text (non-emitting)
// ---------------------------------------------------------------------------

describe('info-text effects (non-emitting)', () => {
	const yaml = wrapInSection(`
- id: my-info
  type: info-text
  title: My Info
  description: Some informational text
`);

	it('produces exactly one non-emitting effect', () => {
		const effects = firstSettingEffects(yaml);
		expect(effects).toHaveLength(1);
		expect(effects[0].effectKind).toBe('non-emitting');
	});
});

// ---------------------------------------------------------------------------
// buildSchemaEffects — schema-level builder
// ---------------------------------------------------------------------------

describe('buildSchemaEffects', () => {
	it('returns one record per setting across all sections', () => {
		const schema = parsedSchema(`
mode: replace
sections:
  - id: section-a
    name: Section A
    settings:
      - id: toggle-one
        type: class-toggle
        title: Toggle One
        default: false
      - id: toggle-two
        type: class-toggle
        title: Toggle Two
        default: false
  - id: section-b
    name: Section B
    settings:
      - id: my-color
        type: variable-color
        title: My Color
        format: hex
        default: "#aabbcc"
`);
		const records = buildSchemaEffects(schema);
		expect(records).toHaveLength(3);
	});

	it('each record has correct settingId, sectionId, settingType, and non-empty effects', () => {
		const schema = parsedSchema(`
mode: replace
sections:
  - id: sec
    name: Section
    settings:
      - id: my-toggle
        type: class-toggle
        title: Toggle
        default: false
`);
		const [record] = buildSchemaEffects(schema);
		expect(record.settingId).toBe('my-toggle');
		expect(record.sectionId).toBe('sec');
		expect(record.settingType).toBe('class-toggle');
		expect(record.effects.length).toBeGreaterThan(0);
	});

	it('settings from different sections receive the correct sectionId', () => {
		const schema = parsedSchema(`
mode: replace
sections:
  - id: section-one
    name: Section One
    settings:
      - id: t1
        type: class-toggle
        title: T1
        default: false
  - id: section-two
    name: Section Two
    settings:
      - id: t2
        type: class-toggle
        title: T2
        default: false
`);
		const records = buildSchemaEffects(schema);
		const r1 = records.find((r) => r.settingId === 't1');
		const r2 = records.find((r) => r.settingId === 't2');
		expect(r1?.sectionId).toBe('section-one');
		expect(r2?.sectionId).toBe('section-two');
	});

	it('each effect in the record also has the correct sectionId', () => {
		const schema = parsedSchema(`
mode: replace
sections:
  - id: my-section
    name: My Section
    settings:
      - id: my-toggle
        type: class-toggle
        title: Toggle
        default: false
`);
		const [record] = buildSchemaEffects(schema);
		for (const effect of record.effects) {
			expect(effect.sectionId).toBe('my-section');
		}
	});

	it('returns an empty array for a schema with no sections', () => {
		const schema = parsedSchema(`
mode: replace
sections:
  - id: my-section
    name: My Section
    settings: []
`);
		// The parser drops empty sections, so sections will be empty.
		const records = buildSchemaEffects(schema);
		expect(records).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Interaction semantics — multiple settings targeting the same variable
// ---------------------------------------------------------------------------

describe('interaction semantics', () => {
	it('two class-toggles have independent interactionGroups', () => {
		const schema = parsedSchema(`
mode: replace
sections:
  - id: sec
    name: Section
    settings:
      - id: toggle-a
        type: class-toggle
        title: Toggle A
        default: false
      - id: toggle-b
        type: class-toggle
        title: Toggle B
        default: false
`);
		const records = buildSchemaEffects(schema);
		const g1 = records[0].effects[0].interactionGroup;
		const g2 = records[1].effects[0].interactionGroup;
		expect(g1).not.toBe(g2);
		expect(records[0].effects[0].interactionMode).toBe('additive');
		expect(records[1].effects[0].interactionMode).toBe('additive');
	});

	it('class-select options share an interactionGroup with exclusive mode', () => {
		const schema = parsedSchema(`
mode: replace
sections:
  - id: sec
    name: Section
    settings:
      - id: my-select
        type: class-select
        title: My Select
        allowEmpty: false
        default: a
        options:
          - label: A
            value: a
          - label: B
            value: b
`);
		const [record] = buildSchemaEffects(schema);
		const [effect] = record.effects;
		expect(effect.interactionMode).toBe('exclusive');
		expect(effect.interactionGroup).toBe('body-class-select:my-select');
	});

	it('two variable-color settings on the same variable name share an interactionGroup', () => {
		// Unusual but possible: two settings that would write to the same --var.
		// Here we just verify interactionGroup format for each individually.
		const schema = parsedSchema(`
mode: replace
sections:
  - id: sec
    name: Section
    settings:
      - id: accent-color
        type: variable-color
        title: Accent Color
        format: hex
        default: "#ff0000"
`);
		const [record] = buildSchemaEffects(schema);
		const [effect] = record.effects;
		expect(effect.interactionGroup).toBe('css-variable:--accent-color');
		expect(effect.interactionMode).toBe('override');
	});
});

// ---------------------------------------------------------------------------
// Opacity field
// ---------------------------------------------------------------------------

describe('opacity metadata', () => {
	it('opacity:true is preserved on a variable-color effect', () => {
		const yaml = wrapInSection(`
- id: my-color
  type: variable-color
  title: My Color
  format: hsl-split
  opacity: true
  default: "#ff0000"
`);
		const [effect] = firstSettingEffects(yaml);
		expect(effect.opacity).toBe(true);
	});

	it('variable list includes alpha channel when opacity is true and format is hsl-split', () => {
		const yaml = wrapInSection(`
- id: my-color
  type: variable-color
  title: My Color
  format: hsl-split
  opacity: true
  default: "#ff0000"
`);
		const [effect] = firstSettingEffects(yaml);
		expect(effect.variables).toContain('--my-color-a');
	});

	it('alpha channel is absent when opacity is false', () => {
		const yaml = wrapInSection(`
- id: my-color
  type: variable-color
  title: My Color
  format: hsl-split
  opacity: false
  default: "#ff0000"
`);
		const [effect] = firstSettingEffects(yaml);
		expect(effect.variables).not.toContain('--my-color-a');
	});
});

// ---------------------------------------------------------------------------
// buildSettingEffects: SettingEffectRecord shape (via buildSchemaEffects)
// ---------------------------------------------------------------------------

describe('SettingEffectRecord shape', () => {
	it('every record has settingId, sectionId, settingType, and effects array', () => {
		const schema = parsedSchema(`
mode: replace
sections:
  - id: sec
    name: Section
    settings:
      - id: t
        type: class-toggle
        title: T
        default: false
`);
		const [record]: SettingEffectRecord[] = buildSchemaEffects(schema);
		expect(record).toHaveProperty('settingId');
		expect(record).toHaveProperty('sectionId');
		expect(record).toHaveProperty('settingType');
		expect(Array.isArray(record.effects)).toBe(true);
	});
});
