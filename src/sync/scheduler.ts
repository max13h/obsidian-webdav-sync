import type { App, EventRef } from "obsidian";
import type { WebdavSyncSettings } from "../settings";
import type { SyncEngine } from "./engine";

export class Scheduler {
	private intervalId: number | null = null;
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private modifyRef: EventRef | null = null;

	constructor(
		private app: App,
		private engine: SyncEngine,
		private settings: WebdavSyncSettings,
	) {}

	start(): void {
		if (this.settings.periodicSync) {
			const ms = this.settings.periodicSyncInterval * 60 * 1_000;
			this.intervalId = window.setInterval(() => void this.engine.sync(), ms);
		}

		if (this.settings.syncOnSave) {
			this.modifyRef = this.app.vault.on("modify", () => {
				if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
				this.debounceTimer = setTimeout(() => void this.engine.sync(), 5_000);
			});
		}
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
}
