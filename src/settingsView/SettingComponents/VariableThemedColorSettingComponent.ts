import { resetTooltip, VariableThemedColor } from '../../SettingHandlers';
import {
	getDescription,
	getPickrSettings,
	getTitle,
	isValidDefaultColor,
	isValidSavedColor,
	onPickrCancel,
} from '../../Utils';
import { t } from '../../lang/helpers';
import { AbstractSettingComponent } from './AbstractSettingComponent';
import Pickr from '@simonwep/pickr';
import { ButtonComponent, Setting } from 'obsidian';

export class VariableThemedColorSettingComponent extends AbstractSettingComponent {
	settingEl: Setting;
	setting: VariableThemedColor;
	pickrLight: Pickr | null;
	pickrDark: Pickr | null;

	render(): void {
		if (!this.containerEl) return;
		const title = getTitle(this.setting);
		const description = getDescription(this.setting);

		if (
			typeof this.setting['default-light'] !== 'string' ||
			!isValidDefaultColor(this.setting['default-light'])
		) {
			return console.error(
				`${t('Error:')} ${title} ${t(
					'missing default light value, or value is not in a valid color format'
				)}`
			);
		}

		if (
			typeof this.setting['default-dark'] !== 'string' ||
			!isValidDefaultColor(this.setting['default-dark'])
		) {
			return console.error(
				`${t('Error:')} ${title} ${t(
					'missing default dark value, or value is not in a valid color format'
				)}`
			);
		}

		const idLight = `${this.setting.id}@@light`;
		const idDark = `${this.setting.id}@@dark`;
		const savedLight = this.settingsManager.getSetting(this.sectionId, idLight);
		const savedDark = this.settingsManager.getSetting(this.sectionId, idDark);
		const swatchesLight: string[] = [];
		const swatchesDark: string[] = [];

		if (this.setting['default-light']) {
			swatchesLight.push(this.setting['default-light']);
		}

		if (savedLight !== undefined) {
			swatchesLight.push(savedLight as string);
		}

		if (this.setting['default-dark']) {
			swatchesDark.push(this.setting['default-dark']);
		}

		if (savedDark !== undefined) {
			swatchesDark.push(savedDark as string);
		}

		this.settingEl = new Setting(this.containerEl);
		this.settingEl.setName(title);

		// Construct description
		this.settingEl.descEl.createSpan({}, (span) => {
			if (description) {
				span.appendChild(document.createTextNode(description));
			}
		});

		this.settingEl.descEl.createDiv({}, (div) => {
			div.createEl('small', {}, (sm) => {
				sm.appendChild(createEl('strong', { text: 'Default (light): ' }));
				sm.appendChild(document.createTextNode(this.setting['default-light']));
			});
			div.createEl('br');
			div.createEl('small', {}, (sm) => {
				sm.appendChild(createEl('strong', { text: 'Default (dark): ' }));
				sm.appendChild(document.createTextNode(this.setting['default-dark']));
			});
		});

		const wrapper = this.settingEl.controlEl.createDiv({
			cls: 'themed-color-wrapper',
		});

		// Create light color picker.
		// Pass savedLight as-is (undefined when unset) so that createColorPickerLight
		// can fall back to the correct default instead of receiving an empty string
		// which would cause the preview button to show an empty/black color (issue #53).
		this.createColorPickerLight(
			wrapper,
			this.containerEl,
			swatchesLight,
			savedLight as string | undefined,
			idLight
		);

		// Create dark color picker
		this.createColorPickerDark(
			wrapper,
			this.containerEl,
			swatchesDark,
			savedDark as string | undefined,
			idDark
		);

		this.settingEl.settingEl.dataset.id = this.setting.id;
	}

	destroy(): void {
		this.pickrLight?.destroyAndRemove();
		this.pickrDark?.destroyAndRemove();
		this.pickrLight = null;
		this.pickrDark = null;
		this.settingEl?.settingEl.remove();
	}

