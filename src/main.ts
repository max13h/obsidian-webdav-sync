import { Notice, Plugin } from "obsidian";
import { assertDefined } from "./errors";
import { DEFAULT_SETTINGS, type WebdavSyncSettings, WebdavSyncSettingTab } from "./settings";
import { SyncEngine } from "./sync/engine";
import { Scheduler } from "./sync/scheduler";
import { StateStore } from "./sync/state";
import { StatusBar } from "./ui/statusBar";
import { SyncIndicator } from "./ui/syncIndicator";
import { Client } from "./webdav/client";
import { patchWebdavFetch } from "./webdav/patcher";

export default class WebdavSync extends Plugin {
	settings: WebdavSyncSettings | undefined;
	store: StateStore | undefined;
	client: Client | undefined;
	engine: SyncEngine | undefined;
	scheduler: Scheduler | undefined;
	statusBar: StatusBar | null = null;
	syncIndicator: SyncIndicator | null = null;

	async onload() {
		patchWebdavFetch();
		await this.loadSettings();

		assertDefined(this.settings, "Failed to load WebDAV Sync settings.");

		this.store = new StateStore(this.app, this.manifest.dir ?? ".obsidian/webdav-sync/");
		await this.store.load();

		this.client = new Client(this.app, this.settings);
		this.engine = new SyncEngine(this.app, this.client, this.settings, this.store);
		this.scheduler = new Scheduler(this.app, () => this.runSync(), this.settings);

		this.registerCommandsAndSettings();

		this.app.workspace.onLayoutReady(() => {
			assertDefined(this.scheduler, "Scheduler not initialized.");
			this.scheduler.start();
			assertDefined(this.engine, "Sync engine not initialized.");
			this.engine.registerVaultEvents(this.registerEvent.bind(this));
			if (this.settings?.syncOnStartup) void this.runSync();
		});
	}

	onunload() {
		assertDefined(this.scheduler, "Scheduler not initialized.");
		this.scheduler.stop();
	}

	public async saveSettings() {
		await this.saveData(this.settings);
	}

	private registerCommandsAndSettings() {
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

		this.addSettingTab(new WebdavSyncSettingTab(this.app, this));

		if (this.settings?.statusBarEnabled) {
			assertDefined(this.store, "StateStore not initialized.");
			this.statusBar = new StatusBar(this, this.store);
		}
		if (this.settings?.syncIndicatorEnabled) {
			this.syncIndicator = new SyncIndicator();
		}
	}

	private async runSync(): Promise<void> {
		assertDefined(this.engine, "Sync engine not initialized.");
		assertDefined(this.settings, "Failed to load WebDAV Sync settings.");
		this.scheduler?.setSyncing(true);
		this.statusBar?.setSyncing();
		this.syncIndicator?.setSyncing();
		try {
			await this.engine.sync();
			const now = Date.now();
			this.statusBar?.setIdle(now);
			this.syncIndicator?.setIdle();
			if (this.settings.notificationsEnabled) {
				new Notice("WebDAV sync complete.");
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : "Unknown error";
			this.statusBar?.setError(message);
			this.syncIndicator?.setIdle();
			if (this.settings.notificationsEnabled) {
				new Notice(`WebDAV sync failed: ${message}`);
			}
			console.error("[webdav-sync]", err);
		} finally {
			this.scheduler?.setSyncing(false);
		}
	}

	private async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<WebdavSyncSettings>,
		);
	}
}
