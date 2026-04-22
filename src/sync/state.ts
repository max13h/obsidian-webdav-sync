import type { App } from "obsidian";

export interface SyncState {
	lastSync: number; // Unix ms
	files: Record<string, { localMtime: number; remoteMtime: number }>;
}

const EMPTY_STATE: SyncState = {
	lastSync: 0,
	files: {},
};

const stateFilePath = (pluginDir: string) => `${pluginDir}/state.json`;

export async function loadState(app: App, pluginDir: string): Promise<SyncState> {
	try {
		const raw = await app.vault.adapter.read(stateFilePath(pluginDir));
		return JSON.parse(raw);
	} catch {
		return { ...EMPTY_STATE };
	}
}

export async function saveState(app: App, pluginDir: string, state: SyncState): Promise<void> {
	state.lastSync = Date.now();
	await app.vault.adapter.write(stateFilePath(pluginDir), JSON.stringify(state, null, 2));
}
