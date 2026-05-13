import {
	AltFormatList,
	ClassMultiToggle,
	ClassToggle,
	CSSSetting,
	ColorGradient,
	Heading,
	InfoText,
	ParsedCSSSettings,
	SelectOption,
	StyleSettingsDiagnostic,
	StyleSettingsSettingSourceMetadata,
	StyleSettingsSourceMetadata,
	VariableColor,
	VariableNumber,
	VariableNumberSlider,
	VariableSelect,
	VariableText,
	VariableThemedColor,
} from './SettingHandlers';
import { isValidDefaultColor, nameRegExp, settingRegExp } from './StyleSettingsShared';
import { SettingType } from './settingsView/SettingComponents/types';
import detectIndent from 'detect-indent';
import yaml from 'js-yaml';

type DiagnosticContext = {
	severity: 'error' | 'warning';
	code: string;
	message: string;
	source?: StyleSettingsSourceMetadata;
	sectionId?: string;
	settingId?: string;
	path?: string;
};

type PrimitiveDefault = boolean | number | string;

type StandaloneYamlSourceExtractionResult = {
	mode: StyleSettingsSidecarMode;
	sources: StyleSettingsSourceMetadata[];
	sectionModesBySourceId: Record<string, StyleSettingsSidecarMode>;
	ignoredSectionSourceIds: Record<string, true>;
	ignoredSettingIdsBySourceId: Record<string, Record<string, true>>;
	diagnostics: StyleSettingsDiagnostic[];
};

export interface ParsedStyleSettingsResult {
	sections: ParsedCSSSettings[];
	diagnostics: StyleSettingsDiagnostic[];
}

export interface ParseStyleSettingsOptions {
	sourceName: string;
	stylesheetHref?: string;
}

export type StyleSettingsSidecarMode = 'replace' | 'override';

export interface ParseStyleSettingsSidecarOptions extends ParseStyleSettingsOptions {
	defaultMode?: StyleSettingsSidecarMode;
}

export interface ParsedStyleSettingsWithSidecarResult extends ParsedStyleSettingsResult {
	sidecarMode: StyleSettingsSidecarMode;
}

export interface NormalizedStyleSettingsSchema {
	version: 2;
	generatedAt: string;
	sections: NormalizedStyleSettingsSection[];
	diagnostics: StyleSettingsDiagnostic[];
}

export interface NormalizedStyleSettingsSection {
	id: string;
	name: string;
	collapsed: boolean;
	source?: StyleSettingsSourceMetadata;
	settings: NormalizedStyleSettings[];
}

export interface NormalizedStyleSettings {
	id: string;
	title?: string;
	description?: string;
	type: string;
	default?: PrimitiveDefault;
	defaults?: Record<string, PrimitiveDefault>;
	options?: SelectOption[];
	constraints?: Record<string, PrimitiveDefault | AltFormatList>;
	// Primary binding kept as a single deterministic summary for simple consumers.
	binding: NormalizedStyleSettingsBinding;
	// Direct runtime bindings this setting controls (may include themed variants).
	bindings: NormalizedStyleSettingsBinding[];
	// Outputs derived from direct bindings (e.g., alt color formats, gradient outputs).
	derivedBindings: NormalizedStyleSettingsBinding[];
	source?: StyleSettingsSettingSourceMetadata;
}

export type NormalizedStyleSettingsBindingVariant = 'base' | 'light' | 'dark';

export type NormalizedStyleSettingsBindingKind =
	| 'non-emitting'
	| 'body-class-toggle'
	| 'body-class-select'
	| 'css-variable'
	| 'themed-css-variable'
	| 'derived-css-variable'
	| 'gradient-output';

export interface NormalizedStyleSettingsBinding {
	kind: NormalizedStyleSettingsBindingKind;
	target: 'none' | 'body-class' | 'css-variable';
	variant: NormalizedStyleSettingsBindingVariant;
	outputMode: 'single' | 'multi' | 'range' | 'none';
	variable?: string;
	variables?: string[];
	variablePrefix?: string;
	variablePattern?: string;
	className?: string;
	classValues?: string[];
	settingType?: string;
	reason?: string;
	format?: string;
	opacity?: boolean;
	quotes?: boolean;
	allowEmpty?: boolean;
	selectors?: Record<'light' | 'dark', string>;
	derivedFrom?: 'alt-format' | 'gradient';
	sourceVariable?: string;
	sourceVariables?: string[];
	step?: number;
	pad?: number;
}

const colorFormats = new Set([
	'hex',
	'hsl',
	'hsl-split',
	'hsl-split-decimal',
	'hsl-values',
	'rgb',
	'rgb-split',
	'rgb-values',
]);

const COLOR_FORMATS_LIST = 'hex | hsl | hsl-split | hsl-split-decimal | hsl-values | rgb | rgb-split | rgb-values';

const gradientFormats = new Set(['hex', 'hsl', 'rgb']);

const GRADIENT_FORMATS_LIST = 'hex | hsl | rgb';

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function locationLabel(
	source?: StyleSettingsSourceMetadata,
	path?: string
): string | undefined {
	if (!source) return path;
	const lineRangeLabel = `${source.sourceName}:${source.lineStart}-${source.lineEnd}`;
	return path ? `${lineRangeLabel} ${path}` : lineRangeLabel;
}

function createDiagnostic(context: DiagnosticContext): StyleSettingsDiagnostic {
	const {
		code,
		message,
		path,
		sectionId,
		settingId,
		severity,
		source,
	} = context;
	const target = [source?.sourceName, sectionId, settingId].filter(Boolean).join(' › ');
	const location = locationLabel(source, path);

	return {
		severity,
		code,
		message,
		name: target || 'Style Settings',
		error: `[${code}] ${message}${location ? ` (${location})` : ''}`,
		path,
		sectionId,
		settingId,
		source,
	};
}

function getSourceLine(text: string, index: number): number {
	return text.slice(0, index).split(/\r\n|\r|\n/).length;
}

function countLines(text: string): number {
	let lines = 1;
	for (let index = 0; index < text.length; index += 1) {
		const code = text.charCodeAt(index);
		if (code === 10) {
			lines += 1;
		} else if (code === 13) {
			lines += 1;
			if (text.charCodeAt(index + 1) === 10) index += 1;
		}
	}
	return lines;
}

function getString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value : undefined;
}

function getNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getBoolean(value: unknown): boolean | undefined {
	return typeof value === 'boolean' ? value : undefined;
}

function getBlockFallbackName(source: StyleSettingsSourceMetadata): string {
	const nameMatch = source.rawYaml.match(nameRegExp);
	return nameMatch?.[1]?.trim() || source.sourceName;
}

