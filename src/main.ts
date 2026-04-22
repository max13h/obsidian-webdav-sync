import { Notice, Plugin } from "obsidian";
import { assertDefined } from "./errors";
import { DEFAULT_SETTINGS, type WebdavSyncSettings, WebdavSyncSettingTab } from "./settings";
import { SyncEngine } from "./sync/engine";
import { Scheduler } from "./sync/scheduler";
import { StatusBar } from "./ui/statusBar";
import { Client } from "./webdav/client";
import { patchWebdavFetch } from "./webdav/patcher";

export default class WebdavSync extends Plugin {
	settings: WebdavSyncSettings | undefined;
	client: Client | undefined;
	engine: SyncEngine | undefined;
	scheduler: Scheduler | undefined;
	statusBar: StatusBar | null = null;

	async onload() {
		patchWebdavFetch();
		await this.loadSettings();

		assertDefined(this.settings, "Failed to load WebDAV Sync settings.");

		this.initializeComponents(this.settings);
		this.registerCommands();
		this.addSettingTab(new WebdavSyncSettingTab(this.app, this));

		if (this.settings.syncOnStartup) {
			void this.runSync();
		}
	}

	private initializeComponents(settings: WebdavSyncSettings) {
		this.client = new Client(this.app, settings);
		this.engine = new SyncEngine(this.app, this.client, settings);

		if (settings.statusBarEnabled) {
			this.statusBar = new StatusBar(this);
		}

		this.scheduler = new Scheduler(this.app, () => this.runSync(), settings);
		this.scheduler.start();
	}

	private registerCommands() {
		this.addCommand({
			id: "webdav-sync",
			name: "Sync now",
			callback: () => void this.runSync(),
		});

		this.addCommand({
			id: "test-webdav-connection",
			name: "Test WebDAV connection",
			callback: async () => {
				assertDefined(this.client, "Failed to load WebDAV connection.");
				const success = await this.client.testConnection();
				new Notice(
					success
						? "WebDAV connection successful."
						: "WebDAV connection failed. Check your settings.",
				);
			},
		});
	}

	onunload() {
		assertDefined(this.scheduler, "Scheduler not initialized.");
		this.scheduler.stop();
	}

	async runSync(): Promise<void> {
		assertDefined(this.engine, "Sync engine not initialized.");
		assertDefined(this.settings, "Failed to load WebDAV Sync settings.");
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
