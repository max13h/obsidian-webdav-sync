import type { App, TFile } from "obsidian";
import type { FileStat } from "webdav";
import type { WebdavSyncSettings } from "../settings";
import type { Client } from "../webdav/client";
import type { SyncState } from "./state";
import { loadState, saveState } from "./state";

type UploadAction = { type: "upload"; local: TFile };
type DownloadAction = { type: "download"; remotePath: string; remoteMtime: number };
type ConflictAction = { type: "conflict"; local: TFile; remotePath: string; remoteMtime: number };
type DeleteRemoteAction = { type: "delete-remote"; remotePath: string };
type DeleteLocalAction = { type: "delete-local"; local: TFile };
type SkipAction = { type: "skip" };

type Action =
	| UploadAction
	| DownloadAction
	| ConflictAction
	| DeleteRemoteAction
	| DeleteLocalAction
	| SkipAction;

/**
 * Orchestrates a full sync run between the local Obsidian vault and the
 * WebDAV remote.
 *
 * Lifecycle of a single sync() call
 * ──────────────────────────────────
 *  1. loadState()        — read the last-known mtimes from .webdav-sync-state.json
 *  2. getLocalFiles()    — list vault files, filtered by syncScope setting
 *  3. listAllFiles("/")  — recursive WebDAV listing under remoteBasePath
 *  4. classify()         — for every path in the union of (local ∪ remote), produce exactly one Action
 *  5. execute()          — run each Action, mutating `state` in-place as it goes
 *  6. saveState()        — persist the updated state back to disk
 *
 * State is only saved if execute() completes without throwing, so a mid-sync
 * crash leaves the previous state intact (safe to retry).
 */
export class SyncEngine {
	constructor(
		private app: App,
		private client: Client,
		private settings: WebdavSyncSettings,
	) {}

	async sync(): Promise<void> {
		const state = await loadState(this.app);

		const localFiles = this.getLocalFiles();
		const remoteFiles = await this.client.listAllFiles("/");

		const localByPath = new Map(localFiles.map((f) => [f.path, f]));
		const remoteByPath = new Map(
			remoteFiles.map((f) => {
				const path = this.stripBasePath(f.filename);
				return [path, f];
			}),
		);

		const allPaths = new Set([...localByPath.keys(), ...remoteByPath.keys()]);
		const actions: Action[] = [];

		for (const path of allPaths) {
			const local = localByPath.get(path);
			const remote = remoteByPath.get(path);
			const tracked = state.files[path];
			actions.push(this.classify(path, local, remote, tracked));
		}

		await this.execute(actions, state);
		await saveState(this.app, state);
	}

	/**
	 * | tracked | local | remote | result                                    |
	 * |---------|-------|--------|-------------------------------------------|
	 * |   no    |  yes  |   no   | upload  (new local file)                  |
	 * |   no    |   no  |  yes   | download (new remote file)                |
	 * |   no    |  yes  |  yes   | conflict (both sides created same path)   |
	 * |  yes    |  yes  |  yes   | depends on mtime comparison (see below)   |
	 * |  yes    |  yes  |   no   | delete-remote (local deleted it remotely) |
	 * |  yes    |   no  |  yes   | delete-local  (remote deleted it locally) |
	 *
	 * For the tracked + both-exist case:
	 *   localChanged  = local.stat.mtime  > tracked.localMtime
	 *   remoteChanged = remoteMtime       > tracked.remoteMtime
	 *
	 *   localChanged && !remoteChanged  → upload
	 *   !localChanged && remoteChanged  → download
	 *   localChanged && remoteChanged   → conflict
	 *   !localChanged && !remoteChanged → skip
	 */
	private classify(
		_path: string,
		local: TFile | undefined,
		remote: FileStat | undefined,
		tracked: SyncState["files"][string] | undefined,
	): Action {
		const remoteMtime = remote ? new Date(remote.lastmod).getTime() : 0;

		if (!local && !remote) return { type: "skip" };

		if (local && remote) {
			if (!tracked) {
				// Both sides have the file, but we've never tracked it — treat as conflict
				return { type: "conflict", local, remotePath: remote.filename, remoteMtime };
			}
			const localChanged = local.stat.mtime > tracked.localMtime;
			const remoteChanged = remoteMtime > tracked.remoteMtime;
			if (!localChanged && !remoteChanged) return { type: "skip" };
			if (localChanged && !remoteChanged) return { type: "upload", local };
			if (!localChanged && remoteChanged)
				return { type: "download", remotePath: remote.filename, remoteMtime };
			// Both changed
			return { type: "conflict", local, remotePath: remote.filename, remoteMtime };
		}

		if (local && !remote) {
			if (!tracked) return { type: "upload", local };
			// File was tracked but is now gone remotely → remote deleted it
			return { type: "delete-local", local };
		}

		// !local && remote — remote is guaranteed non-undefined here (all other branches exhausted)
		if (!tracked) return { type: "download", remotePath: remote!.filename, remoteMtime };
		// File was tracked but is now gone locally → local deleted it
		return { type: "delete-remote", remotePath: remote!.filename };
	}