export function extractStyleSettingsSourcesFromCssText(
	text: string,
	options: ParseStyleSettingsOptions
): StyleSettingsSourceMetadata[] {
	settingRegExp.lastIndex = 0;
	const blocks: StyleSettingsSourceMetadata[] = [];
	let blockIndex = 0;
	let match: RegExpExecArray | null = settingRegExp.exec(text);

	while (match) {
		const rawComment = match[0];
		const rawYaml = match[1].trim();
		const lineStart = getSourceLine(text, match.index);
		const lineEnd = lineStart + rawComment.split(/\r\n|\r|\n/).length - 1;
		blocks.push({
			sourceKind: 'embedded-css',
			sourceName: options.sourceName,
			sourceId: `${options.sourceName}#settings-block-${blockIndex + 1}`,
			blockIndex,
			lineStart,
			lineEnd,
			rawYaml,
			rawComment,
			stylesheetHref: options.stylesheetHref,
		});
		blockIndex += 1;
		match = settingRegExp.exec(text);
	}

	return blocks;
}

function buildStandaloneYamlSource(
	rawYaml: string,
	options: ParseStyleSettingsOptions,
	blockIndex: number,
	sourceKind: StyleSettingsSourceMetadata['sourceKind'] = 'standalone-yaml'
): StyleSettingsSourceMetadata {
	const lineCount = countLines(rawYaml);
	return {
		sourceKind,
		sourceName: options.sourceName,
		sourceId: `${options.sourceName}#standalone-yaml-${blockIndex + 1}`,
		blockIndex,
		lineStart: 1,
		lineEnd: lineCount,
		rawYaml,
		rawComment: rawYaml,
		stylesheetHref: options.stylesheetHref,
	};
}

function getStandaloneYamlSectionEntries(parsed: unknown): unknown[] {
	if (Array.isArray(parsed)) return parsed;
	if (!isRecord(parsed)) return [];
	if (Array.isArray(parsed.sections)) return parsed.sections;
	if (Array.isArray(parsed.settings) && getString(parsed.id) && getString(parsed.name)) {
		return [parsed];
	}
	return [];
}

export function extractStyleSettingsSourcesFromStandaloneYamlText(
	text: string,
	options: ParseStyleSettingsSidecarOptions
): StandaloneYamlSourceExtractionResult {
	const modeSource = buildStandaloneYamlSource(text, options, 0);
	const diagnostics: StyleSettingsDiagnostic[] = [];
	let mode: StyleSettingsSidecarMode = options.defaultMode || 'replace';
	let parsed: unknown;

	try {
		parsed = yaml.load(normalizeYaml(text), {
			filename: `${options.sourceName}#standalone-yaml`,
			schema: yaml.DEFAULT_SCHEMA,
		});
	} catch (error) {
		return {
			mode,
			sources: [],
			sectionModesBySourceId: {},
			ignoredSectionSourceIds: {},
			ignoredSettingIdsBySourceId: {},
			diagnostics: [
				createDiagnostic({
					severity: 'error',
					code: 'YAML_PARSE_ERROR',
					message: `${error}`,
					source: modeSource,
					sectionId: options.sourceName,
				}),
			],
		};
	}

	if (isRecord(parsed) && parsed.mode !== undefined) {
		const parsedMode = getString(parsed.mode);
		if (parsedMode === 'replace' || parsedMode === 'override') {
			mode = parsedMode;
		} else {
			diagnostics.push(
				createDiagnostic({
					severity: 'error',
					code: 'INVALID_SIDECAR_MODE',
					message:
						'Sidecar YAML mode must be either "replace" or "override". Falling back to default mode.',
					source: modeSource,
				})
			);
		}
	}

	const sectionEntries = getStandaloneYamlSectionEntries(parsed);
	if (!sectionEntries.length) {
		return {
			mode,
			sources: [],
			sectionModesBySourceId: {},
			ignoredSectionSourceIds: {},
			ignoredSettingIdsBySourceId: {},
			diagnostics: diagnostics.concat(
				createDiagnostic({
					severity: 'error',
					code: 'INVALID_STANDALONE_YAML_DOCUMENT',
					message:
						'Standalone YAML must define either a top-level sections array or a single section object with name/id/settings.',
					source: modeSource,
				})
			),
		};
	}

	const sectionModesBySourceId: Record<string, StyleSettingsSidecarMode> = {};
	const ignoredSectionSourceIds: Record<string, true> = {};
	const ignoredSettingIdsBySourceId: Record<string, Record<string, true>> = {};
	const sources: StyleSettingsSourceMetadata[] = sectionEntries.map((entry, index) => {
		const rawYaml = yaml.dump(entry, { lineWidth: -1 }).trim();
		const source = buildStandaloneYamlSource(rawYaml, options, index);
		const sectionMode =
			isRecord(entry) && getBoolean(entry.replace) === true ? 'replace' : mode;
		sectionModesBySourceId[source.sourceId] = sectionMode;
		if (sectionMode === 'override' && isRecord(entry)) {
			const sectionId = getString(entry.id);
			if (getBoolean(entry.remove) === true) {
				ignoredSectionSourceIds[source.sourceId] = true;
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'UNSUPPORTED_OVERRIDE_REMOVE',
						message:
							'Section removal is not supported in override mode yet. This entry will be ignored.',
						source,
						sectionId,
						path: 'remove',
					})
				);
			}

			if (Array.isArray(entry.settings)) {
				entry.settings.forEach((setting, settingIndex) => {
					if (!isRecord(setting) || getBoolean(setting.remove) !== true) return;
					const settingId = getString(setting.id);
					if (settingId) {
						ignoredSettingIdsBySourceId[source.sourceId] = {
							...(ignoredSettingIdsBySourceId[source.sourceId] || {}),
							[settingId]: true,
						};
					}
					diagnostics.push(
						createDiagnostic({
							severity: 'warning',
							code: 'UNSUPPORTED_OVERRIDE_REMOVE',
							message:
								'Setting removal is not supported in override mode yet. This entry will be ignored.',
							source,
							sectionId,
							settingId,
							path: `settings[${settingIndex}].remove`,
						})
					);
				});
			}
		}
		return source;
	});

	return {
		mode,
		sources,
		sectionModesBySourceId,
		ignoredSectionSourceIds,
		ignoredSettingIdsBySourceId,
		diagnostics,
	};
}

function normalizeYaml(rawYaml: string): string {
	const indent = detectIndent(rawYaml);
	// Default tab-indented or YAML blocks with no detectable indentation pattern
	// to four spaces so js-yaml can parse them consistently after tab normalization.
	const replacement =
		indent.type === 'space' && indent.indent ? indent.indent : '    ';
	return rawYaml.replace(/\t/g, replacement);
}

