import { type App, PluginSettingTab, Setting } from "obsidian";
import type WebdavSync from "./main";

export interface WebdavSyncSettings {
	serverUrl: string;
	username: string;
	password: string;
}

export const DEFAULT_SETTINGS: WebdavSyncSettings = {
	serverUrl: "",
	username: "",
	password: "",
};

export class WebdavSyncSettingTab extends PluginSettingTab {
	plugin: WebdavSync;

	constructor(app: App, plugin: WebdavSync) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Server URL")
			.setDesc("The full URL to your WebDAV server")
			.addText((text) =>
				text
					.setPlaceholder("https://example.com/dav")
					.setValue(this.plugin.settings.serverUrl)
					.onChange(async (value) => {
						this.plugin.settings.serverUrl = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Username")
			.setDesc("WebDAV username")
			.addText((text) =>
				text
					.setPlaceholder("username")
					.setValue(this.plugin.settings.username)
					.onChange(async (value) => {
						this.plugin.settings.username = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Password")
			.setDesc("WebDAV password")
			.addText((text) =>
				text
					.setPlaceholder("password")
					.setValue(this.plugin.settings.password)
					.onChange(async (value) => {
						this.plugin.settings.password = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
