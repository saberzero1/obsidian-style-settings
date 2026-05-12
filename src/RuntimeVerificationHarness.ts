import {
DEFAULT_RUNTIME_VERIFICATION_MAPPING_SET,
RuntimeVerificationFixture,
RuntimeVerificationMappingSet,
RuntimeVerificationPayload,
RuntimeVerificationPropertyComparison,
RuntimeVerificationPropertySnapshot,
RuntimeVerificationSelectorProbe,
RuntimeVerificationSettingApplication,
buildSettingStorageKey,
didPropertySummaryChange,
deriveDeterministicSettingApplication,
summarizeObservedValues,
} from './RuntimeVerificationModel';
import { SettingValue } from './SettingsManager';
import CSSSettingsPlugin from './main';
import { MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';

const REQUIRED_STABLE_RENDER_PASSES = 2;

interface SelectorSnapshot {
groupId: string;
groupLabel: string;
selectorId: string;
selector: string;
pseudoElement?: string;
surface: string;
matchedNodeCount: number;
trackedProperties: RuntimeVerificationPropertySnapshot[];
diagnosticProperties: RuntimeVerificationPropertySnapshot[];
error?: string;
}

interface FixtureSnapshot {
fixtureId: string;
fixtureTitle: string;
fixturePath?: string;
surface: string;
viewType?: string;
status: 'ok' | 'missing-file' | 'open-error';
selectors: SelectorSnapshot[];
error?: string;
}

export interface RuntimeVerificationReport {
schemaVersion: 'runtime-verification-report.v1';
reportGeneratedAt: string;
mappingSet: {
id: string;
version: string;
title: string;
};
settingApplication:
| {
sectionId: string;
settingId: string;
storageKey: string;
value: SettingValue;
strategy: 'explicit' | 'auto-derived' | 'none';
}
| undefined;
fixtures: Array<{
fixtureId: string;
fixtureTitle: string;
fixturePath?: string;
surface: string;
viewType?: string;
status: 'ok' | 'missing-file' | 'open-error';
error?: string;
selectors: Array<{
groupId: string;
groupLabel: string;
selectorId: string;
selector: string;
surface: string;
pseudoElement?: string;
matchedNodeCountBaseline: number;
matchedNodeCountChanged: number;
observableInBaseline: boolean;
observableInChanged: boolean;
trackedProperties: RuntimeVerificationPropertyComparison[];
unexpectedChangedProperties: RuntimeVerificationPropertyComparison[];
error?: string;
}>;
}>;
summary: {
fixtureCount: number;
selectorCount: number;
observableSelectors: number;
unobservableSelectors: number;
selectorsWithTrackedPropertyChanges: number;
selectorsMatchedWithoutTrackedPropertyChanges: number;
};
}

export class RuntimeVerificationHarness {
constructor(private readonly plugin: CSSSettingsPlugin) {}

async run(payload?: RuntimeVerificationPayload): Promise<RuntimeVerificationReport> {
const mappingSet = payload?.mappingSet || DEFAULT_RUNTIME_VERIFICATION_MAPPING_SET;
const maxMatchedElementsPerSelector = Math.max(
1,
payload?.maxMatchedElementsPerSelector ?? 20
);
const stabilizationTimeoutMs = Math.max(
250,
payload?.stabilizationTimeoutMs ?? 4000
);
const originalSettings = { ...this.plugin.settingsManager.settings };

		const settingApplication = this.resolveSettingApplication(payload);
const baseline = await this.captureSnapshots(
mappingSet,
maxMatchedElementsPerSelector,
stabilizationTimeoutMs
);

if (settingApplication) {
await this.applySettingApplication(settingApplication);
}

const changed = await this.captureSnapshots(
mappingSet,
maxMatchedElementsPerSelector,
stabilizationTimeoutMs
);

await this.restoreSettings(originalSettings);

return this.buildReport(mappingSet, settingApplication, baseline, changed);
}

	private resolveSettingApplication(
		payload: RuntimeVerificationPayload | undefined
	): RuntimeVerificationSettingApplication | null {
if (payload?.settingApplication) {
return {
...payload.settingApplication,
strategy: 'explicit',
};
}

return deriveDeterministicSettingApplication(
this.plugin.settingsList,
this.plugin.settingsManager.settings
);
}

private async applySettingApplication(
settingApplication: RuntimeVerificationSettingApplication
) {
const storageKey = buildSettingStorageKey(
settingApplication.sectionId,
settingApplication.settingId,
settingApplication.modeVariant
);
const nextSettings = {
...this.plugin.settingsManager.settings,
[storageKey]: settingApplication.value,
};
await this.restoreSettings(nextSettings);
}

private async restoreSettings(nextSettings: Record<string, SettingValue>) {
this.plugin.settingsManager.settings = { ...nextSettings };
this.plugin.settingsManager.removeClasses();
this.plugin.settingsManager.initClasses();
await this.plugin.settingsManager.save();
}

private async captureSnapshots(
mappingSet: RuntimeVerificationMappingSet,
maxMatchedElementsPerSelector: number,
stabilizationTimeoutMs: number
): Promise<FixtureSnapshot[]> {
const snapshots: FixtureSnapshot[] = [];
for (const fixture of mappingSet.fixtures) {
snapshots.push(
await this.captureFixtureSnapshot(
fixture,
mappingSet,
maxMatchedElementsPerSelector,
stabilizationTimeoutMs
)
);
}
return snapshots;
}

private async captureFixtureSnapshot(
fixture: RuntimeVerificationFixture,
mappingSet: RuntimeVerificationMappingSet,
maxMatchedElementsPerSelector: number,
stabilizationTimeoutMs: number
): Promise<FixtureSnapshot> {
const openResult = await this.openFixture(fixture);
if (openResult.status !== 'ok') {
return {
fixtureId: fixture.id,
fixtureTitle: fixture.title,
fixturePath: openResult.fixturePath,
surface: fixture.surface,
viewType: openResult.viewType,
status: openResult.status,
error: openResult.error,
selectors: [],
};
}

await this.waitForRenderStability(openResult.surfaceRoot, stabilizationTimeoutMs);
const selectors: SelectorSnapshot[] = [];
for (const group of mappingSet.groups.filter((candidate) =>
candidate.fixtureIds.includes(fixture.id)
)) {
for (const selector of group.selectors) {
selectors.push(
this.captureSelectorSnapshot(
openResult.leaf,
selector,
group.id,
group.label,
fixture.surface,
maxMatchedElementsPerSelector
)
);
}
}

return {
fixtureId: fixture.id,
fixtureTitle: fixture.title,
fixturePath: openResult.fixturePath,
surface: fixture.surface,
viewType: openResult.viewType,
status: 'ok',
selectors,
};
}

private async openFixture(fixture: RuntimeVerificationFixture): Promise<{
status: 'ok' | 'missing-file' | 'open-error';
error?: string;
leaf: WorkspaceLeaf;
viewType?: string;
fixturePath?: string;
surfaceRoot: HTMLElement;
}> {
const leaf = this.plugin.app.workspace.getLeaf('tab');
const file = this.findFixtureFile(fixture);
if (!file) {
return {
status: 'missing-file',
error: `Fixture not found for candidate paths: ${fixture.candidatePaths.join(', ')}`,
leaf,
surfaceRoot: document.body,
};
}

try {
await leaf.openFile(file, { active: true, state: { mode: 'preview' } });
this.plugin.app.workspace.setActiveLeaf(leaf, { focus: false });
const markdownView = leaf.view as MarkdownView;
if ((markdownView as any)?.getMode?.() !== 'preview') {
(markdownView as any)?.setMode?.('preview');
}
return {
status: 'ok',
leaf,
fixturePath: file.path,
viewType: leaf.view.getViewType(),
surfaceRoot: this.resolveSurfaceRoot(leaf, fixture.surface),
};
} catch (error) {
return {
status: 'open-error',
error: error instanceof Error ? error.message : String(error),
leaf,
fixturePath: file.path,
viewType: leaf.view?.getViewType?.(),
surfaceRoot: document.body,
};
}
}

private resolveSurfaceRoot(
leaf: WorkspaceLeaf,
surface: string,
selectorSurface?: string
): HTMLElement {
if (selectorSurface === 'workspace' || surface === 'workspace') {
return document.body;
}

const container = leaf.view.containerEl;
if (selectorSurface === 'markdown-source' || surface === 'markdown-source') {
return (
(container.querySelector('.markdown-source-view') as HTMLElement | null) ||
(container.querySelector('.cm-editor') as HTMLElement | null) ||
container
);
}

return (
(container.querySelector('.markdown-preview-view') as HTMLElement | null) ||
(container.querySelector('.markdown-preview-sizer') as HTMLElement | null) ||
container
);
}

private captureSelectorSnapshot(
leaf: WorkspaceLeaf,
selector: RuntimeVerificationSelectorProbe,
groupId: string,
groupLabel: string,
fixtureSurface: string,
maxMatchedElementsPerSelector: number
): SelectorSnapshot {
const surface = selector.surface || fixtureSurface;
const root = this.resolveSurfaceRoot(leaf, fixtureSurface, surface);
const trackedProperties = selector.trackedProperties;
const diagnosticProperties = (selector.diagnosticProperties || []).filter(
(property) => !trackedProperties.includes(property)
);

try {
const matchedElements = Array.from(root.querySelectorAll(selector.selector)).slice(
0,
maxMatchedElementsPerSelector
);
const observedTracked = this.captureProperties(
matchedElements,
trackedProperties,
selector.pseudoElement
);
const observedDiagnostic = this.captureProperties(
matchedElements,
diagnosticProperties,
selector.pseudoElement
);
return {
groupId,
groupLabel,
selectorId: selector.id,
selector: selector.selector,
pseudoElement: selector.pseudoElement,
surface,
matchedNodeCount: matchedElements.length,
trackedProperties: observedTracked,
diagnosticProperties: observedDiagnostic,
};
} catch (error) {
return {
groupId,
groupLabel,
selectorId: selector.id,
selector: selector.selector,
pseudoElement: selector.pseudoElement,
surface,
matchedNodeCount: 0,
trackedProperties: [],
diagnosticProperties: [],
error: error instanceof Error ? error.message : String(error),
};
}
}

private captureProperties(
matchedElements: Element[],
properties: string[],
pseudoElement?: string
): RuntimeVerificationPropertySnapshot[] {
return properties.map((property) => {
const values = matchedElements.map((element) =>
getComputedStyle(element as Element, pseudoElement || null)
.getPropertyValue(property)
.trim()
);
return summarizeObservedValues(property, values);
});
}

private async waitForRenderStability(root: HTMLElement, timeoutMs: number) {
const start = Date.now();
let stablePasses = 0;
let lastSignature = '';
while (Date.now() - start < timeoutMs) {
await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
const signature = this.buildRenderSignature(root);
if (signature === lastSignature) {
stablePasses += 1;
} else {
stablePasses = 0;
lastSignature = signature;
}
			if (stablePasses >= REQUIRED_STABLE_RENDER_PASSES) {
				return;
			}
		}
}

private buildRenderSignature(root: HTMLElement): string {
const elementCount = root.querySelectorAll('*').length;
const textLength = root.textContent?.length || 0;
const visibleCount = root.querySelectorAll('.is-visible,.markdown-preview-sizer').length;
return `${elementCount}:${textLength}:${visibleCount}`;
}

private findFixtureFile(fixture: RuntimeVerificationFixture): TFile | null {
for (const candidatePath of fixture.candidatePaths) {
const resolved = this.plugin.app.vault.getAbstractFileByPath(candidatePath);
if (resolved instanceof TFile) {
return resolved;
}
}
return null;
}

private buildReport(
mappingSet: RuntimeVerificationMappingSet,
settingApplication: RuntimeVerificationSettingApplication | null,
baseline: FixtureSnapshot[],
changed: FixtureSnapshot[]
): RuntimeVerificationReport {
const changedByFixture = new Map(changed.map((fixture) => [fixture.fixtureId, fixture]));
const fixtureReports: RuntimeVerificationReport['fixtures'] = [];
let selectorCount = 0;
let observableSelectors = 0;
let selectorsWithTrackedPropertyChanges = 0;
let selectorsMatchedWithoutTrackedPropertyChanges = 0;

for (const baselineFixture of baseline) {
const changedFixture = changedByFixture.get(baselineFixture.fixtureId);
const changedSelectors = new Map(
(changedFixture?.selectors || []).map((selector) => [
`${selector.groupId}::${selector.selectorId}`,
selector,
])
);

const selectors: RuntimeVerificationReport['fixtures'][number]['selectors'] = [];
for (const baselineSelector of baselineFixture.selectors) {
selectorCount += 1;
const selectorKey = `${baselineSelector.groupId}::${baselineSelector.selectorId}`;
const changedSelector = changedSelectors.get(selectorKey);
const trackedProperties = this.compareProperties(
baselineSelector.trackedProperties,
changedSelector?.trackedProperties || []
);
const unexpectedChangedProperties = this.compareProperties(
baselineSelector.diagnosticProperties,
changedSelector?.diagnosticProperties || []
).filter((property) => property.changedFromBaseline);

const changedPropertyCount = trackedProperties.filter(
(property) => property.changedFromBaseline
).length;
const observed = baselineSelector.matchedNodeCount > 0;
if (observed) {
observableSelectors += 1;
if (changedPropertyCount > 0) {
selectorsWithTrackedPropertyChanges += 1;
} else {
selectorsMatchedWithoutTrackedPropertyChanges += 1;
}
}

selectors.push({
groupId: baselineSelector.groupId,
groupLabel: baselineSelector.groupLabel,
selectorId: baselineSelector.selectorId,
selector: baselineSelector.selector,
surface: baselineSelector.surface,
pseudoElement: baselineSelector.pseudoElement,
matchedNodeCountBaseline: baselineSelector.matchedNodeCount,
matchedNodeCountChanged: changedSelector?.matchedNodeCount || 0,
observableInBaseline: baselineSelector.matchedNodeCount > 0,
observableInChanged: (changedSelector?.matchedNodeCount || 0) > 0,
trackedProperties,
unexpectedChangedProperties,
error: baselineSelector.error || changedSelector?.error,
});
}

fixtureReports.push({
fixtureId: baselineFixture.fixtureId,
fixtureTitle: baselineFixture.fixtureTitle,
fixturePath: baselineFixture.fixturePath,
surface: baselineFixture.surface,
viewType: baselineFixture.viewType,
status: baselineFixture.status,
error: baselineFixture.error,
selectors,
});
}

return {
schemaVersion: 'runtime-verification-report.v1',
reportGeneratedAt: new Date().toISOString(),
mappingSet: {
id: mappingSet.id,
version: mappingSet.version,
title: mappingSet.title,
},
settingApplication: settingApplication
? {
sectionId: settingApplication.sectionId,
settingId: settingApplication.settingId,
storageKey: buildSettingStorageKey(
settingApplication.sectionId,
settingApplication.settingId,
settingApplication.modeVariant
),
value: settingApplication.value,
strategy: settingApplication.strategy,
}
: undefined,
fixtures: fixtureReports,
summary: {
fixtureCount: fixtureReports.length,
				selectorCount,
				observableSelectors,
				unobservableSelectors: selectorCount - observableSelectors,
				selectorsWithTrackedPropertyChanges,
				selectorsMatchedWithoutTrackedPropertyChanges,
			},
};
}

private compareProperties(
baseline: RuntimeVerificationPropertySnapshot[],
changed: RuntimeVerificationPropertySnapshot[]
): RuntimeVerificationPropertyComparison[] {
const changedByName = new Map(changed.map((property) => [property.property, property]));
return baseline.map((baselineProperty) => {
const changedProperty = changedByName.get(baselineProperty.property) || {
property: baselineProperty.property,
sampleCount: 0,
valueCounts: [],
};
return {
property: baselineProperty.property,
baseline: baselineProperty,
changed: changedProperty,
changedFromBaseline: didPropertySummaryChange(
baselineProperty,
changedProperty
),
};
});
}
}
