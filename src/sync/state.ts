import type { App } from "obsidian";

const STATE_FILE = ".webdav-sync-state.json";

export interface SyncState {
	lastSync: number; // Unix ms
	files: Record<string, { localMtime: number; remoteMtime: number }>;
}

const EMPTY_STATE: SyncState = {
	lastSync: 0,
	files: {},
};

export async function loadState(app: App): Promise<SyncState> {
	const file = app.vault.getFileByPath(STATE_FILE);
	if (!file) return { ...EMPTY_STATE, files: {} };
	try {
		const raw = await app.vault.read(file);
		return JSON.parse(raw) as SyncState;
	} catch {
		return { ...EMPTY_STATE, files: {} };
	}
}

export async function saveState(app: App, state: SyncState): Promise<void> {
	const content = JSON.stringify(state, null, 2);
	const file = app.vault.getFileByPath(STATE_FILE);
	if (file) {
		await app.vault.modify(file, content);
	} else {
		await app.vault.create(STATE_FILE, content);
	}
}
