/**
 * Parser validation tests for standalone YAML schema-contract enforcement.
 *
 * These tests cover representative invalid and valid standalone YAML inputs,
 * with a focus on color-related settings where missing or unsupported `format`
 * values were identified as a primary source of downstream schema violations.
 */

import { describe, expect, it } from 'vitest';
import {
	ParsedStyleSettingsResult,
	parseStyleSettingsStandaloneYamlText,
	parseStyleSettingsStylesheetText,
} from './StyleSettingsParser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseStandalone(yaml: string) {
	return parseStyleSettingsStandaloneYamlText(yaml, { sourceName: 'test' });
}

function parseCss(yaml: string) {
	return parseStyleSettingsStylesheetText(
		`/* @settings\n${yaml}\n*/`,
		{ sourceName: 'test' }
	);
}

function errorCodes(result: ParsedStyleSettingsResult) {
	return result.diagnostics
		.filter((d) => d.severity === 'error')
		.map((d) => d.code);
}

function warningCodes(result: ParsedStyleSettingsResult) {
	return result.diagnostics
		.filter((d) => d.severity === 'warning')
		.map((d) => d.code);
}

/**
 * Re-indents a snippet so every line after the first gets `spaces` leading
 * spaces prepended — used to embed multi-line YAML fragments inside a larger
 * template literal that already has a fixed indent for the first line.
 */
function indent(snippet: string, spaces: number): string {
	const pad = ' '.repeat(spaces);
	return snippet.replace(/\n/g, `\n${pad}`);
}

// ---------------------------------------------------------------------------
// Standalone YAML document structure
// ---------------------------------------------------------------------------