	/**
	 * Iterates the classified Actions and performs the actual I/O.
	 *
	 * Guards applied before executing each action:
	 *  - upload        → skipped when syncDirection === "remote-to-local"
	 *  - download      → skipped when syncDirection === "local-to-remote"
	 *  - delete-remote → skipped when syncDirection === "remote-to-local"
	 *                    OR deletionHandling !== "mirror"
	 *  - delete-local  → skipped when syncDirection === "local-to-remote"
	 *                    OR deletionHandling !== "mirror" (i.e. "never-delete-local")
	 *  - conflict      → delegated to resolveConflict()
	 *
	 * State entries are updated immediately after each successful action so
	 * that a partial run leaves state consistent with what was actually done.
	 */
	private async execute(actions: Action[], state: SyncState): Promise<void> {
		const { syncDirection, conflictResolution, deletionHandling } = this.settings;

		for (const action of actions) {
			if (action.type === "skip") continue;

			if (action.type === "upload") {
				if (syncDirection === "remote-to-local") continue;
				await this.upload(action.local, state);
			} else if (action.type === "download") {
				if (syncDirection === "local-to-remote") continue;
				await this.download(action.remotePath, action.remoteMtime, state);
			} else if (action.type === "conflict") {
				await this.resolveConflict(action, conflictResolution, syncDirection, state);
			} else if (action.type === "delete-remote") {
				if (syncDirection === "remote-to-local") continue;
				if (deletionHandling === "never-delete-remote") continue;
				const localPath = this.stripBasePath(action.remotePath);
				await this.client.deleteFile(localPath);
				delete state.files[localPath];
			} else if (action.type === "delete-local") {
				if (syncDirection === "local-to-remote") continue;
				if (deletionHandling === "never-delete-local") continue;
				await this.app.vault.delete(action.local);
				delete state.files[action.local.path];
			}
		}
	}

	/**
	 * Applies the conflictResolution strategy for a single conflicted file.
	 *
	 * If syncDirection is not "two-way", direction takes precedence:
	 *   "local-to-remote" → always upload
	 *   "remote-to-local" → always download
	 *
	 * Otherwise, the conflictResolution setting is used:
	 *   "local-wins"   → upload
	 *   "remote-wins"  → download
	 *   "newest-wins"  → upload if local.stat.mtime >= remoteMtime, else download
	 *   "ask"          → not yet implemented; falls back to newest-wins with a
	 *                    console warning. Will be replaced by ConflictModal in Step 7.
	 */
	private async resolveConflict(
		action: ConflictAction,
		resolution: WebdavSyncSettings["conflictResolution"],
		direction: WebdavSyncSettings["syncDirection"],
		state: SyncState,
	): Promise<void> {
		if (direction === "local-to-remote") {
			await this.upload(action.local, state);
			return;
		}
		if (direction === "remote-to-local") {
			await this.download(action.remotePath, action.remoteMtime, state);
			return;
		}

		// two-way: apply conflict resolution strategy
		if (resolution === "local-wins") {
			await this.upload(action.local, state);
		} else if (resolution === "remote-wins") {
			await this.download(action.remotePath, action.remoteMtime, state);
		} else if (resolution === "newest-wins") {
			if (action.local.stat.mtime >= action.remoteMtime) {
				await this.upload(action.local, state);
			} else {
				await this.download(action.remotePath, action.remoteMtime, state);
			}
		} else {
			// "ask" — not yet implemented, fall back to newest-wins
			// TODO: integrate ConflictModal when available
			console.warn(
				`[webdav-sync] Conflict on ${action.local.path} — ask mode not yet implemented, using newest-wins`,
			);
			if (action.local.stat.mtime >= action.remoteMtime) {
				await this.upload(action.local, state);
			} else {
				await this.download(action.remotePath, action.remoteMtime, state);
			}
		}
	}

