import { ClassToggle, ParsedCSSSettings } from './SettingHandlers';
import { CSSSettingsManager } from './SettingsManager';
import {
	NormalizedStyleSettingsSchema,
	buildNormalizedStyleSettingsSchema,
	finalizeParsedStyleSettings,
	parseStyleSettingsStylesheetText,
} from './StyleSettingsParser';
import { RuntimeVerificationHarness } from './RuntimeVerificationHarness';
import { RuntimeVerificationPayload } from './RuntimeVerificationModel';
import {
	ErrorList,
	getDescription,
	getTitle,
	SettingsSeachResource,
} from './Utils';
import './css/pickerOverrides.css';
import './css/settings.css';
import { CSSSettingsTab } from './settingsView/CSSSettingsTab';
import { SettingType } from './settingsView/SettingComponents/types';
import { SettingsView, viewType } from './settingsView/SettingsView';
import '@simonwep/pickr/dist/themes/nano.min.css';
import { Command, Notice, Plugin } from 'obsidian';

export default class CSSSettingsPlugin extends Plugin {
	settingsManager: CSSSettingsManager;
	settingsTab: CSSSettingsTab;
	settingsList: ParsedCSSSettings[] = [];
	errorList: ErrorList = [];
	commandList: Command[] = [];
	normalizedSchema: NormalizedStyleSettingsSchema | null = null;
	lightEl: HTMLElement;
	darkEl: HTMLElement;

	async onload() {
		this.settingsManager = new CSSSettingsManager(this);

		await this.settingsManager.load();

		this.settingsTab = new CSSSettingsTab(this.app, this);

		this.addSettingTab(this.settingsTab);

		this.registerView(viewType, (leaf) => new SettingsView(this, leaf));

		this.addCommand({
			id: 'show-style-settings-leaf',
			name: 'Show style settings view',
			callback: () => {
				this.activateView();
			},
		});

		this.addCommand({
			id: 'copy-normalized-style-settings-schema',
			name: 'Copy normalized Style Settings schema JSON',
			callback: async () => {
				await this.copyParsedSettingsSchema();
			},
		});

		this.addCommand({
			id: 'copy-runtime-verification-report',
			name: 'Copy runtime verification report JSON',
			callback: async () => {
				await this.copyRuntimeVerificationReport();
			},
		});

		this.registerEvent(
			(this.app.workspace as any).on(
				'css-change',
				(data?: { source: string }) => {
					if (data?.source !== 'style-settings') {
						this.parseCSS();
					}
				}
			)
		);

		this.registerEvent(
			(this.app.workspace as any).on('parse-style-settings', () => {
				this.parseCSS();
			})
		);

		this.lightEl = document.body.createDiv('theme-light style-settings-ref');
		this.darkEl = document.body.createDiv('theme-dark style-settings-ref');

		document.body.classList.add('css-settings-manager');

		this.parseCSS();

		this.app.workspace.onLayoutReady(() => {
			if (this.settingsList) {
				this.app.workspace.getLeavesOfType(viewType).forEach((leaf) => {
					(leaf.view as SettingsView).setSettings(
						this.settingsList,
						this.errorList
					);
				});
			}
		});
	}

	getCSSVar(id: string) {
		const light = getComputedStyle(this.lightEl).getPropertyValue(`--${id}`);
		const dark = getComputedStyle(this.darkEl).getPropertyValue(`--${id}`);
		const current = getComputedStyle(document.body).getPropertyValue(`--${id}`);
		return { light, dark, current };
	}

	debounceTimer = 0;

	parseCSS() {
		clearTimeout(this.debounceTimer);
		this.debounceTimer = activeWindow.setTimeout(() => {
			const parsedSettings: ParsedCSSSettings[] = [];
			const diagnostics: ErrorList = [];

			// remove registered theme commands (sadly undocumented API)
			for (const command of this.commandList) {
				// @ts-ignore
				this.app.commands.removeCommand(command.id);
			}

			this.commandList = [];
			this.settingsManager.removeClasses();

			const styleSheets = document.styleSheets;

			for (let i = 0, len = styleSheets.length; i < len; i++) {
				const sheet = styleSheets.item(i);
				if (!sheet) continue;
				const parsed = this.parseCSSStyleSheet(sheet);
				parsedSettings.push(...parsed.sections);
				diagnostics.push(...parsed.diagnostics);
			}

			const finalized = finalizeParsedStyleSettings({
				sections: parsedSettings,
				diagnostics,
			});
			this.settingsList = finalized.sections;
			this.errorList = finalized.diagnostics;
			this.normalizedSchema = buildNormalizedStyleSettingsSchema(finalized);

			// compatability with Settings Search Plugin
			this.registerSettingsToSettingsSearch();

			this.settingsTab.setSettings(this.settingsList, this.errorList);
			this.app.workspace.getLeavesOfType(viewType).forEach((leaf) => {
				(leaf.view as SettingsView).setSettings(
					this.settingsList,
					this.errorList
				);
			});
			this.settingsManager.setConfig(this.settingsList);
			this.settingsManager.initClasses();
			this.registerSettingCommands();
		}, 100);
	}

	getParsedSettingsSchema() {
		return (
			this.normalizedSchema ||
			buildNormalizedStyleSettingsSchema({ sections: [], diagnostics: [] })
		);
	}

