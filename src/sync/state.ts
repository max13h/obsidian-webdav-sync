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
	const file = app.vault.getFileByPath(stateFilePath(pluginDir));
	if (!file) return { ...EMPTY_STATE };

	try {
		const raw = await app.vault.read(file);
		return JSON.parse(raw);
	} catch {
		return { ...EMPTY_STATE };
	}
}

export async function saveState(app: App, pluginDir: string, state: SyncState): Promise<void> {
	const content = JSON.stringify(state, null, 2);
	const path = stateFilePath(pluginDir);
	const file = app.vault.getFileByPath(path);
	if (file) {
		await app.vault.modify(file, content);
	} else {
		await app.vault.create(path, content);
	}
}