	/**
	 * Reads the local file binary, ensures the remote parent directory exists,
	 * uploads the content, and updates state.files[path] with the new mtimes.
	 *
	 * After upload, both localMtime and remoteMtime in state are set to
	 * local.stat.mtime so the next classify() sees no delta on either side.
	 */
	private async upload(file: TFile, state: SyncState): Promise<void> {
		const dir = file.parent?.path;
		if (dir) await this.client.ensureDirectory(dir);
		const content = await this.app.vault.readBinary(file);
		await this.client.uploadFile(file.path, content);
		const entry = state.files[file.path] ?? { localMtime: 0, remoteMtime: 0 };
		state.files[file.path] = {
			...entry,
			localMtime: file.stat.mtime,
			remoteMtime: file.stat.mtime,
		};
	}

	/**
	 * Downloads the remote file binary, writes it to the local vault (creating
	 * intermediate folders if needed), and updates state.files[path].
	 *
	 * After download, both localMtime and remoteMtime in state are set to
	 * remoteMtime so the next classify() sees no delta on either side.
	 *
	 * @param remotePath Absolute path as returned by the WebDAV server.
	 * @param remoteMtime Remote last-modified time in Unix ms.
	 * @param state
	 */
	private async download(remotePath: string, remoteMtime: number, state: SyncState): Promise<void> {
		const localPath = this.stripBasePath(remotePath);
		const content = await this.client.downloadFile(localPath);
		const file = this.app.vault.getFileByPath(localPath);
		if (file) {
			await this.app.vault.modifyBinary(file, content);
		} else {
			const dir = localPath.split("/").slice(0, -1).join("/");
			if (dir) await this.app.vault.createFolder(dir).catch(() => {});
			await this.app.vault.createBinary(localPath, content);
		}
		const entry = state.files[localPath] ?? { localMtime: 0, remoteMtime: 0 };
		state.files[localPath] = { ...entry, localMtime: remoteMtime, remoteMtime };
	}

	/**
	 * Returns the subset of vault files that fall within the configured syncScope:
	 *   "full-vault"       → all files
	 *   "exclude-obsidian" → all files except those under .obsidian/
	 *   "markdown-only"    → only .md files
	 *   "custom-folder"    → only files whose path starts with customSyncFolder/
	 */
	private getLocalFiles(): TFile[] {
		const { syncScope, customSyncFolder } = this.settings;
		return this.app.vault.getFiles().filter((file) => {
			if (syncScope === "full-vault") return true;
			if (syncScope === "exclude-obsidian") return !file.path.startsWith(".obsidian/");
			if (syncScope === "markdown-only") return file.extension === "md";
			if (syncScope === "custom-folder") return file.path.startsWith(`${customSyncFolder}/`);
			return true;
		});
	}

	/**
	 * Strips the remoteBasePath prefix from an absolute remote path,
	 * returning the vault-relative path used as the canonical key everywhere
	 * (in state.files, local TFile.path, and action objects).
	 *
	 * Example:
	 *   remoteBasePath = "/MyVault"
	 *   remotePath     = "/MyVault/Notes/foo.md"
	 *   result         = "Notes/foo.md"
	 */
	private stripBasePath(remotePath: string): string {
		const base = this.settings.remoteBasePath.replace(/\/$/, "");
		if (base && remotePath.startsWith(base)) {
			return remotePath.slice(base.length).replace(/^\//, "");
		}
		return remotePath.replace(/^\//, "");
	}
}