describe('standalone YAML document structure', () => {
	it('produces YAML_PARSE_ERROR for malformed YAML', () => {
		const result = parseStandalone(': invalid: yaml: [unclosed');
		expect(errorCodes(result)).toContain('YAML_PARSE_ERROR');
		expect(result.sections).toHaveLength(0);
	});

	it('produces INVALID_STANDALONE_YAML_DOCUMENT when document has no sections', () => {
		const result = parseStandalone('mode: replace\n');
		expect(errorCodes(result)).toContain('INVALID_STANDALONE_YAML_DOCUMENT');
		expect(result.sections).toHaveLength(0);
	});

	it('produces INVALID_SIDECAR_MODE when mode is unrecognised', () => {
		const result = parseStandalone(`
mode: invalid-mode
sections:
  - id: my-section
    name: My Section
    settings: []
`);
		expect(errorCodes(result)).toContain('INVALID_SIDECAR_MODE');
	});

	it('accepts a valid replace-mode document with sections array', () => {
		const result = parseStandalone(`
mode: replace
sections:
  - id: my-section
    name: My Section
    settings:
      - id: my-toggle
        type: class-toggle
        title: My Toggle
        default: false
`);
		expect(errorCodes(result)).toHaveLength(0);
		expect(result.sections).toHaveLength(1);
		expect(result.sections[0].id).toBe('my-section');
	});

	it('accepts a single-section top-level document without a sections key', () => {
		const result = parseStandalone(`
id: my-section
name: My Section
settings:
  - id: my-toggle
    type: class-toggle
    title: My Toggle
    default: false
`);
		expect(errorCodes(result)).toHaveLength(0);
		expect(result.sections).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// variable-color: format validation
// ---------------------------------------------------------------------------

describe('variable-color format validation', () => {
	const sectionPrefix = `
mode: replace
sections:
  - id: colors
    name: Colors
    settings:
`;

	function makeColorSetting(extra: string) {
		return parseStandalone(
			sectionPrefix +
				`      - id: my-color\n        type: variable-color\n        title: My Color\n        ${indent(extra, 8)}`
		);
	}

	it('produces MISSING_COLOR_FORMAT when format is absent', () => {
		const result = makeColorSetting('default: "#ff0000"');
		expect(warningCodes(result)).toContain('MISSING_COLOR_FORMAT');
		expect(result.sections).toHaveLength(1);
	});

	it('produces UNSUPPORTED_COLOR_FORMAT when format value is not in the supported set', () => {
		const result = makeColorSetting('format: oklch\ndefault: "#ff0000"');
		expect(warningCodes(result)).toContain('UNSUPPORTED_COLOR_FORMAT');
		expect(result.sections).toHaveLength(1);
	});

	it('MISSING_COLOR_FORMAT message includes the list of supported formats', () => {
		const result = makeColorSetting('default: "#ff0000"');
		const diag = result.diagnostics.find((d) => d.code === 'MISSING_COLOR_FORMAT');
		expect(diag?.message).toMatch(/hex/);
		expect(diag?.message).toMatch(/hsl/);
		expect(diag?.message).toMatch(/rgb/);
	});

	it('UNSUPPORTED_COLOR_FORMAT message includes the received value and supported formats', () => {
		const result = makeColorSetting('format: oklch\ndefault: "#ff0000"');
		const diag = result.diagnostics.find((d) => d.code === 'UNSUPPORTED_COLOR_FORMAT');
		expect(diag?.message).toMatch(/oklch/);
		expect(diag?.message).toMatch(/hex/);
	});

	it('produces INVALID_DEFAULT when default is not a CSS color string', () => {
		const result = makeColorSetting('format: hex\ndefault: "not-a-color"');
		expect(warningCodes(result)).toContain('INVALID_DEFAULT');
	});

	it.each([
		['hex', '#ff0000'],
		['hsl', 'hsl(0, 100%, 50%)'],
		['hsl-split', '#ff0000'],
		['hsl-split-decimal', '#ff0000'],
		['hsl-values', '#ff0000'],
		['rgb', '#ff0000'],
		['rgb-split', '#ff0000'],
		['rgb-values', '#ff0000'],
	])('accepts format "%s" as valid', (fmt, dflt) => {
		const result = makeColorSetting(`format: ${fmt}\ndefault: "${dflt}"`);
		expect(errorCodes(result)).toHaveLength(0);
		expect(result.sections).toHaveLength(1);
	});

	it('setting without default is valid when format is present', () => {
		const result = makeColorSetting('format: hex');
		expect(errorCodes(result)).toHaveLength(0);
		expect(result.sections).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// variable-themed-color: format and default-light/dark validation
// ---------------------------------------------------------------------------

describe('variable-themed-color field validation', () => {
	const sectionPrefix = `
mode: replace
sections:
  - id: colors
    name: Colors
    settings:
`;

	function makeThemedColorSetting(extra: string) {
		return parseStandalone(
			sectionPrefix +
				`      - id: my-themed-color\n        type: variable-themed-color\n        title: My Themed Color\n        ${indent(extra, 8)}`
		);
	}

	it('produces MISSING_COLOR_FORMAT when format is absent', () => {
		const result = makeThemedColorSetting(
			'default-light: "#ffffff"\ndefault-dark: "#000000"'
		);
		expect(warningCodes(result)).toContain('MISSING_COLOR_FORMAT');
	});

	it('produces UNSUPPORTED_COLOR_FORMAT when format is unrecognised', () => {
		const result = makeThemedColorSetting(
			'format: oklch\ndefault-light: "#ffffff"\ndefault-dark: "#000000"'
		);
		expect(warningCodes(result)).toContain('UNSUPPORTED_COLOR_FORMAT');
	});

	it('produces MISSING_THEMED_COLOR_FIELDS when default-light is absent', () => {
		const result = makeThemedColorSetting(
			'format: hex\ndefault-dark: "#000000"'
		);
		expect(warningCodes(result)).toContain('MISSING_THEMED_COLOR_FIELDS');
		const diag = result.diagnostics.find(
			(d) => d.code === 'MISSING_THEMED_COLOR_FIELDS'
		);
		expect(diag?.message).toMatch(/default-light/);
	});

	it('produces MISSING_THEMED_COLOR_FIELDS when default-dark is absent', () => {
		const result = makeThemedColorSetting(
			'format: hex\ndefault-light: "#ffffff"'
		);
		expect(warningCodes(result)).toContain('MISSING_THEMED_COLOR_FIELDS');
		const diag = result.diagnostics.find(
			(d) => d.code === 'MISSING_THEMED_COLOR_FIELDS'
		);
		expect(diag?.message).toMatch(/default-dark/);
	});

	it('produces INVALID_DEFAULT when default-light is not a valid CSS color', () => {
		const result = makeThemedColorSetting(
			'format: hex\ndefault-light: "notacolor"\ndefault-dark: "#000000"'
		);
		expect(warningCodes(result)).toContain('INVALID_DEFAULT');
	});

	it('produces INVALID_DEFAULT when default-dark is not a valid CSS color', () => {
		const result = makeThemedColorSetting(
			'format: hex\ndefault-light: "#ffffff"\ndefault-dark: "notacolor"'
		);
		expect(warningCodes(result)).toContain('INVALID_DEFAULT');
	});

	it('accepts a fully valid variable-themed-color setting', () => {
		const result = makeThemedColorSetting(
			'format: hex\ndefault-light: "#ffffff"\ndefault-dark: "#000000"'
		);
		expect(errorCodes(result)).toHaveLength(0);
		expect(result.sections).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// color-gradient: field validation
// ---------------------------------------------------------------------------

describe('color-gradient field validation', () => {
	const sectionPrefix = `
mode: replace
sections:
  - id: gradients
    name: Gradients
    settings:
`;

	function makeGradientSetting(extra: string) {
		return parseStandalone(
			sectionPrefix +
				`      - id: my-gradient\n        type: color-gradient\n        title: My Gradient\n        ${indent(extra, 8)}`
		);
	}

	it('produces MISSING_GRADIENT_FIELDS when "from" is absent', () => {
		const result = makeGradientSetting(
			'to: "#ffffff"\nformat: hex\nstep: 1'
		);
		expect(warningCodes(result)).toContain('MISSING_GRADIENT_FIELDS');
		const diag = result.diagnostics.find(
			(d) => d.code === 'MISSING_GRADIENT_FIELDS'
		);
		expect(diag?.message).toMatch(/"from"/);
	});

	it('produces MISSING_GRADIENT_FIELDS when "to" is absent', () => {
		const result = makeGradientSetting(
			'from: "#000000"\nformat: hex\nstep: 1'
		);
		expect(warningCodes(result)).toContain('MISSING_GRADIENT_FIELDS');
		const diag = result.diagnostics.find(
			(d) => d.code === 'MISSING_GRADIENT_FIELDS'
		);
		expect(diag?.message).toMatch(/"to"/);
	});

	it('produces MISSING_GRADIENT_FIELDS when "format" is absent', () => {
		const result = makeGradientSetting(
			'from: "#000000"\nto: "#ffffff"\nstep: 1'
		);
		expect(warningCodes(result)).toContain('MISSING_GRADIENT_FIELDS');
		const diag = result.diagnostics.find(
			(d) => d.code === 'MISSING_GRADIENT_FIELDS'
		);
		expect(diag?.message).toMatch(/"format"/);
	});

	it('produces UNSUPPORTED_GRADIENT_FORMAT when format is not in the supported set', () => {
		const result = makeGradientSetting(
			'from: "#000000"\nto: "#ffffff"\nformat: hsl-split\nstep: 1'
		);
		expect(warningCodes(result)).toContain('UNSUPPORTED_GRADIENT_FORMAT');
		const diag = result.diagnostics.find(
			(d) => d.code === 'UNSUPPORTED_GRADIENT_FORMAT'
		);
		expect(diag?.message).toMatch(/hsl-split/);
		expect(diag?.message).toMatch(/hex/);
	});

	it('produces MISSING_GRADIENT_FIELDS when "step" is absent', () => {
		const result = makeGradientSetting(
			'from: "#000000"\nto: "#ffffff"\nformat: hex'
		);
		expect(warningCodes(result)).toContain('MISSING_GRADIENT_FIELDS');
		const diag = result.diagnostics.find(
			(d) => d.code === 'MISSING_GRADIENT_FIELDS'
		);
		expect(diag?.message).toMatch(/"step"/);
	});

	it('produces INVALID_GRADIENT_STEP when step is <= 0', () => {
		const result = makeGradientSetting(
			'from: "#000000"\nto: "#ffffff"\nformat: hex\nstep: 0'
		);
		expect(warningCodes(result)).toContain('INVALID_GRADIENT_STEP');
	});

	it('accepts a fully valid color-gradient setting', () => {
		const result = makeGradientSetting(
			'from: "#000000"\nto: "#ffffff"\nformat: hex\nstep: 1'
		);
		expect(errorCodes(result)).toHaveLength(0);
		expect(result.sections).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// alt-format validation
// ---------------------------------------------------------------------------

describe('alt-format validation', () => {
	const sectionPrefix = `
mode: replace
sections:
  - id: colors
    name: Colors
    settings:
`;

	it('produces INVALID_ALT_FORMAT when a format value is unsupported', () => {
		const result = parseStandalone(
			sectionPrefix +
				`      - id: my-color
        type: variable-color
        title: My Color
        format: hex
        default: "#ff0000"
        alt-format:
          - id: my-color-rgb
            format: oklch`
		);
		expect(errorCodes(result)).toContain('INVALID_ALT_FORMAT');
		const diag = result.diagnostics.find((d) => d.code === 'INVALID_ALT_FORMAT');
		expect(diag?.message).toMatch(/oklch/);
		expect(diag?.message).toMatch(/hex/);
	});

	it('produces INVALID_ALT_FORMAT when id is missing from an entry', () => {
		const result = parseStandalone(
			sectionPrefix +
				`      - id: my-color
        type: variable-color
        title: My Color
        format: hex
        default: "#ff0000"
        alt-format:
          - format: rgb`
		);
		expect(errorCodes(result)).toContain('INVALID_ALT_FORMAT');
	});

	it('accepts valid alt-format entries', () => {
		const result = parseStandalone(
			sectionPrefix +
				`      - id: my-color
        type: variable-color
        title: My Color
        format: hex
        default: "#ff0000"
        alt-format:
          - id: my-color-rgb
            format: rgb
          - id: my-color-hsl
            format: hsl`
		);
		expect(errorCodes(result)).toHaveLength(0);
		expect(result.sections).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Duplicate ID detection
// ---------------------------------------------------------------------------

describe('duplicate ID detection', () => {
	it('produces DUPLICATE_SETTING_ID for duplicate setting ids in the same section', () => {
		const result = parseStandalone(`
mode: replace
sections:
  - id: my-section
    name: My Section
    settings:
      - id: dupe-setting
        type: class-toggle
        title: Toggle A
        default: false
      - id: dupe-setting
        type: class-toggle
        title: Toggle B
        default: true
`);
		expect(errorCodes(result)).toContain('DUPLICATE_SETTING_ID');
		// Only the first valid setting survives
		expect(result.sections[0].settings).toHaveLength(1);
	});

	it('produces DUPLICATE_SECTION_ID for duplicate section ids', () => {
		const result = parseStandalone(`
mode: replace
sections:
  - id: shared-id
    name: Section A
    settings:
      - id: setting-a
        type: class-toggle
        title: Toggle
        default: false
  - id: shared-id
    name: Section B
    settings:
      - id: setting-b
        type: class-toggle
        title: Toggle
        default: false
`);
		expect(errorCodes(result)).toContain('DUPLICATE_SECTION_ID');
		// Only the first section survives
		expect(result.sections).toHaveLength(1);
		expect(result.sections[0].name).toBe('Section A');
	});
});

// ---------------------------------------------------------------------------
// CSS stylesheet parsing
// ---------------------------------------------------------------------------

describe('CSS @settings block parsing', () => {
	it('produces MISSING_COLOR_FORMAT for variable-color without format in CSS block', () => {
		const result = parseCss(`
name: My Theme
id: my-theme
settings:
  - id: my-color
    type: variable-color
    title: My Color
    default: "#ff0000"
`);
		expect(warningCodes(result)).toContain('MISSING_COLOR_FORMAT');
		expect(result.sections).toHaveLength(1);
	});

	it('parses a valid CSS @settings block with variable-color successfully', () => {
		const result = parseCss(`
name: My Theme
id: my-theme
settings:
  - id: my-color
    type: variable-color
    title: My Color
    format: hex
    default: "#ff0000"
`);
		expect(errorCodes(result)).toHaveLength(0);
		expect(result.sections).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// Section-level required fields
// ---------------------------------------------------------------------------

describe('section required field validation', () => {
	it('produces INVALID_SECTION when section is missing name', () => {
		const result = parseStandalone(`
mode: replace
sections:
  - id: my-section
    settings:
      - id: my-toggle
        type: class-toggle
        title: Toggle
        default: false
`);
		expect(errorCodes(result)).toContain('INVALID_SECTION');
	});

	it('produces INVALID_SECTION when section is missing id', () => {
		const result = parseStandalone(`
mode: replace
sections:
  - name: My Section
    settings:
      - id: my-toggle
        type: class-toggle
        title: Toggle
        default: false
`);
		expect(errorCodes(result)).toContain('INVALID_SECTION');
	});

	it('still produces section when settings have recoverable warnings', () => {
		const result = parseStandalone(`
mode: replace
sections:
  - id: my-section
    name: My Section
    settings:
      - id: bad-color
        type: variable-color
        title: Bad Color
        default: "#ff0000"
`);
		// The missing format is now a warning; the setting is still produced with a fallback.
		expect(warningCodes(result)).toContain('MISSING_COLOR_FORMAT');
		expect(result.sections).toHaveLength(1);
	});
});