	private createColorPickerLight(
		wrapper: HTMLDivElement,
		containerEl: HTMLElement,
		swatchesLight: string[],
		valueLight: string | undefined,
		idLight: string
	) {
		const themeLightWrapper = wrapper.createDiv({ cls: 'theme-light' });

		// Validate saved color before using it; fall back to default for corrupt values.
		const displayColor =
			valueLight && isValidSavedColor(valueLight)
				? valueLight
				: this.setting['default-light'];

		// Scope --pcr-color to this picker's wrapper element so that multiple
		// themed-color pickers in the same container don't bleed into each other
		// (issues #168, #122).
		themeLightWrapper.style.setProperty('--pcr-color', displayColor);

		const pickerEl = themeLightWrapper.createDiv({ cls: 'picker' });
		const pickrLight = (this.pickrLight = Pickr.create(
			getPickrSettings({
				isView: this.isView,
				el: pickerEl,
				containerEl,
				swatches: swatchesLight,
				opacity: this.setting.opacity,
				defaultColor: displayColor,
			})
		));

		pickrLight.on('show', () => {
			const { result } = (pickrLight.getRoot() as any).interaction;
			activeWindow.requestAnimationFrame(() =>
				activeWindow.requestAnimationFrame(() => result.select())
			);
		});

		pickrLight.on('save', (color: Pickr.HSVaColor, instance: Pickr) =>
			this.onSave(idLight, color, instance, themeLightWrapper)
		);

		pickrLight.on('cancel', onPickrCancel);

		const themeLightReset = new ButtonComponent(
			themeLightWrapper.createDiv({ cls: 'pickr-reset' })
		);
		themeLightReset.setIcon('reset');
		themeLightReset.onClick(() => {
			const resetColor = this.setting['default-light'];
			pickrLight.setColor(resetColor);
			themeLightWrapper.style.setProperty('--pcr-color', resetColor);
			this.settingsManager.clearSetting(this.sectionId, idLight);
		});
		themeLightReset.setTooltip(resetTooltip);
	}

	private createColorPickerDark(
		wrapper: HTMLDivElement,
		containerEl: HTMLElement,
		swatchesDark: string[],
		valueDark: string | undefined,
		idDark: string
	) {
		const themeDarkWrapper = wrapper.createDiv({ cls: 'theme-dark' });

		// Validate saved color before using it; fall back to default for corrupt values.
		const displayColor =
			valueDark && isValidSavedColor(valueDark)
				? valueDark
				: this.setting['default-dark'];

		themeDarkWrapper.style.setProperty('--pcr-color', displayColor);

		const pickerEl = themeDarkWrapper.createDiv({ cls: 'picker' });
		const pickrDark = (this.pickrDark = Pickr.create(
			getPickrSettings({
				isView: this.isView,
				el: pickerEl,
				containerEl,
				swatches: swatchesDark,
				opacity: this.setting.opacity,
				defaultColor: displayColor,
			})
		));

		pickrDark.on('show', () => {
			const { result } = (pickrDark.getRoot() as any).interaction;
			activeWindow.requestAnimationFrame(() =>
				activeWindow.requestAnimationFrame(() => result.select())
			);
		});

		pickrDark.on('save', (color: Pickr.HSVaColor, instance: Pickr) =>
			this.onSave(idDark, color, instance, themeDarkWrapper)
		);

		pickrDark.on('cancel', onPickrCancel);

		const themeDarkReset = new ButtonComponent(
			themeDarkWrapper.createDiv({ cls: 'pickr-reset' })
		);
		themeDarkReset.setIcon('reset');
		themeDarkReset.onClick(() => {
			const resetColor = this.setting['default-dark'];
			pickrDark.setColor(resetColor);
			themeDarkWrapper.style.setProperty('--pcr-color', resetColor);
			this.settingsManager.clearSetting(this.sectionId, idDark);
		});
		themeDarkReset.setTooltip(resetTooltip);
	}

	private onSave(
		id: string,
		color: Pickr.HSVaColor,
		instance: Pickr,
		wrapperEl: HTMLElement
	) {
		if (!color) return;

		const hex = color.toHEXA().toString();

		// Discard corrupt values (e.g. "#NANNANNAN") that can result from
		// incomplete/malformed manual input (issue #151, #175).
		if (!isValidSavedColor(hex)) {
			console.warn(
				`Style Settings: discarding invalid color value "${hex}" for --${this.setting.id}`
			);
			instance.hide();
			return;
		}

		this.settingsManager.setSetting(this.sectionId, id, hex);
		wrapperEl.style.setProperty('--pcr-color', hex);

		instance.hide();
		instance.addSwatch(hex);
	}
}
