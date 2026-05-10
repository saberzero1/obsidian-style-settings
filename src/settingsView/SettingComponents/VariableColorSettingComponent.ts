import { resetTooltip, VariableColor } from '../../SettingHandlers';
import {
	createDescription,
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
import { Setting } from 'obsidian';

export class VariableColorSettingComponent extends AbstractSettingComponent {
	settingEl: Setting;
	setting: VariableColor;
	pickr: Pickr | null;

	render(): void {
		if (!this.containerEl) return;
		const title = getTitle(this.setting);
		const description = getDescription(this.setting);

		if (
			typeof this.setting.default !== 'string' ||
			!isValidDefaultColor(this.setting.default)
		) {
			this.setting.default = this.settingsManager.plugin
				.getCSSVar(this.setting.id)
				.current?.trim();
		}

		if (
			typeof this.setting.default !== 'string' ||
			!isValidDefaultColor(this.setting.default)
		) {
			return console.error(
				`${t('Error:')} ${title} ${t(
					'missing default value, or value is not in a valid color format'
				)}`
			);
		}

		const value = this.settingsManager.getSetting(
			this.sectionId,
			this.setting.id
		);
		const swatches: string[] = [];

		if (this.setting.default) {
			swatches.push(this.setting.default);
		}

		if (value !== undefined) {
			swatches.push(value as string);
		}

		this.settingEl = new Setting(this.containerEl);
		this.settingEl.setName(title);
		this.settingEl.setDesc(
			createDescription(description, this.setting.default)
		);

		// Determine the color to display initially.
		// Validate the saved value before using it to avoid displaying corrupt state.
		const savedValue = value !== undefined ? (value as string) : undefined;
		const displayColor =
			savedValue && isValidSavedColor(savedValue)
				? savedValue
				: this.setting.default;

		// Create the picker wrapper element first so we can scope --pcr-color
		// to this specific picker, preventing shared-container bleed that causes
		// all pickers to show the same color (issues #168, #122).
		const pickerEl = this.settingEl.controlEl.createDiv({ cls: 'picker' });
		pickerEl.style.setProperty('--pcr-color', displayColor);

		const pickr = (this.pickr = Pickr.create(
			getPickrSettings({
				isView: this.isView,
				el: pickerEl,
				containerEl: this.containerEl,
				swatches: swatches,
				opacity: this.setting.opacity,
				defaultColor: displayColor,
			})
		));

		pickr.on('save', (color: Pickr.HSVaColor, instance: Pickr) => {
			if (!color) return;

			const hex = color.toHEXA().toString();

			// Guard against NaN values produced by an incomplete/malformed manual
			// input (issue #151: "NANNANNAN" appearing in styles).
			if (!isValidSavedColor(hex)) {
				console.warn(
					`Style Settings: discarding invalid color value "${hex}" for --${this.setting.id}`
				);
				instance.hide();
				return;
			}

			this.settingsManager.setSetting(
				this.sectionId,
				this.setting.id,
				hex
			);
			pickerEl.style.setProperty('--pcr-color', hex);

			instance.hide();
			instance.addSwatch(hex);
		});

		pickr.on('show', () => {
			const { result } = (pickr.getRoot() as any).interaction;
			activeWindow.requestAnimationFrame(() => {
				activeWindow.requestAnimationFrame(() => result.select());
			});
		});

		pickr.on('cancel', onPickrCancel);

		this.settingEl.addExtraButton((b) => {
			b.setIcon('reset');
			b.onClick(() => {
				const resetColor = this.setting.default || null;
				pickr.setColor(resetColor);
				// Also update --pcr-color so the button preview reflects the reset
				// immediately, even before the picker is reopened (issue #53, #64).
				if (resetColor) {
					pickerEl.style.setProperty('--pcr-color', resetColor);
				}
				this.settingsManager.clearSetting(this.sectionId, this.setting.id);
			});
			b.setTooltip(resetTooltip);
		});

		this.settingEl.settingEl.dataset.id = this.setting.id;
	}

	destroy(): void {
		this.pickr?.destroyAndRemove();
		this.pickr = null;
		this.settingEl?.settingEl.remove();
	}
}
