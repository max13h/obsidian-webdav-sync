import type { App, EventRef } from "obsidian";
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
	) {}

	start(): void {
		if (this.settings.periodicSync) {
			const ms = this.settings.periodicSyncInterval * 60 * 1_000;
			this.intervalId = window.setInterval(() => {
				if (!this.syncing) void this.syncFn();
			}, ms);
		}

		this.modifyRef = this.app.vault.on("modify", () => {
			if (!this.settings.syncOnSave || this.syncing) return;
			if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
			this.debounceTimer = setTimeout(() => void this.syncFn(), 5_000);
		});
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
