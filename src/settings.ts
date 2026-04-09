import { type App, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type WebdavSync from "./main";

export interface WebdavSyncSettings {
	serverUrl: string;
	username: string;
	passwordSecret: string;
}

export const DEFAULT_SETTINGS: WebdavSyncSettings = {
	serverUrl: "",
	username: "",
	passwordSecret: "",
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
			.addComponent((el) =>
				new SecretComponent(this.app, el)
					.setValue(this.plugin.settings.passwordSecret)
					.onChange(async (value) => {
						this.plugin.settings.passwordSecret = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
