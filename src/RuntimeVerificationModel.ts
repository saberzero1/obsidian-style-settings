import {
ClassMultiToggle,
ClassToggle,
ParsedCSSSettings,
VariableColor,
VariableNumber,
VariableNumberSlider,
VariableSelect,
VariableText,
} from './SettingHandlers';
import { SettingValue } from './SettingsManager';
import { SettingType } from './settingsView/SettingComponents/types';

export interface RuntimeVerificationFixture {
id: string;
title: string;
candidatePaths: string[];
surface: RuntimeVerificationSurface;
}

export type RuntimeVerificationSurface =
| 'markdown-preview'
| 'markdown-source'
| 'workspace';

export interface RuntimeVerificationSelectorProbe {
id: string;
selector: string;
trackedProperties: string[];
diagnosticProperties?: string[];
pseudoElement?: string;
surface?: RuntimeVerificationSurface;
}

export interface RuntimeVerificationSelectorGroup {
id: string;
label: string;
fixtureIds: string[];
selectors: RuntimeVerificationSelectorProbe[];
}

export interface RuntimeVerificationMappingSet {
id: string;
version: string;
title: string;
fixtures: RuntimeVerificationFixture[];
groups: RuntimeVerificationSelectorGroup[];
}

export interface RuntimeVerificationSettingApplication {
sectionId: string;
settingId: string;
value: SettingValue;
modeVariant?: 'light' | 'dark';
strategy: 'explicit' | 'auto-derived';
}

export interface RuntimeVerificationPayload {
mappingSet?: RuntimeVerificationMappingSet;
settingApplication?: Omit<RuntimeVerificationSettingApplication, 'strategy'>;
maxMatchedElementsPerSelector?: number;
stabilizationTimeoutMs?: number;
}

export interface RuntimeVerificationValueCount {
value: string;
count: number;
}

export interface RuntimeVerificationPropertySnapshot {
property: string;
sampleCount: number;
valueCounts: RuntimeVerificationValueCount[];
}

export interface RuntimeVerificationPropertyComparison {
property: string;
baseline: RuntimeVerificationPropertySnapshot;
changed: RuntimeVerificationPropertySnapshot;
changedFromBaseline: boolean;
}

export const DEFAULT_RUNTIME_VERIFICATION_MAPPING_SET: RuntimeVerificationMappingSet =
{
id: 'quartz-aligned-minimal-v1',
version: '1',
title: 'Quartz-aligned minimal runtime mapping set',
fixtures: [
{
id: 'headings',
title: 'Headings',
candidatePaths: ['headings.md', 'fixtures/headings.md'],
surface: 'markdown-preview',
},
{
id: 'callouts',
title: 'Callouts',
candidatePaths: ['callouts.md', 'fixtures/callouts.md'],
surface: 'markdown-preview',
},
{
id: 'tables',
title: 'Tables',
candidatePaths: ['tables.md', 'fixtures/tables.md'],
surface: 'markdown-preview',
},
{
id: 'code',
title: 'Code',
candidatePaths: [
'theme-code/syntax-samples.md',
'fixtures/theme-code/syntax-samples.md',
],
surface: 'markdown-preview',
},
{
id: 'embeds-properties',
title: 'Embeds and properties',
candidatePaths: [
'theme-embeds/frontmatter.md',
'fixtures/theme-embeds/frontmatter.md',
],
surface: 'markdown-preview',
},
],
groups: [
{
id: 'headings',
label: 'Headings',
fixtureIds: ['headings'],
selectors: [
{
id: 'heading-h1',
selector: '.markdown-preview-view h1',
trackedProperties: ['font-size', 'line-height', 'color'],
},
{
id: 'heading-h2',
selector: '.markdown-preview-view h2',
trackedProperties: ['font-size', 'line-height', 'color'],
},
],
},
{
id: 'callouts',
label: 'Callouts',
fixtureIds: ['callouts'],
selectors: [
{
id: 'callout-root',
selector: '.markdown-preview-view .callout',
trackedProperties: ['border-color', 'background-color', 'color'],
},
],
},
{
id: 'tables',
label: 'Tables',
fixtureIds: ['tables'],
selectors: [
{
id: 'table-cell',
selector: '.markdown-preview-view table td',
trackedProperties: ['border-color', 'background-color', 'color'],
},
],
},
{
id: 'code',
label: 'Code',
fixtureIds: ['code'],
selectors: [
{
id: 'code-inline',
selector: '.markdown-preview-view code',
trackedProperties: ['color', 'background-color', 'font-size'],
},
],
},
{
id: 'embeds-properties',
label: 'Embeds and properties',
fixtureIds: ['embeds-properties'],
selectors: [
{
id: 'internal-embed',
selector: '.markdown-preview-view .internal-embed',
trackedProperties: ['border-color', 'background-color'],
},
{
id: 'metadata-property',
selector: '.markdown-preview-view .metadata-property',
trackedProperties: ['color', 'background-color'],
},
],
},
],
};

