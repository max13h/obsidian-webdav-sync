import { type App, Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import { assertDefined } from "./errors";
import type WebdavSync from "./main";
import { StatusBar } from "./ui/statusBar";
import { SyncIndicator } from "./ui/syncIndicator";

export type SyncDirection = "two-way" | "local-to-remote" | "remote-to-local";
export type ConflictResolution = "remote-wins" | "local-wins" | "newest-wins" | "ask";
export type DeletionHandling = "mirror" | "never-delete-remote" | "never-delete-local";
export type SyncScope = "full-vault" | "exclude-obsidian" | "custom-folder" | "markdown-only";
export type ListingDepth = "infinity" | "manual_1";
export type WebdavAuthType = "basic" | "digest";

export interface WebdavSyncSettings {
	// Connection
	serverUrl: string;
	remoteBasePath: string;
	username: string;
	passwordSecret: string;
	authType: WebdavAuthType;
	listingDepth: ListingDepth;
	// Sync behavior
	syncDirection: SyncDirection;
	conflictResolution: ConflictResolution;
	deletionHandling: DeletionHandling;
	syncScope: SyncScope;
	customSyncFolder: string;
	// Triggers
	syncOnStartup: boolean;
	syncOnSave: boolean;
	periodicSync: boolean;
	periodicSyncInterval: number;
	// Notifications
	statusBarEnabled: boolean;
	syncIndicatorEnabled: boolean;
	notificationsEnabled: boolean;
}

export const DEFAULT_SETTINGS: WebdavSyncSettings = {
	serverUrl: "",
	remoteBasePath: "",
	username: "",
	passwordSecret: "",
	authType: "basic",
	listingDepth: "infinity",
	syncDirection: "two-way",
	conflictResolution: "newest-wins",
	deletionHandling: "never-delete-remote",
	syncScope: "exclude-obsidian",
	customSyncFolder: "",
	syncOnStartup: false,
	syncOnSave: false,
	periodicSync: false,
	periodicSyncInterval: 5,
	statusBarEnabled: true,
	syncIndicatorEnabled: true,
	notificationsEnabled: true,
};

export class WebdavSyncSettingTab extends PluginSettingTab {
	plugin: WebdavSync;

	constructor(app: App, plugin: WebdavSync) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		assertDefined(this.plugin.settings, "Settings not initialized.");
		const settings = this.plugin.settings;
		const { containerEl } = this;
		containerEl.empty();

		// --- Connection ---
		new Setting(containerEl).setName("Connection").setHeading();

		new Setting(containerEl)
			.setName("Server URL")
			.setDesc("Full URL to your WebDAV server (e.g. https://example.com/dav)")
			.addText((text) =>
				text
					.setPlaceholder("https://example.com/dav")
					.setValue(settings.serverUrl)
					.onChange(async (value) => {
						settings.serverUrl = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Remote base path")
			.setDesc("Optional sub-path on the server to sync into (e.g. /MyVault)")
			.addText((text) =>
				text
					.setPlaceholder("/MyVault")
					.setValue(settings.remoteBasePath)
					.onChange(async (value) => {
						settings.remoteBasePath = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Username").addText((text) =>
			text
				.setPlaceholder("username")
				.setValue(settings.username)
				.onChange(async (value) => {
					settings.username = value;
					await this.plugin.saveSettings();
				}),
		);

		new Setting(containerEl).setName("Password").addComponent((el) =>
			new SecretComponent(this.app, el)
				.setValue(settings.passwordSecret)
				.onChange(async (value) => {
					settings.passwordSecret = value;
					await this.plugin.saveSettings();
				}),
		);

		new Setting(containerEl)
			.setName("Authentication type")
			.setDesc("Basic is standard. Use Digest only if your server requires it.")
			.addDropdown((dd) =>
				dd
					.addOption("basic", "Basic")
					.addOption("digest", "Digest")
					.setValue(settings.authType)
					.onChange(async (value) => {
						settings.authType = value as WebdavAuthType;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Test connection")
			.setDesc("Verify that the plugin can reach your WebDAV server.")
			.addButton((btn) =>
				btn
					.setButtonText("Test")
					.setCta()
					.onClick(async () => {
						assertDefined(this.plugin.client, "WebDAV client not initialized.");
						btn.setButtonText("Testing…").setDisabled(true);
						const success = await this.plugin.client.testConnection();
						btn.setDisabled(false);
						if (success) {
							btn.setButtonText("Connected !");
							new Notice("WebDAV connection successful.");
						} else {
							btn.setButtonText("Failed");
							new Notice("WebDAV connection failed. Check your settings.");
						}
					}),
			);

		new Setting(containerEl)
			.setName("Directory listing")
			.setDesc(
				"Recursive (Depth:infinity) is faster but rejected by some servers (e.g. Nginx). " +
					"Switch to BFS if you get errors on the first sync.",
			)
			.addDropdown((dd) =>
				dd
					.addOption("infinity", "Recursive (Depth:infinity)")
					.addOption("manual_1", "BFS (Depth:1 per folder)")
					.setValue(settings.listingDepth)
					.onChange(async (value) => {
						settings.listingDepth = value as ListingDepth;
						await this.plugin.saveSettings();
					}),
			);

		// --- Sync behavior ---
		new Setting(containerEl).setName("Sync behavior").setHeading();

		new Setting(containerEl).setName("Sync direction").addDropdown((dd) =>
			dd
				.addOption("two-way", "Two-way")
				.addOption("local-to-remote", "Local → Remote (push)")
				.addOption("remote-to-local", "Remote → Local (pull)")
				.setValue(settings.syncDirection)
				.onChange(async (value) => {
					settings.syncDirection = value as SyncDirection;
					await this.plugin.saveSettings();
				}),
		);

		new Setting(containerEl)
			.setName("Conflict resolution")
			.setDesc("What to do when the same file changed on both sides since the last sync.")
			.addDropdown((dd) =>
				dd
					.addOption("newest-wins", "Keep newest")
					.addOption("local-wins", "Local always wins")
					.addOption("remote-wins", "Remote always wins")
					.addOption("ask", "Ask me each time")
					.setValue(settings.conflictResolution)
					.onChange(async (value) => {
						settings.conflictResolution = value as ConflictResolution;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Deletion handling")
			.setDesc("What to do when a file is deleted on one side.")
			.addDropdown((dd) =>
				dd
					.addOption("never-delete-remote", "Never delete on remote")
					.addOption("never-delete-local", "Never delete locally")
					.addOption("mirror", "Mirror deletions on both sides")
					.setValue(settings.deletionHandling)
					.onChange(async (value) => {
						settings.deletionHandling = value as DeletionHandling;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Sync scope").addDropdown((dd) =>
			dd
				.addOption("exclude-obsidian", "Entire vault (exclude .obsidian/)")
				.addOption("full-vault", "Entire vault (include .obsidian/)")
				.addOption("markdown-only", "Markdown files only")
				.addOption("custom-folder", "Custom folder")
				.setValue(settings.syncScope)
				.onChange(async (value) => {
					settings.syncScope = value as SyncScope;
					await this.plugin.saveSettings();
					this.display();
				}),
		);

		if (settings.syncScope === "custom-folder") {
			new Setting(containerEl)
				.setName("Folder to sync")
				.setDesc("Path relative to the vault root (e.g. Notes/Work)")
				.addText((text) =>
					text
						.setPlaceholder("Notes/Work")
						.setValue(settings.customSyncFolder)
						.onChange(async (value) => {
							settings.customSyncFolder = value;
							await this.plugin.saveSettings();
						}),
				);
		}

		// --- Triggers ---
		new Setting(containerEl).setName("Triggers").setHeading();

		new Setting(containerEl)
			.setName("Sync on startup")
			.setDesc("Automatically sync when Obsidian starts.")
			.addToggle((toggle) =>
				toggle.setValue(settings.syncOnStartup).onChange(async (value) => {
					settings.syncOnStartup = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Sync on file save")
			.setDesc("Trigger a sync a few seconds after a file is modified.")
			.addToggle((toggle) =>
				toggle.setValue(settings.syncOnSave).onChange(async (value) => {
					settings.syncOnSave = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Periodic sync")
			.setDesc("Automatically sync on a fixed interval.")
			.addToggle((toggle) =>
				toggle.setValue(settings.periodicSync).onChange(async (value) => {
					settings.periodicSync = value;
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		if (settings.periodicSync) {
			new Setting(containerEl).setName("Sync interval (minutes)").addSlider((slider) =>
				slider
					.setLimits(1, 60, 1)
					.setValue(settings.periodicSyncInterval)
					.setDynamicTooltip()
					.onChange(async (value) => {
						settings.periodicSyncInterval = value;
						await this.plugin.saveSettings();
					}),
			);
		}

		// --- Notifications ---
		new Setting(containerEl).setName("Notifications").setHeading();

		new Setting(containerEl)
			.setName("Status bar")
			.setDesc("Show sync state in the status bar.")
			.addToggle((toggle) =>
				toggle.setValue(settings.statusBarEnabled).onChange(async (value) => {
					settings.statusBarEnabled = value;
					await this.plugin.saveSettings();
					if (value && this.plugin.store) {
						this.plugin.statusBar = new StatusBar(this.plugin, this.plugin.store);
					} else {
						this.plugin.statusBar?.destroy();
						this.plugin.statusBar = null;
					}
				}),
			);

		new Setting(containerEl)
			.setName("Toolbar sync indicator")
			.setDesc("Show a spinning icon in the toolbar while a sync is in progress.")
			.addToggle((toggle) =>
				toggle.setValue(settings.syncIndicatorEnabled).onChange(async (value) => {
					settings.syncIndicatorEnabled = value;
					await this.plugin.saveSettings();
					if (value) {
						this.plugin.syncIndicator = new SyncIndicator();
					} else {
						this.plugin.syncIndicator?.destroy();
						this.plugin.syncIndicator = null;
					}
				}),
			);

		new Setting(containerEl)
			.setName("Notifications")
			.setDesc("Show a notice when sync completes or fails.")
			.addToggle((toggle) =>
				toggle.setValue(settings.notificationsEnabled).onChange(async (value) => {
					settings.notificationsEnabled = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
