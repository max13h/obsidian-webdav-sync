import type { SyncState } from "../../src/sync/state";

export function makeState(files: SyncState["files"] = {}): SyncState {
	return { lastSync: 0, files };
}
