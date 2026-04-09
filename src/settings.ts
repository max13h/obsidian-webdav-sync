import {App, PluginSettingTab, Setting} from "obsidian";
import WebdavSync from "./main";

export interface WebdavSyncSettings {
	mySetting: string;
}

export const DEFAULT_SETTINGS: WebdavSyncSettings = {
	mySetting: 'default'
}

export class WebdavSyncSettingTab extends PluginSettingTab {
	plugin: WebdavSync;

	constructor(app: App, plugin: WebdavSync) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Settings #1')
			.setDesc('It\'s a secret')
			.addText(text => text
				.setPlaceholder('Enter your secret')
				.setValue(this.plugin.settings.mySetting)
				.onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
