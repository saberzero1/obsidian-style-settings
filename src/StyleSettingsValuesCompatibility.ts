import { isValidSavedColor } from './StyleSettingsShared';
import {
	NormalizedStyleSettings,
	NormalizedStyleSettingsSchema,
} from './StyleSettingsParser';
import { SettingType } from './settingsView/SettingComponents/types';

type SupportedSettingValue = boolean | number | string;
type SettingModifier = 'light' | 'dark';

export type StyleSettingsExportIdentityKind =
	| 'section-setting'
	| 'section-setting-modifier'
	| 'invalid';

export interface ParsedStyleSettingsExportKey {
	rawKey: string;
	kind: StyleSettingsExportIdentityKind;
	sectionId?: string;
	settingId?: string;
	modifier?: string;
}

export interface StyleSettingsCompatibilityDiagnostic {
	code: string;
	message: string;
	key: string;
	sectionId?: string;
	settingId?: string;
	modifier?: string;
}

export interface StyleSettingsCompatibilityAcceptedValue {
	key: string;
	value: SupportedSettingValue;
	sectionId: string;
	settingId: string;
	modifier?: SettingModifier;
	coerced: boolean;
}

export interface StyleSettingsCompatibilityIgnoredValue {
	key: string;
	value: unknown;
	diagnostic: StyleSettingsCompatibilityDiagnostic;
}

export interface StyleSettingsCompatibilityRejectedValue {
	key: string;
	value: unknown;
	diagnostic: StyleSettingsCompatibilityDiagnostic;
}

export interface ValidateStyleSettingsExportValuesOptions {
	coercePrimitiveStrings?: boolean;
}

export interface ValidateStyleSettingsExportValuesResult {
	accepted: StyleSettingsCompatibilityAcceptedValue[];
	ignored: StyleSettingsCompatibilityIgnoredValue[];
	rejected: StyleSettingsCompatibilityRejectedValue[];
	acceptedValues: Record<string, SupportedSettingValue>;
}