export function summarizeObservedValues(
property: string,
values: string[]
): RuntimeVerificationPropertySnapshot {
const counts = new Map<string, number>();
for (const value of values) {
const key = value.trim();
counts.set(key, (counts.get(key) || 0) + 1);
}

const valueCounts = Array.from(counts.entries())
.map(([value, count]) => ({ value, count }))
.sort((a, b) => a.value.localeCompare(b.value));

return {
property,
sampleCount: values.length,
valueCounts,
};
}

export function didPropertySummaryChange(
baseline: RuntimeVerificationPropertySnapshot,
changed: RuntimeVerificationPropertySnapshot
): boolean {
if (baseline.sampleCount !== changed.sampleCount) {
return true;
}

if (baseline.valueCounts.length !== changed.valueCounts.length) {
return true;
}

for (let i = 0; i < baseline.valueCounts.length; i++) {
if (baseline.valueCounts[i].value !== changed.valueCounts[i].value) {
return true;
}
if (baseline.valueCounts[i].count !== changed.valueCounts[i].count) {
return true;
}
}

return false;
}

export function buildSettingStorageKey(
sectionId: string,
settingId: string,
modeVariant?: 'light' | 'dark'
): string {
const base = `${sectionId}@@${settingId}`;
return modeVariant ? `${base}@@${modeVariant}` : base;
}

function selectOptionValues(options: ClassMultiToggle['options'] | VariableSelect['options']) {
return options.map((option) =>
typeof option === 'string' ? option : option.value
);
}

export function deriveDeterministicSettingApplication(
settingsList: ParsedCSSSettings[],
currentSettings: Record<string, SettingValue>
): RuntimeVerificationSettingApplication | null {
for (const section of settingsList) {
for (const setting of section.settings) {
switch (setting.type) {
case SettingType.CLASS_TOGGLE: {
const toggle = setting as ClassToggle;
const key = buildSettingStorageKey(section.id, setting.id);
const current = currentSettings[key];
const start =
typeof current === 'boolean'
? current
: toggle.default === true;
return {
sectionId: section.id,
settingId: setting.id,
value: !start,
strategy: 'auto-derived',
};
}
case SettingType.CLASS_SELECT: {
const classSelect = setting as ClassMultiToggle;
const values = selectOptionValues(classSelect.options);
if (!values.length) {
break;
}
const key = buildSettingStorageKey(section.id, setting.id);
const current = (currentSettings[key] ?? classSelect.default) as string;
const next = values.find((option) => option !== current) || values[0];
return {
sectionId: section.id,
settingId: setting.id,
value: next,
strategy: 'auto-derived',
};
}
case SettingType.VARIABLE_NUMBER: {
const variable = setting as VariableNumber;
const key = buildSettingStorageKey(section.id, setting.id);
const current = currentSettings[key];
const start =
typeof current === 'number' ? current : Number(variable.default ?? 0);
return {
sectionId: section.id,
settingId: setting.id,
value: start + 1,
strategy: 'auto-derived',
};
}
case SettingType.VARIABLE_NUMBER_SLIDER: {
const slider = setting as VariableNumberSlider;
const key = buildSettingStorageKey(section.id, setting.id);
const current = currentSettings[key];
const start =
typeof current === 'number' ? current : Number(slider.default ?? slider.min);
const next = start + slider.step <= slider.max ? start + slider.step : slider.min;
return {
sectionId: section.id,
settingId: setting.id,
value: next,
strategy: 'auto-derived',
};
}
case SettingType.VARIABLE_TEXT: {
const text = setting as VariableText;
const key = buildSettingStorageKey(section.id, setting.id);
const current = currentSettings[key];
const base =
typeof current === 'string' ? current : (text.default ?? '').toString();
return {
sectionId: section.id,
settingId: setting.id,
value: `${base} runtime-verification`,
strategy: 'auto-derived',
};
}
case SettingType.VARIABLE_SELECT: {
const select = setting as VariableSelect;
const values = selectOptionValues(select.options);
if (!values.length) {
break;
}
const key = buildSettingStorageKey(section.id, setting.id);
const current = (currentSettings[key] ?? select.default) as string;
const next = values.find((option) => option !== current) || values[0];
return {
sectionId: section.id,
settingId: setting.id,
value: next,
strategy: 'auto-derived',
};
}
case SettingType.VARIABLE_COLOR: {
const color = setting as VariableColor;
const key = buildSettingStorageKey(section.id, setting.id);
const current = (currentSettings[key] ?? color.default ?? '').toString().trim();
const next = current.toLowerCase() === '#ff00ff' ? '#00ffff' : '#ff00ff';
return {
sectionId: section.id,
settingId: setting.id,
value: next,
strategy: 'auto-derived',
};
}
}
}
}

return null;
}
