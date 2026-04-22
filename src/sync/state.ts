import type { App } from "obsidian";

export interface SyncFileEntry {
	localMtime: number;
	remoteMtime: number;
}

const stateFilePath = (pluginDir: string) => `${pluginDir}/state.json`;

export class StateStore {
	lastSync = 0;
	files: Record<string, SyncFileEntry> = {};

	constructor(
		private app: App,
		private pluginDir: string,
	) {}

	async load(): Promise<void> {
		try {
			const raw = await this.app.vault.adapter.read(stateFilePath(this.pluginDir));
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
			stateFilePath(this.pluginDir),
			JSON.stringify({ lastSync: this.lastSync, files: this.files }, null, 2),
		);
	}
}
