import {Plugin} from 'obsidian';
import {DEFAULT_SETTINGS, WebdavSyncSettings} from "./settings";

export default class WebdavSync extends Plugin {
	settings!: WebdavSyncSettings;

	async onload() {
		await this.loadSettings();
	}

	onunload() {
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData() as Partial<WebdavSyncSettings>);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
