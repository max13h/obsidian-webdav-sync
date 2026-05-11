import type { App } from "obsidian";

export interface SyncFileEntry {
	localMtime: number;
	remoteMtime: number;
}

export class StateStore {
	lastSync = 0;
	files: Record<string, SyncFileEntry> = {};
	stateFilePath: string;

	constructor(
		private app: App,
		readonly pluginDir: string,
	) {
		this.stateFilePath = `${pluginDir}/state.json`;
	}

	async load(): Promise<void> {
		try {
			const raw = await this.app.vault.adapter.read(this.stateFilePath);
			const parsed = JSON.parse(raw);
			this.lastSync = parsed.lastSync ?? 0;
			this.files = parsed.files ?? {};
		} catch {
			this.lastSync = 0;
			this.files = {};
		}
	}

	async save(): Promise<void> {
		await this.app.vault.adapter.write(
			this.stateFilePath,
			JSON.stringify({ lastSync: this.lastSync, files: this.files }, null, 2),
		);
	}
}