function normalizeOption(
	option: unknown,
	source: StyleSettingsSourceMetadata,
	sectionId: string,
	settingId: string,
	path: string
): { option?: SelectOption; diagnostics: StyleSettingsDiagnostic[] } {
	if (typeof option === 'string' && option.trim()) {
		return {
			option: { label: option, value: option },
			diagnostics: [],
		};
	}

	if (isRecord(option)) {
		const label = getString(option.label);
		const value = getString(option.value);
		if (label && value) {
			return {
				option: { label, value },
				diagnostics: [],
			};
		}
	}

	return {
		diagnostics: [
			createDiagnostic({
				severity: 'error',
				code: 'MALFORMED_OPTION',
				message:
					'Options must be strings or objects with non-empty label and value fields.',
				source,
				sectionId,
				settingId,
				path,
			}),
		],
	};
}

function normalizeOptions(
	options: unknown,
	source: StyleSettingsSourceMetadata,
	sectionId: string,
	settingId: string,
	path: string
): { options?: SelectOption[]; diagnostics: StyleSettingsDiagnostic[] } {
	if (!Array.isArray(options) || options.length === 0) {
		return {
			diagnostics: [
				createDiagnostic({
					severity: 'error',
					code: 'INVALID_OPTIONS',
					message: 'Setting options must be a non-empty array.',
					source,
					sectionId,
					settingId,
					path,
				}),
			],
		};
	}

	const diagnostics: StyleSettingsDiagnostic[] = [];
	const normalized: SelectOption[] = [];

	options.forEach((option, index) => {
		const result = normalizeOption(
			option,
			source,
			sectionId,
			settingId,
			`${path}.options[${index}]`
		);
		diagnostics.push(...result.diagnostics);
		if (result.option) normalized.push(result.option);
	});

	if (!normalized.length) {
		diagnostics.push(
			createDiagnostic({
				severity: 'error',
				code: 'INVALID_OPTIONS',
				message: 'Setting options did not contain any valid values.',
				source,
				sectionId,
				settingId,
				path,
			})
		);
	}

	return normalized.length ? { options: normalized, diagnostics } : { diagnostics };
}

function validateAltFormats(
	value: unknown,
	source: StyleSettingsSourceMetadata,
	sectionId: string,
	settingId: string,
	path: string
): { value?: AltFormatList; diagnostics: StyleSettingsDiagnostic[] } {
	if (value === undefined) return { diagnostics: [] };
	if (!Array.isArray(value)) {
		return {
			diagnostics: [
				createDiagnostic({
					severity: 'error',
					code: 'INVALID_ALT_FORMAT',
					message: 'alt-format must be an array of { id, format } entries.',
					source,
					sectionId,
					settingId,
					path,
				}),
			],
		};
	}

	const diagnostics: StyleSettingsDiagnostic[] = [];
	const formats: AltFormatList = [];

	value.forEach((entry, index) => {
		if (!isRecord(entry)) {
			diagnostics.push(
				createDiagnostic({
					severity: 'error',
					code: 'INVALID_ALT_FORMAT',
					message: 'alt-format entries must be objects.',
					source,
					sectionId,
					settingId,
					path: `${path}[${index}]`,
				})
			);
			return;
		}

		const id = getString(entry.id);
		const format = getString(entry.format);
		if (!id) {
			diagnostics.push(
				createDiagnostic({
					severity: 'error',
					code: 'INVALID_ALT_FORMAT',
					message: 'alt-format entries require a non-empty id value.',
					source,
					sectionId,
					settingId,
					path: `${path}[${index}]`,
				})
			);
			return;
		}

		if (!format) {
			diagnostics.push(
				createDiagnostic({
					severity: 'error',
					code: 'INVALID_ALT_FORMAT',
					message: 'alt-format entries require a non-empty format value.',
					source,
					sectionId,
					settingId,
					path: `${path}[${index}]`,
				})
			);
			return;
		}

		if (!colorFormats.has(format)) {
			diagnostics.push(
				createDiagnostic({
					severity: 'error',
					code: 'INVALID_ALT_FORMAT',
					message: `alt-format entries require a supported color format, received "${format}". Supported formats: ${COLOR_FORMATS_LIST}.`,
					source,
					sectionId,
					settingId,
					path: `${path}[${index}]`,
				})
			);
			return;
		}

		formats.push({ id, format: format as AltFormatList[number]['format'] });
	});

	return diagnostics.length ? { diagnostics } : { diagnostics, value: formats };
}

function validateDefaultInOptions(
	defaultValue: string | undefined,
	options: SelectOption[],
	allowEmpty: boolean | undefined
): boolean {
	if (defaultValue === undefined) return allowEmpty === true;
	if (allowEmpty && defaultValue === 'none') return true;
	return options.some((option) => option.value === defaultValue);
}

function buildSettingSource(
	source: StyleSettingsSourceMetadata,
	settingIndex: number
): StyleSettingsSettingSourceMetadata {
	return {
		...source,
		settingIndex,
		path: `settings[${settingIndex}]`,
	};
}

