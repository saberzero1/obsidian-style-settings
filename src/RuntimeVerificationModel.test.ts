import { describe, expect, it } from 'vitest';
import {
buildSettingStorageKey,
deriveDeterministicSettingApplication,
didPropertySummaryChange,
summarizeObservedValues,
} from './RuntimeVerificationModel';
import { ParsedCSSSettings } from './SettingHandlers';
import { SettingType } from './settingsView/SettingComponents/types';

describe('summarizeObservedValues', () => {
it('counts observed values in sorted order', () => {
const summary = summarizeObservedValues('color', ['blue', 'red', 'blue']);
expect(summary).toEqual({
property: 'color',
sampleCount: 3,
valueCounts: [
{ value: 'blue', count: 2 },
{ value: 'red', count: 1 },
],
});
});
});

describe('didPropertySummaryChange', () => {
it('detects no changes when sample counts and values match', () => {
const baseline = summarizeObservedValues('color', ['red', 'blue']);
const changed = summarizeObservedValues('color', ['blue', 'red']);
expect(didPropertySummaryChange(baseline, changed)).toBe(false);
});

it('detects changes when values differ', () => {
const baseline = summarizeObservedValues('color', ['red']);
const changed = summarizeObservedValues('color', ['blue']);
expect(didPropertySummaryChange(baseline, changed)).toBe(true);
});
});

describe('buildSettingStorageKey', () => {
it('builds base storage keys', () => {
expect(buildSettingStorageKey('section', 'setting')).toBe('section@@setting');
});

it('builds mode-scoped storage keys', () => {
expect(buildSettingStorageKey('section', 'setting', 'light')).toBe(
'section@@setting@@light'
);
});
});

describe('deriveDeterministicSettingApplication', () => {
it('prefers class-toggle settings and flips their current value', () => {
const settingsList: ParsedCSSSettings[] = [
{
id: 'ui',
name: 'UI',
collapsed: false,
settings: [
{
id: 'dense-mode',
title: 'Dense mode',
type: SettingType.CLASS_TOGGLE,
default: false,
},
],
},
];

const next = deriveDeterministicSettingApplication(settingsList, {
'ui@@dense-mode': true,
});

expect(next).toEqual({
sectionId: 'ui',
settingId: 'dense-mode',
value: false,
strategy: 'auto-derived',
});
});

it('returns null when no mutable setting kinds exist', () => {
const settingsList: ParsedCSSSettings[] = [
{
id: 'meta',
name: 'Meta',
collapsed: false,
settings: [
{
id: 'title',
title: 'Title',
type: SettingType.HEADING,
level: 2,
},
],
},
];

expect(deriveDeterministicSettingApplication(settingsList, {})).toBeNull();
});
});
