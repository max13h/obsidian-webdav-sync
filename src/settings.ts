import { type App, Notice, PluginSettingTab, SecretComponent, Setting } from "obsidian";
import type WebdavSync from "./main";

export type SyncDirection = "two-way" | "local-to-remote" | "remote-to-local";
export type ConflictResolution = "remote-wins" | "local-wins" | "newest-wins" | "ask";
export type DeletionHandling = "mirror" | "never-delete-remote" | "never-delete-local";
export type SyncScope = "full-vault" | "exclude-obsidian" | "custom-folder" | "markdown-only";

export interface WebdavSyncSettings {
	// Connection
	serverUrl: string;
	remoteBasePath: string;
	username: string;
	passwordSecret: string;
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
	notificationsEnabled: boolean;
}

export const DEFAULT_SETTINGS: WebdavSyncSettings = {
	serverUrl: "",
	remoteBasePath: "",
	username: "",
	passwordSecret: "",
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
	notificationsEnabled: true,
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

		// --- Connection ---
		new Setting(containerEl).setName("Connection").setHeading();

		new Setting(containerEl)
			.setName("Server URL")
			.setDesc("Full URL to your WebDAV server (e.g. https://example.com/dav)")
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
			.setName("Remote base path")
			.setDesc("Optional sub-path on the server to sync into (e.g. /MyVault)")
			.addText((text) =>
				text
					.setPlaceholder("/MyVault")
					.setValue(this.plugin.settings.remoteBasePath)
					.onChange(async (value) => {
						this.plugin.settings.remoteBasePath = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Username").addText((text) =>
			text
				.setPlaceholder("username")
				.setValue(this.plugin.settings.username)
				.onChange(async (value) => {
					this.plugin.settings.username = value;
					await this.plugin.saveSettings();
				}),
		);

		new Setting(containerEl).setName("Password").addComponent((el) =>
			new SecretComponent(this.app, el)
				.setValue(this.plugin.settings.passwordSecret)
				.onChange(async (value) => {
					this.plugin.settings.passwordSecret = value;
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

		// --- Sync behavior ---
		new Setting(containerEl).setName("Sync behavior").setHeading();

		new Setting(containerEl).setName("Sync direction").addDropdown((dd) =>
			dd
				.addOption("two-way", "Two-way")
				.addOption("local-to-remote", "Local → Remote (push)")
				.addOption("remote-to-local", "Remote → Local (pull)")
				.setValue(this.plugin.settings.syncDirection)
				.onChange(async (value) => {
					this.plugin.settings.syncDirection = value as SyncDirection;
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
					.setValue(this.plugin.settings.conflictResolution)
					.onChange(async (value) => {
						this.plugin.settings.conflictResolution = value as ConflictResolution;
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
					.setValue(this.plugin.settings.deletionHandling)
					.onChange(async (value) => {
						this.plugin.settings.deletionHandling = value as DeletionHandling;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName("Sync scope").addDropdown((dd) =>
			dd
				.addOption("exclude-obsidian", "Entire vault (exclude .obsidian/)")
				.addOption("full-vault", "Entire vault (include .obsidian/)")
				.addOption("markdown-only", "Markdown files only")
				.addOption("custom-folder", "Custom folder")
				.setValue(this.plugin.settings.syncScope)
				.onChange(async (value) => {
					this.plugin.settings.syncScope = value as SyncScope;
					await this.plugin.saveSettings();
					this.display();
				}),
		);

		if (this.plugin.settings.syncScope === "custom-folder") {
			new Setting(containerEl)
				.setName("Folder to sync")
				.setDesc("Path relative to the vault root (e.g. Notes/Work)")
				.addText((text) =>
					text
						.setPlaceholder("Notes/Work")
						.setValue(this.plugin.settings.customSyncFolder)
						.onChange(async (value) => {
							this.plugin.settings.customSyncFolder = value;
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
				toggle.setValue(this.plugin.settings.syncOnStartup).onChange(async (value) => {
					this.plugin.settings.syncOnStartup = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Sync on file save")
			.setDesc("Trigger a sync a few seconds after a file is modified.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.syncOnSave).onChange(async (value) => {
					this.plugin.settings.syncOnSave = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Periodic sync")
			.setDesc("Automatically sync on a fixed interval.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.periodicSync).onChange(async (value) => {
					this.plugin.settings.periodicSync = value;
					await this.plugin.saveSettings();
					this.display();
				}),
			);

		if (this.plugin.settings.periodicSync) {
			new Setting(containerEl).setName("Sync interval (minutes)").addSlider((slider) =>
				slider
					.setLimits(1, 60, 1)
					.setValue(this.plugin.settings.periodicSyncInterval)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.periodicSyncInterval = value;
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
				toggle.setValue(this.plugin.settings.statusBarEnabled).onChange(async (value) => {
					this.plugin.settings.statusBarEnabled = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Notifications")
			.setDesc("Show a notice when sync completes or fails.")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.notificationsEnabled).onChange(async (value) => {
					this.plugin.settings.notificationsEnabled = value;
					await this.plugin.saveSettings();
				}),
			);
	}
}