function validateSetting(
	value: unknown,
	source: StyleSettingsSourceMetadata,
	sectionId: string,
	index: number
): { setting?: CSSSetting; diagnostics: StyleSettingsDiagnostic[] } {
	const path = `settings[${index}]`;
	const diagnostics: StyleSettingsDiagnostic[] = [];
	if (!isRecord(value)) {
		return {
			diagnostics: [
				createDiagnostic({
					severity: 'warning',
					code: 'EMPTY_SETTING',
					message: 'Encountered an empty or non-object setting entry; it was ignored.',
					source,
					sectionId,
					path,
				}),
			],
		};
	}

	const id = getString(value.id);
	const type = getString(value.type);
	const title = getString(value.title);

	if (!id) {
		diagnostics.push(
			createDiagnostic({
				severity: 'error',
				code: 'MISSING_SETTING_ID',
				message: 'Each setting requires a non-empty id.',
				source,
				sectionId,
				path,
			})
		);
	}

	if (!type) {
		diagnostics.push(
			createDiagnostic({
				severity: 'error',
				code: 'MISSING_SETTING_TYPE',
				message: 'Each setting requires a non-empty type.',
				source,
				sectionId,
				settingId: id,
				path,
			})
		);
	}

	if (
		type &&
		!Object.values(SettingType).includes(type as (typeof SettingType)[keyof typeof SettingType])
	) {
		diagnostics.push(
			createDiagnostic({
				severity: 'error',
				code: 'UNSUPPORTED_SETTING_TYPE',
				message: `Unsupported setting type "${type}".`,
				source,
				sectionId,
				settingId: id,
				path,
			})
		);
	}

	if (!title && type !== SettingType.COLOR_GRADIENT) {
		diagnostics.push(
			createDiagnostic({
				severity: 'error',
				code: 'MISSING_SETTING_TITLE',
				message: 'Each setting requires a non-empty title.',
				source,
				sectionId,
				settingId: id,
				path,
			})
		);
	}

	if (diagnostics.some((diagnostic) => diagnostic.severity === 'error') || !id || !type) {
		return { diagnostics };
	}

	const sourceMetadata = buildSettingSource(source, index);
	const baseSetting = {
		...value,
		id,
		type,
		title: title || id,
		source: sourceMetadata,
	};

	switch (type) {
		case SettingType.HEADING: {
			const level = getNumber(value.level);
			if (
				level === undefined ||
				!Number.isInteger(level) ||
				level < 1 ||
				level > 6
			) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'INVALID_HEADING_LEVEL',
						message: 'Heading settings require an integer level between 1 and 6.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			const safeLevel =
				level !== undefined && Number.isInteger(level)
					? (Math.max(1, Math.min(6, level)) as 1 | 2 | 3 | 4 | 5 | 6)
					: 1;

			return {
				setting: {
					...baseSetting,
					level: safeLevel,
					collapsed: getBoolean(value.collapsed),
				} as Heading,
				diagnostics,
			};
		}
		case SettingType.INFO_TEXT:
			return {
				setting: {
					...baseSetting,
					markdown: getBoolean(value.markdown),
				} as InfoText,
				diagnostics,
			};
		case SettingType.CLASS_TOGGLE: {
			const defaultValue = value.default;
			if (defaultValue !== undefined && getBoolean(defaultValue) === undefined) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'INVALID_DEFAULT',
						message: 'class-toggle defaults must be boolean values.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}

			return {
				setting: {
					...baseSetting,
					default: getBoolean(defaultValue) ?? false,
					addCommand: getBoolean(value.addCommand),
				} as ClassToggle,
				diagnostics,
			};
		}
		case SettingType.CLASS_SELECT:
		case SettingType.VARIABLE_SELECT: {
			const normalizedOptions = normalizeOptions(value.options, source, sectionId, id, path);
			diagnostics.push(...normalizedOptions.diagnostics);
			if (!normalizedOptions.options) return { diagnostics };

			const defaultValue = getString(value.default);
			if (type === SettingType.CLASS_SELECT) {
				const allowEmpty = getBoolean(value.allowEmpty);
				if (allowEmpty === undefined) {
					diagnostics.push(
						createDiagnostic({
							severity: 'warning',
							code: 'MISSING_ALLOW_EMPTY',
							message: 'class-select settings require an allowEmpty boolean.',
							source,
							sectionId,
							settingId: id,
							path,
						})
					);
				}
				const safeAllowEmpty = allowEmpty ?? false;

				if (
					!validateDefaultInOptions(defaultValue, normalizedOptions.options, safeAllowEmpty)
				) {
					diagnostics.push(
						createDiagnostic({
							severity: 'warning',
							code: 'INVALID_DEFAULT',
							message:
								'class-select defaults must match one of the normalized option values, unless allowEmpty is true and the default is omitted or set to "none".',
							source,
							sectionId,
							settingId: id,
							path,
						})
					);
				}

				return {
					setting: {
						...baseSetting,
						allowEmpty: safeAllowEmpty,
						default: defaultValue,
						options: normalizedOptions.options,
					} as ClassMultiToggle,
					diagnostics,
				};
			}

			const safeDefault = defaultValue ?? '';
			if (!defaultValue) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'MISSING_DEFAULT',
						message: 'variable-select settings require a default value.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}

			if (!validateDefaultInOptions(safeDefault, normalizedOptions.options, false)) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'INVALID_DEFAULT',
						message:
							'variable-select defaults must match one of the normalized option values.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}

			return {
				setting: {
					...baseSetting,
					default: safeDefault,
					options: normalizedOptions.options,
					quotes: getBoolean(value.quotes),
				} as VariableSelect,
				diagnostics,
			};
		}
		case SettingType.VARIABLE_TEXT: {
			const defaultValue = getString(value.default);
			if (defaultValue === undefined) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'MISSING_DEFAULT',
						message: 'variable-text settings require a default value.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			const safeDefault = defaultValue ?? '';

			return {
				setting: {
					...baseSetting,
					default: safeDefault,
					quotes: getBoolean(value.quotes),
				} as VariableText,
				diagnostics,
			};
		}
		case SettingType.VARIABLE_NUMBER: {
			const defaultValue = getNumber(value.default);
			if (defaultValue === undefined) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'MISSING_DEFAULT',
						message: 'variable-number settings require a numeric default value.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			const safeDefault = defaultValue ?? 0;

			return {
				setting: {
					...baseSetting,
					default: safeDefault,
					format: getString(value.format),
				} as VariableNumber,
				diagnostics,
			};
		}
		case SettingType.VARIABLE_NUMBER_SLIDER: {
			const defaultValue = getNumber(value.default);
			const min = getNumber(value.min);
			const max = getNumber(value.max);
			const step = getNumber(value.step);
			const safeDef = defaultValue ?? 0;
			const safeMin = min ?? 0;
			const safeMax = max ?? 100;
			const safeStep = step ?? 1;
			if (
				defaultValue === undefined ||
				min === undefined ||
				max === undefined ||
				step === undefined
			) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'MISSING_SLIDER_FIELDS',
						message:
							'variable-number-slider settings require numeric default, min, max, and step values.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}

			const [correctedMin, correctedMax] =
				safeMin > safeMax ? [safeMax, safeMin] : [safeMin, safeMax];
			if (safeMin > safeMax) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'INVALID_SLIDER_DEFAULT',
						message: 'Slider min must be less than or equal to max.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}

			const correctedStep = safeStep <= 0 ? 1 : safeStep;
			if (safeStep <= 0) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'INVALID_SLIDER_DEFAULT',
						message: 'Slider step must be greater than zero.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}

			let correctedDefault = safeDef;
			if (safeDef < correctedMin) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'INVALID_SLIDER_DEFAULT',
						message: 'Slider default must be greater than or equal to min.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
				correctedDefault = correctedMin;
			}

			if (safeDef > correctedMax) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'INVALID_SLIDER_DEFAULT',
						message: 'Slider default must be less than or equal to max.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
				correctedDefault = correctedMax;
			}

			return {
				setting: {
					...baseSetting,
					default: correctedDefault,
					min: correctedMin,
					max: correctedMax,
					step: correctedStep,
					format: getString(value.format),
				} as VariableNumberSlider,
				diagnostics,
			};
		}
		case SettingType.VARIABLE_COLOR: {
			const format = getString(value.format);
			if (!format) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'MISSING_COLOR_FORMAT',
						message: `variable-color settings require a "format" field. Add \`format: <value>\` to this setting. Supported formats: ${COLOR_FORMATS_LIST}.`,
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			const safeFormat = format ?? 'hex';
			if (!colorFormats.has(safeFormat)) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'UNSUPPORTED_COLOR_FORMAT',
						message: `variable-color "format" value "${safeFormat}" is not supported. Replace it with one of: ${COLOR_FORMATS_LIST}.`,
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			const validatedFormat = colorFormats.has(safeFormat) ? safeFormat : 'hex';

			const defaultValue = getString(value.default);
			if (defaultValue && !isValidDefaultColor(defaultValue)) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'INVALID_DEFAULT',
						message:
							'variable-color defaults must be CSS color strings that start with #, rgb, or hsl.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}

			const altFormats = validateAltFormats(
				value['alt-format'],
				source,
				sectionId,
				id,
				`${path}.alt-format`
			);
			diagnostics.push(...altFormats.diagnostics);

			return {
				setting: {
					...baseSetting,
					format: validatedFormat,
					default: defaultValue,
					'alt-format': altFormats.value || [],
					opacity: getBoolean(value.opacity),
				} as VariableColor,
				diagnostics,
			};
		}
		case SettingType.VARIABLE_THEMED_COLOR: {
			const format = getString(value.format);
			const light = getString(value['default-light']);
			const dark = getString(value['default-dark']);
			if (!format) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'MISSING_COLOR_FORMAT',
						message: `variable-themed-color settings require a "format" field. Add \`format: <value>\` to this setting. Supported formats: ${COLOR_FORMATS_LIST}.`,
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			const safeFormat = format ?? 'hex';
			if (!colorFormats.has(safeFormat)) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'UNSUPPORTED_COLOR_FORMAT',
						message: `variable-themed-color "format" value "${safeFormat}" is not supported. Replace it with one of: ${COLOR_FORMATS_LIST}.`,
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			const validatedFormat = colorFormats.has(safeFormat) ? safeFormat : 'hex';
			if (!light) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'MISSING_THEMED_COLOR_FIELDS',
						message: 'variable-themed-color settings require a "default-light" field. Add `default-light: <css-color>` (e.g. #ffffff or hsl(0, 0%, 100%)) to this setting.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			if (!dark) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'MISSING_THEMED_COLOR_FIELDS',
						message: 'variable-themed-color settings require a "default-dark" field. Add `default-dark: <css-color>` (e.g. #000000 or hsl(0, 0%, 0%)) to this setting.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			const safeLight = light ?? '#000000';
			const safeDark = dark ?? '#000000';

			if (!isValidDefaultColor(safeLight) || !isValidDefaultColor(safeDark)) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'INVALID_DEFAULT',
						message:
							'variable-themed-color defaults must be CSS color strings that start with #, rgb, or hsl.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}

			const altFormats = validateAltFormats(
				value['alt-format'],
				source,
				sectionId,
				id,
				`${path}.alt-format`
			);
			diagnostics.push(...altFormats.diagnostics);

			return {
				setting: {
					...baseSetting,
					format: validatedFormat,
					'default-light': safeLight,
					'default-dark': safeDark,
					'alt-format': altFormats.value || [],
					opacity: getBoolean(value.opacity),
				} as VariableThemedColor,
				diagnostics,
			};
		}
		case SettingType.COLOR_GRADIENT: {
			const from = getString(value.from);
			const to = getString(value.to);
			const format = getString(value.format);
			const step = getNumber(value.step);
			const pad = getNumber(value.pad);
			if (!from) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'MISSING_GRADIENT_FIELDS',
						message: 'color-gradient settings require a "from" field. Add `from: <css-color>` (e.g. #000000) to this setting.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			if (!to) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'MISSING_GRADIENT_FIELDS',
						message: 'color-gradient settings require a "to" field. Add `to: <css-color>` (e.g. #ffffff) to this setting.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			if (!format) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'MISSING_GRADIENT_FIELDS',
						message: `color-gradient settings require a "format" field. Add \`format: <value>\` to this setting. Supported gradient formats: ${GRADIENT_FORMATS_LIST}.`,
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			const safeFrom = from ?? '';
			const safeTo = to ?? '';
			const safeFormat = format ?? 'hex';
			if (!gradientFormats.has(safeFormat)) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'UNSUPPORTED_GRADIENT_FORMAT',
						message: `color-gradient "format" value "${safeFormat}" is not supported. Replace it with one of: ${GRADIENT_FORMATS_LIST}.`,
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			if (step === undefined) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'MISSING_GRADIENT_FIELDS',
						message: 'color-gradient settings require a numeric "step" field. Add `step: <number>` (e.g. step: 1) to this setting.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			const validatedFormat = gradientFormats.has(safeFormat) ? safeFormat : 'hex';
			const safeStep = step ?? 1;

			if (safeStep <= 0) {
				diagnostics.push(
					createDiagnostic({
						severity: 'warning',
						code: 'INVALID_GRADIENT_STEP',
						message: 'color-gradient step must be greater than zero.',
						source,
						sectionId,
						settingId: id,
						path,
					})
				);
			}
			const correctedStep = safeStep <= 0 ? 1 : safeStep;

			return {
				setting: {
					...baseSetting,
					from: safeFrom,
					to: safeTo,
					format: validatedFormat as 'hex' | 'hsl' | 'rgb',
					step: correctedStep,
					pad: pad === undefined ? 0 : pad,
				} as ColorGradient,
				diagnostics,
			};
		}
		default:
			return { diagnostics };
	}
}

