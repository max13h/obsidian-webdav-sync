import { Notice, Plugin } from "obsidian";
import { DEFAULT_SETTINGS, type WebdavSyncSettings, WebdavSyncSettingTab } from "./settings";
import { SyncEngine } from "./sync/engine";
import { Scheduler } from "./sync/scheduler";
import { StatusBar } from "./ui/statusBar";
import { Client } from "./webdav/client";
import { patchWebdavFetch } from "./webdav/patcher";

export default class WebdavSync extends Plugin {
	settings!: WebdavSyncSettings;
	client!: Client;
	engine!: SyncEngine;
	scheduler!: Scheduler;
	statusBar: StatusBar | null = null;

	async onload() {
		patchWebdavFetch();
		await this.loadSettings();

		this.client = new Client(this.app, this.settings);
		this.engine = new SyncEngine(this.app, this.client, this.settings);

		if (this.settings.statusBarEnabled) {
			this.statusBar = new StatusBar(this);
		}

		this.scheduler = new Scheduler(this.app, () => this.runSync(), this.settings);
		this.scheduler.start();

		this.addCommand({
			id: "webdav-sync",
			name: "Sync now",
			callback: () => void this.runSync(),
		});

		this.addCommand({
			id: "test-webdav-connection",
			name: "Test WebDAV connection",
			callback: async () => {
				const success = await this.client.testConnection();
				new Notice(
					success
						? "WebDAV connection successful."
						: "WebDAV connection failed. Check your settings.",
				);
			},
		});

		this.addSettingTab(new WebdavSyncSettingTab(this.app, this));

		if (this.settings.syncOnStartup) {
			void this.runSync();
		}
	}

	onunload() {
		this.scheduler.stop();
	}

	async runSync(): Promise<void> {
		this.statusBar?.setSyncing();
		try {
			await this.engine.sync();
			const now = Date.now();
			this.statusBar?.setIdle(now);
			if (this.settings.notificationsEnabled) {
				new Notice("WebDAV sync complete.");
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : "Unknown error";
			this.statusBar?.setError(message);
			if (this.settings.notificationsEnabled) {
				new Notice(`WebDAV sync failed: ${message}`);
			}
			console.error("[webdav-sync]", err);
		}
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