const supportedThemedModifiers = new Set<SettingModifier>(['light', 'dark']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getConstraintNumber(
	setting: NormalizedStyleSettings,
	key: 'min' | 'max' | 'step'
): number | undefined {
	const raw = setting.constraints?.[key];
	return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;
}

function getConstraintBoolean(
	setting: NormalizedStyleSettings,
	key: 'allowEmpty'
): boolean | undefined {
	const raw = setting.constraints?.[key];
	return typeof raw === 'boolean' ? raw : undefined;
}

function parseExportKey(key: string): ParsedStyleSettingsExportKey {
	const parts = key.split('@@');
	if (parts.length === 2 && parts[0] && parts[1]) {
		return {
			rawKey: key,
			kind: 'section-setting',
			sectionId: parts[0],
			settingId: parts[1],
		};
	}

	if (parts.length === 3 && parts[0] && parts[1] && parts[2]) {
		return {
			rawKey: key,
			kind: 'section-setting-modifier',
			sectionId: parts[0],
			settingId: parts[1],
			modifier: parts[2],
		};
	}

	return {
		rawKey: key,
		kind: 'invalid',
	};
}

function buildDiagnostic(
	key: string,
	code: string,
	message: string,
	identity?: ParsedStyleSettingsExportKey
): StyleSettingsCompatibilityDiagnostic {
	return {
		code,
		message,
		key,
		sectionId: identity?.sectionId,
		settingId: identity?.settingId,
		modifier: identity?.modifier,
	};
}

function coerceValue(
	value: unknown,
	setting: NormalizedStyleSettings,
	coercePrimitiveStrings: boolean
): { value: unknown; coerced: boolean } {
	if (!coercePrimitiveStrings || typeof value !== 'string') {
		return { value, coerced: false };
	}

	if (setting.type === SettingType.CLASS_TOGGLE) {
		const normalized = value.trim().toLowerCase();
		if (normalized === 'true') return { value: true, coerced: true };
		if (normalized === 'false') return { value: false, coerced: true };
	}

	if (
		setting.type === SettingType.VARIABLE_NUMBER ||
		setting.type === SettingType.VARIABLE_NUMBER_SLIDER
	) {
		const normalized = value.trim();
		if (!normalized) return { value, coerced: false };
		const parsed = Number(normalized);
		if (Number.isFinite(parsed)) return { value: parsed, coerced: true };
	}

	return { value, coerced: false };
}

function validateSettingValue(
	setting: NormalizedStyleSettings,
	value: unknown
): { valid: boolean; code?: string; message?: string } {
	switch (setting.type) {
		case SettingType.CLASS_TOGGLE:
			if (typeof value !== 'boolean') {
				return {
					valid: false,
					code: 'INVALID_TYPE',
					message: `Expected boolean for ${setting.type}.`,
				};
			}
			return { valid: true };
		case SettingType.CLASS_SELECT:
		case SettingType.VARIABLE_SELECT: {
			if (typeof value !== 'string') {
				return {
					valid: false,
					code: 'INVALID_TYPE',
					message: `Expected string for ${setting.type}.`,
				};
			}

			const options = (setting.options || []).map((option) => option.value);
			const allowEmpty = setting.type === SettingType.CLASS_SELECT
				? getConstraintBoolean(setting, 'allowEmpty')
				: false;
			if (value === '' && allowEmpty) return { valid: true };
			if (!options.includes(value)) {
				return {
					valid: false,
					code: 'INVALID_OPTION',
					message: `Value "${value}" is not a valid option for ${setting.type}.`,
				};
			}
			return { valid: true };
		}
		case SettingType.VARIABLE_TEXT:
			if (typeof value !== 'string') {
				return {
					valid: false,
					code: 'INVALID_TYPE',
					message: `Expected string for ${setting.type}.`,
				};
			}
			return { valid: true };
		case SettingType.VARIABLE_NUMBER:
		case SettingType.VARIABLE_NUMBER_SLIDER: {
			if (typeof value !== 'number' || !Number.isFinite(value)) {
				return {
					valid: false,
					code: 'INVALID_TYPE',
					message: `Expected finite number for ${setting.type}.`,
				};
			}
			const min = getConstraintNumber(setting, 'min');
			const max = getConstraintNumber(setting, 'max');
			const step = getConstraintNumber(setting, 'step');
			if (min !== undefined && value < min) {
				return {
					valid: false,
					code: 'OUT_OF_RANGE',
					message: `Value ${value} is below min ${min}.`,
				};
			}
			if (max !== undefined && value > max) {
				return {
					valid: false,
					code: 'OUT_OF_RANGE',
					message: `Value ${value} is above max ${max}.`,
				};
			}
			if (step !== undefined && step > 0 && min !== undefined) {
				const fromMin = (value - min) / step;
				if (Math.abs(fromMin - Math.round(fromMin)) > 1e-9) {
					return {
						valid: false,
						code: 'INVALID_STEP',
						message: `Value ${value} does not align with step ${step} from min ${min}.`,
					};
				}
			}
			return { valid: true };
		}
		case SettingType.VARIABLE_COLOR:
		case SettingType.VARIABLE_THEMED_COLOR:
			if (typeof value !== 'string' || !isValidSavedColor(value)) {
				return {
					valid: false,
					code: 'INVALID_COLOR',
					message: `Expected a valid CSS color string for ${setting.type}.`,
				};
			}
			return { valid: true };
		default:
			return {
				valid: false,
				code: 'UNSUPPORTED_VALUE_SETTING',
				message: `Setting type "${setting.type}" does not accept exported values.`,
			};
	}
}

function createSchemaIndex(schema: NormalizedStyleSettingsSchema): {
	[sectionId: string]: { [settingId: string]: NormalizedStyleSettings };
} {
	return schema.sections.reduce<{
		[sectionId: string]: { [settingId: string]: NormalizedStyleSettings };
	}>((index, section) => {
		index[section.id] = section.settings.reduce<{ [settingId: string]: NormalizedStyleSettings }>(
			(settingIndex, setting) => {
				settingIndex[setting.id] = setting;
				return settingIndex;
			},
			{}
		);
		return index;
	}, {});
}

export function parseStyleSettingsExportKeyIdentity(
	key: string
): ParsedStyleSettingsExportKey {
	return parseExportKey(key);
}

export function validateStyleSettingsExportValues(
	schema: NormalizedStyleSettingsSchema,
	exportedValues: unknown,
	options: ValidateStyleSettingsExportValuesOptions = {}
): ValidateStyleSettingsExportValuesResult {
	const accepted: StyleSettingsCompatibilityAcceptedValue[] = [];
	const ignored: StyleSettingsCompatibilityIgnoredValue[] = [];
	const rejected: StyleSettingsCompatibilityRejectedValue[] = [];
	const acceptedValues: Record<string, SupportedSettingValue> = {};
	const coercePrimitiveStrings = options.coercePrimitiveStrings !== false;

	if (!isRecord(exportedValues)) {
		rejected.push({
			key: '$',
			value: exportedValues,
			diagnostic: buildDiagnostic(
				'$',
				'INVALID_EXPORT_OBJECT',
				'Exported values must be a JSON object.'
			),
		});
		return {
			accepted,
			ignored,
			rejected,
			acceptedValues,
		};
	}

	const schemaIndex = createSchemaIndex(schema);

	Object.keys(exportedValues)
		.sort()
		.forEach((key) => {
			const value = exportedValues[key];
			const identity = parseExportKey(key);
			if (identity.kind === 'invalid' || !identity.sectionId || !identity.settingId) {
				rejected.push({
					key,
					value,
					diagnostic: buildDiagnostic(
						key,
						'INVALID_KEY_IDENTITY',
						'Expected key identity format "sectionId@@settingId" or "sectionId@@settingId@@modifier".',
						identity
					),
				});
				return;
			}

			const section = schemaIndex[identity.sectionId];
			if (!section) {
				ignored.push({
					key,
					value,
					diagnostic: buildDiagnostic(
						key,
						'UNRELATED_SECTION',
						`Section "${identity.sectionId}" is not part of the current schema.`,
						identity
					),
				});
				return;
			}

			const setting = section[identity.settingId];
			if (!setting) {
				rejected.push({
					key,
					value,
					diagnostic: buildDiagnostic(
						key,
						'UNKNOWN_SETTING',
						`Setting "${identity.settingId}" does not exist in section "${identity.sectionId}".`,
						identity
					),
				});
				return;
			}

			if (setting.type === SettingType.VARIABLE_THEMED_COLOR) {
				if (!identity.modifier || !supportedThemedModifiers.has(identity.modifier as SettingModifier)) {
					rejected.push({
						key,
						value,
						diagnostic: buildDiagnostic(
							key,
							'INVALID_MODIFIER',
							'variable-themed-color keys must include @@light or @@dark.',
							identity
						),
					});
					return;
				}
			} else if (identity.modifier) {
				rejected.push({
					key,
					value,
					diagnostic: buildDiagnostic(
						key,
						'UNEXPECTED_MODIFIER',
						`Modifier "${identity.modifier}" is not valid for setting type "${setting.type}".`,
						identity
					),
				});
				return;
			}

			const coerced = coerceValue(value, setting, coercePrimitiveStrings);
			const validation = validateSettingValue(setting, coerced.value);
			if (!validation.valid) {
				rejected.push({
					key,
					value,
					diagnostic: buildDiagnostic(
						key,
						validation.code || 'INVALID_VALUE',
						validation.message || 'Value is invalid for the setting schema.',
						identity
					),
				});
				return;
			}

			const modifier = identity.modifier as SettingModifier | undefined;
			const normalizedValue = coerced.value as SupportedSettingValue;
			accepted.push({
				key,
				value: normalizedValue,
				sectionId: identity.sectionId,
				settingId: identity.settingId,
				modifier,
				coerced: coerced.coerced,
			});
			acceptedValues[key] = normalizedValue;
		});

	return {
		accepted,
		ignored,
		rejected,
		acceptedValues,
	};
}