function parseBlock(
	source: StyleSettingsSourceMetadata
): { section?: ParsedCSSSettings; diagnostics: StyleSettingsDiagnostic[] } {
	const diagnostics: StyleSettingsDiagnostic[] = [];
	const fallbackName = getBlockFallbackName(source);
	let parsed: unknown;

	try {
		parsed = yaml.load(normalizeYaml(source.rawYaml), {
			filename: source.sourceId,
			schema: yaml.DEFAULT_SCHEMA,
		});
	} catch (error) {
		return {
			diagnostics: [
				createDiagnostic({
					severity: 'error',
					code: 'YAML_PARSE_ERROR',
					message: `${error}`,
					source,
					sectionId: fallbackName,
				}),
			],
		};
	}

	if (!isRecord(parsed)) {
		return {
			diagnostics: [
				createDiagnostic({
					severity: 'error',
					code: 'INVALID_SECTION',
					message: 'Each @settings block must parse to a YAML object.',
					source,
					sectionId: fallbackName,
				}),
			],
		};
	}

	const name = getString(parsed.name);
	const id = getString(parsed.id);
	const rawSettings = parsed.settings;

	if (!name || !id || !Array.isArray(rawSettings)) {
		return {
			diagnostics: [
				createDiagnostic({
					severity: 'error',
					code: 'INVALID_SECTION',
					message:
						'Each @settings block requires non-empty name and id fields plus a settings array.',
					source,
					sectionId: id || fallbackName,
				}),
			],
		};
	}

	const settings: CSSSetting[] = [];
	const seenSettingIds = new Set<string>();

	rawSettings.forEach((setting, index) => {
		if (!setting) {
			diagnostics.push(
				createDiagnostic({
					severity: 'warning',
					code: 'EMPTY_SETTING',
					message: 'Encountered an empty setting entry; it was ignored.',
					source,
					sectionId: id,
					path: `settings[${index}]`,
				})
			);
			return;
		}

		const result = validateSetting(setting, source, id, index);
		diagnostics.push(...result.diagnostics);
		if (!result.setting) return;

		if (seenSettingIds.has(result.setting.id)) {
			diagnostics.push(
				createDiagnostic({
					severity: 'error',
					code: 'DUPLICATE_SETTING_ID',
					message: `Duplicate setting id "${result.setting.id}" detected within section "${id}".`,
					source,
					sectionId: id,
					settingId: result.setting.id,
					path: `settings[${index}]`,
				})
			);
			return;
		}

		seenSettingIds.add(result.setting.id);
		settings.push(result.setting);
	});

	if (!settings.length) {
		diagnostics.push(
			createDiagnostic({
				severity: 'warning',
				code: 'EMPTY_SECTION',
				message: 'This @settings block did not contain any valid settings after validation.',
				source,
				sectionId: id,
			})
		);
		return { diagnostics };
	}

	return {
		section: {
			name,
			id,
			collapsed: getBoolean(parsed.collapsed) ?? false,
			settings,
			source,
		},
		diagnostics,
	};
}

