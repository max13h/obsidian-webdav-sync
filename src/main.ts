import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type WebdavSyncSettings, WebdavSyncSettingTab } from "./settings";
import { Client } from "./webdav/client";
import { patchWebdavFetch } from "./webdav/patcher";

export default class WebdavSync extends Plugin {
	settings!: WebdavSyncSettings;
	client!: Client;

	async onload() {
		await this.loadSettings();
		patchWebdavFetch();
		this.client = new Client(this.app, this.settings);

		this.addSettingTab(new WebdavSyncSettingTab(this.app, this));

		this.addCommand({
			id: "test-webdav-connection",
			name: "Test WebDAV Connection",
			callback: async () => {
				const success = await this.client.testConnection();
				console.log(success ? "WebDAV Connection Successful!" : "WebDAV Connection Failed.");
			},
		});
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<WebdavSyncSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
