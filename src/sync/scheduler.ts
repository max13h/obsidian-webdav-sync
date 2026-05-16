import type { App, EventRef } from "obsidian";
import { type Logger, SILENT_LOGGER } from "../logger";
import type { WebdavSyncSettings } from "../settings";

export class Scheduler {
	private intervalId: number | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private modifyRef: EventRef | null = null;
	private syncing = false;

	constructor(
		private app: App,
		private syncFn: () => Promise<void>,
		private settings: WebdavSyncSettings,
		private logger: Logger = SILENT_LOGGER,
	) {}

	start(): void {
		if (this.settings.periodicSync) {
			const ms = this.settings.periodicSyncInterval * 60 * 1_000;
			this.logger.debug(`Scheduler: periodic sync every ${this.settings.periodicSyncInterval} min`);
			this.intervalId = window.setInterval(() => {
				if (!this.syncing) {
					this.logger.debug("Scheduler: periodic sync triggered");
					void this.syncFn();
				}
			}, ms);
		}

		this.modifyRef = this.app.vault.on("modify", () => {
			if (!this.settings.syncOnSave || this.syncing) return;
			if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
			this.debounceTimer = setTimeout(() => {
				this.logger.debug("Scheduler: on-save sync triggered");
				void this.syncFn();
			}, 5_000);
		});

		this.logger.debug(
			`Scheduler started (periodic: ${this.settings.periodicSync ? `${this.settings.periodicSyncInterval}min` : "off"}, on-save: ${this.settings.syncOnSave ? "on" : "off"})`,
		);
	}

	stop(): void {
		if (this.intervalId !== null) {
			window.clearInterval(this.intervalId);
			this.intervalId = null;
		}
		if (this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
		if (this.modifyRef !== null) {
			this.app.vault.offref(this.modifyRef);
			this.modifyRef = null;
		}
	}

	setSyncing(value: boolean): void {
		this.syncing = value;
		if (value && this.debounceTimer !== null) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}
}