function sortDiagnostics(
	diagnostics: StyleSettingsDiagnostic[]
): StyleSettingsDiagnostic[] {
	return diagnostics.sort((left, right) => {
		const sourceCompare = (left.source?.sourceId || '').localeCompare(
			right.source?.sourceId || ''
		);
		if (sourceCompare !== 0) return sourceCompare;
		return (left.path || '').localeCompare(right.path || '');
	});
}

export function parseStyleSettingsStylesheetText(
	text: string,
	options: ParseStyleSettingsOptions
): ParsedStyleSettingsResult {
	return parseStyleSettingsSources(extractStyleSettingsSourcesFromCssText(text, options));
}

export function parseStyleSettingsStandaloneYamlText(
	text: string,
	options: ParseStyleSettingsSidecarOptions
): ParsedStyleSettingsWithSidecarResult {
	const extracted = extractStyleSettingsSourcesFromStandaloneYamlText(text, options);
	const parsed = parseStyleSettingsSources(extracted.sources);
	return {
		sections: parsed.sections,
		diagnostics: sortDiagnostics([...extracted.diagnostics, ...parsed.diagnostics]),
		sidecarMode: extracted.mode,
	};
}

function withSourceKind(
	source: StyleSettingsSourceMetadata | undefined,
	sourceKind: StyleSettingsSourceMetadata['sourceKind']
): StyleSettingsSourceMetadata | undefined {
	return source ? { ...source, sourceKind } : undefined;
}

function withSettingSourceKind(
	source: StyleSettingsSettingSourceMetadata | undefined,
	sourceKind: StyleSettingsSourceMetadata['sourceKind']
): StyleSettingsSettingSourceMetadata | undefined {
	return source ? { ...source, sourceKind } : undefined;
}

function cloneSettingWithSourceKind(
	setting: CSSSetting,
	sourceKind: StyleSettingsSourceMetadata['sourceKind']
): CSSSetting {
	return {
		...setting,
		source: withSettingSourceKind(setting.source, sourceKind),
	} as CSSSetting;
}

function cloneSectionWithSourceKind(
	section: ParsedCSSSettings,
	sourceKind: StyleSettingsSourceMetadata['sourceKind']
): ParsedCSSSettings {
	return {
		...section,
		source: withSourceKind(section.source, sourceKind),
		settings: section.settings.map((setting) =>
			cloneSettingWithSourceKind(setting, sourceKind)
		),
	};
}

function mergeOverrideSection(
	baseSection: ParsedCSSSettings,
	overrideSection: ParsedCSSSettings,
	ignoredSettingIds?: Record<string, true>
): ParsedCSSSettings {
	const mergedSettings = [...baseSection.settings];
	const settingIndexById = new Map<string, number>();
	mergedSettings.forEach((setting, index) => {
		settingIndexById.set(setting.id, index);
	});

	overrideSection.settings.forEach((setting) => {
		if (ignoredSettingIds?.[setting.id]) return;
		const existingIndex = settingIndexById.get(setting.id);
		const overrideSetting = cloneSettingWithSourceKind(setting, 'css-yaml-override');
		if (existingIndex === undefined) {
			settingIndexById.set(overrideSetting.id, mergedSettings.length);
			mergedSettings.push(overrideSetting);
			return;
		}
		mergedSettings[existingIndex] = overrideSetting;
	});

	return {
		...baseSection,
		source: withSourceKind(overrideSection.source || baseSection.source, 'css-yaml-override'),
		settings: mergedSettings,
	};
}

export function parseStyleSettingsWithStandaloneYamlSidecar(
	cssText: string,
	cssOptions: ParseStyleSettingsOptions,
	sidecarYamlText: string,
	sidecarOptions: ParseStyleSettingsSidecarOptions
): ParsedStyleSettingsWithSidecarResult {
	const cssParsed = parseStyleSettingsStylesheetText(cssText, cssOptions);
	const extractedSidecar = extractStyleSettingsSourcesFromStandaloneYamlText(
		sidecarYamlText,
		{
			...sidecarOptions,
			// When a sidecar is combined with CSS, default to override semantics so CSS
			// remains the baseline unless the sidecar explicitly requests replace mode.
			defaultMode: sidecarOptions.defaultMode || 'override',
		}
	);
	const sidecarParsed = parseStyleSettingsSources(extractedSidecar.sources);
	const sidecarMode = extractedSidecar.mode;

	if (sidecarMode === 'replace') {
		return {
			sections: sidecarParsed.sections,
			diagnostics: sortDiagnostics([
				...cssParsed.diagnostics,
				...extractedSidecar.diagnostics,
				...sidecarParsed.diagnostics,
			]),
			sidecarMode,
		};
	}

	const mergedSections = [...cssParsed.sections];
	const sectionIndexById = new Map<string, number>();
	mergedSections.forEach((section, index) => {
		sectionIndexById.set(section.id, index);
	});

	const overrideDiagnostics: StyleSettingsDiagnostic[] = [];

	sidecarParsed.sections.forEach((sidecarSection) => {
		const sourceId = sidecarSection.source?.sourceId;
		if (sourceId && extractedSidecar.ignoredSectionSourceIds[sourceId]) return;
		const ignoredSettingIds = sourceId
			? extractedSidecar.ignoredSettingIdsBySourceId[sourceId]
			: undefined;
		const sectionMode = sourceId
			? extractedSidecar.sectionModesBySourceId[sourceId]
			: sidecarMode;
		const currentIndex = sectionIndexById.get(sidecarSection.id);

		if (sectionMode === 'replace') {
			const sectionToInsert =
				currentIndex === undefined
					? sidecarSection
					: cloneSectionWithSourceKind(sidecarSection, 'css-yaml-override');
			if (currentIndex === undefined) {
				sectionIndexById.set(sectionToInsert.id, mergedSections.length);
				mergedSections.push(sectionToInsert);
			} else {
				mergedSections[currentIndex] = sectionToInsert;
			}
			return;
		}

		if (currentIndex === undefined) {
			mergedSections.push(sidecarSection);
			sectionIndexById.set(sidecarSection.id, mergedSections.length - 1);
			return;
		}

		const mergedSection = mergeOverrideSection(
			mergedSections[currentIndex],
			sidecarSection,
			ignoredSettingIds
		);
		mergedSections[currentIndex] = mergedSection;
		const hasNonIgnoredOverrideSettings = sidecarSection.settings.some(
			(setting) => !ignoredSettingIds?.[setting.id]
		);
		if (!hasNonIgnoredOverrideSettings) {
			overrideDiagnostics.push(
				createDiagnostic({
					severity: 'warning',
					code: 'EMPTY_OVERRIDE_SECTION',
					message: `Override section "${sidecarSection.id}" does not include any settings; CSS section was left unchanged.`,
					source: sidecarSection.source,
					sectionId: sidecarSection.id,
				})
			);
		}
	});

	const finalized = finalizeParsedStyleSettings({
		sections: mergedSections,
		diagnostics: [
			...cssParsed.diagnostics,
			...extractedSidecar.diagnostics,
			...sidecarParsed.diagnostics,
			...overrideDiagnostics,
		],
	});

	return {
		...finalized,
		sidecarMode,
	};
}