	/**
	 * Registers the current settings to the settings search plugin.
	 * It also unregisters the old settings.
	 *
	 * @private
	 */
	private registerSettingsToSettingsSearch() {
		const onSettingsSearchLoaded = () => {
			if ((window as any).SettingsSearch) {
				const settingsSearch: any = (window as any).SettingsSearch;

				settingsSearch.removeTabResources('obsidian-style-settings');

				for (const parsedCSSSetting of this.settingsList) {
					settingsSearch.addResources(
						...parsedCSSSetting.settings.map((x) => {
							const settingsSearchResource: SettingsSeachResource = {
								tab: 'obsidian-style-settings',
								name: 'Style Settings',
								text: getTitle(x) ?? '',
								desc: getDescription(x) ?? '',
							};
							return settingsSearchResource;
						})
					);
				}
			}
		};

		// @ts-ignore TODO: expand obsidian types, so that the ts-ignore is not needed
		if (this.app.plugins.plugins['settings-search']?.loaded) {
			onSettingsSearchLoaded();
		} else {
			// @ts-ignore
			this.app.workspace.on('settings-search-loaded', () => {
				onSettingsSearchLoaded();
			});
		}
	}

	/**
	 * Remove any settings from settings search if settings search is loaded.
	 *
	 * @private
	 */
	private unregisterSettingsFromSettingsSearch() {
		// @ts-ignore TODO: expand obsidian types, so that the ts-ignore is not needed
		if (this.app.plugins.plugins['settings-search']?.loaded) {
			// @ts-ignore
			window.SettingsSearch.removeTabResources('obsidian-style-settings');
		}
	}

	/**
	 * Parses the settings from a css style sheet.
	 * Adds the parsed settings to `settingsList` and any errors to `errorList`.
	 *
	 * @param sheet the stylesheet to parse
	 * @private
	 */
	private parseCSSStyleSheet(sheet: CSSStyleSheet) {
		const text = sheet?.ownerNode?.textContent?.trim();
		if (!text) return { sections: [], diagnostics: [] };

		return parseStyleSettingsStylesheetText(text, this.getStyleSheetSource(sheet));
	}

	private registerSettingCommands(): void {
		for (const section of this.settingsList) {
			for (const setting of section.settings) {
				if (
					setting.type === SettingType.CLASS_TOGGLE &&
					(setting as ClassToggle).addCommand
				) {
					this.addClassToggleCommand(section, setting as ClassToggle);
				}
			}
		}
	}

	private addClassToggleCommand(
		section: ParsedCSSSettings,
		setting: ClassToggle
	): void {
		this.commandList.push(
			this.addCommand({
				id: `style-settings-class-toggle-${section.id}-${setting.id}`,
				name: `Toggle ${setting.title}`,
				callback: () => {
					const value = !(this.settingsManager.getSetting(
						section.id,
						setting.id
					) as boolean);
					this.settingsManager.setSetting(section.id, setting.id, value);
					this.settingsTab.rerender();
					for (const leaf of this.app.workspace.getLeavesOfType(viewType)) {
						(leaf.view as SettingsView).rerender();
					}
				},
			})
		);
	}

	onunload() {
		this.lightEl.remove();
		this.darkEl.remove();

		document.body.classList.remove('css-settings-manager');

		this.settingsManager.cleanup();
		this.deactivateView();
		this.unregisterSettingsFromSettingsSearch();
	}

	private async copyParsedSettingsSchema() {
		const schemaJson = JSON.stringify(this.getParsedSettingsSchema(), null, 2);
		const copied = await this.writeToClipboard(schemaJson);
		if (copied) {
			console.info('Style Settings schema export', this.getParsedSettingsSchema());
			new Notice('Copied normalized Style Settings schema JSON');
		} else {
			new Notice('Failed to copy normalized Style Settings schema JSON');
		}
	}

	async runRuntimeVerification(payload?: RuntimeVerificationPayload) {
		const harness = new RuntimeVerificationHarness(this);
		return harness.run(payload);
	}

	private async copyRuntimeVerificationReport() {
		const report = await this.runRuntimeVerification();
		const reportJson = JSON.stringify(report, null, 2);
		const copied = await this.writeToClipboard(reportJson);
		if (copied) {
			console.info('Style Settings runtime verification report', report);
			new Notice('Copied runtime verification report JSON');
		} else {
			new Notice('Failed to copy runtime verification report JSON');
		}
	}

	private async writeToClipboard(text: string): Promise<boolean> {
		try {
			if (navigator.clipboard?.writeText) {
				await navigator.clipboard.writeText(text);
				return true;
			}

			const textarea = document.createElement('textarea');
			textarea.value = text;
			textarea.style.position = 'fixed';
			textarea.style.opacity = '0';
			document.body.appendChild(textarea);
			textarea.select();
			// Deprecated fallback retained for older desktop/webview environments where
			// navigator.clipboard.writeText is unavailable or rejects despite copy still being allowed.
			const copied = document.execCommand('copy');
			textarea.remove();
			return copied;
		} catch (error) {
			console.error('Style Settings | Failed to copy schema JSON', error);
			return false;
		}
	}

	private getStyleSheetSource(sheet: CSSStyleSheet) {
		const ownerNode = sheet.ownerNode as HTMLElement | null;
		const stylesheetHref =
			sheet.href ||
			(ownerNode instanceof HTMLLinkElement ? ownerNode.href : undefined) ||
			ownerNode?.getAttribute?.('href') ||
			undefined;
		const sourceName =
			stylesheetHref?.split('/').pop() ||
			ownerNode?.getAttribute?.('data-source') ||
			ownerNode?.id ||
			ownerNode?.tagName?.toLowerCase() ||
			'inline-stylesheet';

		return {
			sourceName,
			stylesheetHref,
		};
	}

	deactivateView() {
		this.app.workspace.detachLeavesOfType(viewType);
	}

	async activateView() {
		this.deactivateView();
		const leaf = this.app.workspace.getLeaf('tab');

		await leaf.setViewState({
			type: viewType,
			active: true,
		});

		(leaf.view as SettingsView).setSettings(this.settingsList, this.errorList);
	}
}
