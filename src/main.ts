import { Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type WebdavSyncSettings, WebdavSyncSettingTab } from "./settings";
import { Client } from "./webdav/client";

export default class WebdavSync extends Plugin {
	settings!: WebdavSyncSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new WebdavSyncSettingTab(this.app, this));

		this.addCommand({
			id: "test-webdav-connection",
			name: "Test WebDAV Connection",
			callback: async () => {
				const client = new Client(this.settings);
				const success = await client.testConnection();
				console.log(success ? "WebDAV Connection Successful!" : "WebDAV Connection Failed.");
			},
		});

		this.addCommand({
			id: "list-webdav-files",
			name: "List WebDAV Files",
			callback: async () => {
				const client = new Client(this.settings);
				try {
					const files = await client.listFiles();
					console.log("Files on server:", files);
				} catch (e) {
					console.error("Failed to list files:", e);
				}
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