export function parseStyleSettingsSources(
	sources: StyleSettingsSourceMetadata[]
): ParsedStyleSettingsResult {
	const sections: ParsedCSSSettings[] = [];
	const diagnostics: StyleSettingsDiagnostic[] = [];

	sources.forEach((source) => {
		const parsed = parseBlock(source);
		diagnostics.push(...parsed.diagnostics);
		if (parsed.section) sections.push(parsed.section);
	});

	return finalizeParsedStyleSettings({ sections, diagnostics });
}

export function finalizeParsedStyleSettings(
	result: ParsedStyleSettingsResult
): ParsedStyleSettingsResult {
	const seenSectionIds = new Map<string, ParsedCSSSettings>();
	const sections: ParsedCSSSettings[] = [];
	const diagnostics = [...result.diagnostics];

	result.sections.forEach((section) => {
		const existing = seenSectionIds.get(section.id);
		if (existing) {
			diagnostics.push(
				createDiagnostic({
					severity: 'error',
					code: 'DUPLICATE_SECTION_ID',
					message: `Duplicate section id "${section.id}" detected. The first definition was kept.`,
					source: section.source,
					sectionId: section.id,
				})
			);
			return;
		}

		seenSectionIds.set(section.id, section);
		sections.push(section);
	});

	return {
		sections,
		diagnostics: sortDiagnostics(diagnostics),
	};
}

function getColorOutputVariables(id: string, format: string, opacity: boolean): string[] {
	switch (format) {
		case 'hsl-split':
		case 'hsl-split-decimal':
			return [
				`--${id}-h`,
				`--${id}-s`,
				`--${id}-l`,
				...(opacity ? [`--${id}-a`] : []),
			];
		case 'rgb-split':
			return [
				`--${id}-r`,
				`--${id}-g`,
				`--${id}-b`,
				...(opacity ? [`--${id}-a`] : []),
			];
		default:
			return [`--${id}`];
	}
}

function getAltFormatDerivedBindings(
	sourceSettingId: string,
	altFormats: AltFormatList,
	opacity: boolean,
	variant: NormalizedStyleSettingsBindingVariant
): NormalizedStyleSettingsBinding[] {
	return altFormats.map((alt) => {
		const variables = getColorOutputVariables(alt.id, alt.format, opacity);
		return {
			kind: 'derived-css-variable',
			target: 'css-variable',
			variant,
			outputMode: variables.length > 1 ? 'multi' : 'single',
			variable: variables[0],
			variables,
			format: alt.format,
			opacity,
			derivedFrom: 'alt-format',
			sourceVariable: `--${sourceSettingId}`,
		};
	});
}

function getBindingMetadata(setting: CSSSetting): {
	binding: NormalizedStyleSettingsBinding;
	bindings: NormalizedStyleSettingsBinding[];
	derivedBindings: NormalizedStyleSettingsBinding[];
} {
	switch (setting.type) {
		case SettingType.CLASS_TOGGLE: {
			const binding: NormalizedStyleSettingsBinding = {
				kind: 'body-class-toggle',
				target: 'body-class',
				variant: 'base',
				outputMode: 'single',
				className: setting.id,
				settingType: setting.type,
			};
			return { binding, bindings: [binding], derivedBindings: [] };
		}
		case SettingType.CLASS_SELECT: {
			const selectSetting = setting as ClassMultiToggle;
			const binding: NormalizedStyleSettingsBinding = {
				kind: 'body-class-select',
				target: 'body-class',
				variant: 'base',
				outputMode: 'single',
				classValues: (selectSetting.options as SelectOption[]).map(
					(option) => option.value
				),
				allowEmpty: selectSetting.allowEmpty,
				settingType: setting.type,
			};
			return { binding, bindings: [binding], derivedBindings: [] };
		}
		case SettingType.VARIABLE_TEXT: {
			const textSetting = setting as VariableText;
			const binding: NormalizedStyleSettingsBinding = {
				kind: 'css-variable',
				target: 'css-variable',
				variant: 'base',
				outputMode: 'single',
				variable: `--${setting.id}`,
				variables: [`--${setting.id}`],
				quotes: !!textSetting.quotes,
				settingType: setting.type,
			};
			return { binding, bindings: [binding], derivedBindings: [] };
		}
		case SettingType.VARIABLE_NUMBER:
		case SettingType.VARIABLE_NUMBER_SLIDER: {
			const numberSetting = setting as VariableNumber | VariableNumberSlider;
			const binding: NormalizedStyleSettingsBinding = {
				kind: 'css-variable',
				target: 'css-variable',
				variant: 'base',
				outputMode: 'single',
				variable: `--${setting.id}`,
				variables: [`--${setting.id}`],
				format: numberSetting.format || '',
				settingType: setting.type,
			};
			return { binding, bindings: [binding], derivedBindings: [] };
		}
		case SettingType.VARIABLE_SELECT: {
			const selectSetting = setting as VariableSelect;
			const binding: NormalizedStyleSettingsBinding = {
				kind: 'css-variable',
				target: 'css-variable',
				variant: 'base',
				outputMode: 'single',
				variable: `--${setting.id}`,
				variables: [`--${setting.id}`],
				quotes: !!selectSetting.quotes,
				settingType: setting.type,
			};
			return { binding, bindings: [binding], derivedBindings: [] };
		}
		case SettingType.VARIABLE_COLOR: {
			const colorSetting = setting as VariableColor;
			const opacity = !!colorSetting.opacity;
			const variables = getColorOutputVariables(setting.id, colorSetting.format, opacity);
			const binding: NormalizedStyleSettingsBinding = {
				kind: 'css-variable',
				target: 'css-variable',
				variant: 'base',
				outputMode: variables.length > 1 ? 'multi' : 'single',
				variable: variables[0],
				variables,
				format: colorSetting.format,
				opacity,
				settingType: setting.type,
			};
			return {
				binding,
				bindings: [binding],
				derivedBindings: getAltFormatDerivedBindings(
					setting.id,
					colorSetting['alt-format'] || [],
					opacity,
					'base'
				),
			};
		}
		case SettingType.VARIABLE_THEMED_COLOR: {
			const themedSetting = setting as VariableThemedColor;
			const opacity = !!themedSetting.opacity;
			const variables = getColorOutputVariables(setting.id, themedSetting.format, opacity);
			const selectors = {
				light: 'body.theme-light.css-settings-manager',
				dark: 'body.theme-dark.css-settings-manager',
			};
			const binding: NormalizedStyleSettingsBinding = {
				kind: 'themed-css-variable',
				target: 'css-variable',
				variant: 'base',
				outputMode: variables.length > 1 ? 'multi' : 'single',
				variable: variables[0],
				variables,
				format: themedSetting.format,
				opacity,
				selectors,
				settingType: setting.type,
			};
			const bindings: NormalizedStyleSettingsBinding[] = ['light', 'dark'].map(
				(variant) => ({
					kind: 'themed-css-variable',
					target: 'css-variable',
					variant: variant as NormalizedStyleSettingsBindingVariant,
					outputMode: variables.length > 1 ? 'multi' : 'single',
					variable: variables[0],
					variables,
					format: themedSetting.format,
					opacity,
					selectors,
					settingType: setting.type,
				})
			);
			return {
				binding,
				bindings,
				derivedBindings: [
					...getAltFormatDerivedBindings(
						setting.id,
						themedSetting['alt-format'] || [],
						opacity,
						'light'
					),
					...getAltFormatDerivedBindings(
						setting.id,
						themedSetting['alt-format'] || [],
						opacity,
						'dark'
					),
				],
			};
		}
		case SettingType.COLOR_GRADIENT: {
			const gradientSetting = setting as ColorGradient;
			const binding: NormalizedStyleSettingsBinding = {
				kind: 'gradient-output',
				target: 'css-variable',
				variant: 'base',
				outputMode: 'range',
				variablePrefix: `--${setting.id}-`,
				variablePattern: `--${setting.id}-{index}`,
				sourceVariables: [`--${gradientSetting.from}`, `--${gradientSetting.to}`],
				format: gradientSetting.format,
				step: gradientSetting.step,
				pad: gradientSetting.pad || 0,
				derivedFrom: 'gradient',
				settingType: setting.type,
			};
			return { binding, bindings: [binding], derivedBindings: [] };
		}
		default: {
			const binding: NormalizedStyleSettingsBinding = {
				kind: 'non-emitting',
				target: 'none',
				variant: 'base',
				outputMode: 'none',
				reason: 'setting type has no runtime style emission',
				settingType: setting.type,
			};
			return { binding, bindings: [binding], derivedBindings: [] };
		}
	}
}

function normalizeSetting(setting: CSSSetting): NormalizedStyleSettings {
	const bindingMetadata = getBindingMetadata(setting);
	const normalized: NormalizedStyleSettings = {
		id: setting.id,
		title: 'title' in setting ? setting.title : undefined,
		description: 'description' in setting ? setting.description : undefined,
		type: setting.type,
		binding: bindingMetadata.binding,
		bindings: bindingMetadata.bindings,
		derivedBindings: bindingMetadata.derivedBindings,
		source: setting.source,
	};

	switch (setting.type) {
		case SettingType.HEADING: {
			const heading = setting as Heading;
			normalized.constraints = {
				level: heading.level,
				collapsed: !!heading.collapsed,
			};
			break;
		}
		case SettingType.INFO_TEXT: {
			const info = setting as InfoText;
			normalized.constraints = {
				markdown: !!info.markdown,
			};
			break;
		}
		case SettingType.CLASS_TOGGLE: {
			const toggle = setting as ClassToggle;
			normalized.default = toggle.default ?? false;
			normalized.constraints = {
				addCommand: !!toggle.addCommand,
			};
			break;
		}
		case SettingType.CLASS_SELECT: {
			const select = setting as ClassMultiToggle;
			normalized.default = select.default;
			normalized.options = select.options as SelectOption[];
			normalized.constraints = {
				allowEmpty: select.allowEmpty,
			};
			break;
		}
		case SettingType.VARIABLE_TEXT: {
			const textSetting = setting as VariableText;
			normalized.default = textSetting.default;
			normalized.constraints = {
				quotes: !!textSetting.quotes,
			};
			break;
		}
		case SettingType.VARIABLE_NUMBER: {
			const numberSetting = setting as VariableNumber;
			normalized.default = numberSetting.default;
			normalized.constraints = {
				format: numberSetting.format || '',
			};
			break;
		}
		case SettingType.VARIABLE_NUMBER_SLIDER: {
			const slider = setting as VariableNumberSlider;
			normalized.default = slider.default;
			normalized.constraints = {
				min: slider.min,
				max: slider.max,
				step: slider.step,
				format: slider.format || '',
			};
			break;
		}
		case SettingType.VARIABLE_SELECT: {
			const select = setting as VariableSelect;
			normalized.default = select.default;
			normalized.options = select.options as SelectOption[];
			normalized.constraints = {
				quotes: !!select.quotes,
			};
			break;
		}
		case SettingType.VARIABLE_COLOR: {
			const color = setting as VariableColor;
			normalized.default = color.default;
			normalized.constraints = {
				format: color.format,
				opacity: !!color.opacity,
				altFormats: color['alt-format'] || [],
			};
			break;
		}
		case SettingType.VARIABLE_THEMED_COLOR: {
			const themed = setting as VariableThemedColor;
			normalized.defaults = {
				light: themed['default-light'],
				dark: themed['default-dark'],
			};
			normalized.constraints = {
				format: themed.format,
				opacity: !!themed.opacity,
				altFormats: themed['alt-format'] || [],
			};
			break;
		}
		case SettingType.COLOR_GRADIENT: {
			const gradient = setting as ColorGradient;
			normalized.constraints = {
				from: gradient.from,
				to: gradient.to,
				format: gradient.format,
				step: gradient.step,
				pad: gradient.pad || 0,
			};
			break;
		}
	}

	return normalized;
}

export function buildNormalizedStyleSettingsSchema(
	result: ParsedStyleSettingsResult
): NormalizedStyleSettingsSchema {
	return {
		version: 2,
		generatedAt: new Date().toISOString(),
		sections: result.sections.map((section) => ({
			id: section.id,
			name: section.name,
			collapsed: !!section.collapsed,
			source: section.source,
			settings: section.settings.map((setting) => normalizeSetting(setting)),
		})),
		diagnostics: result.diagnostics,
	};
}
