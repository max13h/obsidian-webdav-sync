import type { App, EventRef } from "obsidian";
import { Notice, TFile, TFolder } from "obsidian";
import type { FileStat } from "webdav";
import { type Logger, SILENT_LOGGER } from "../logger";
import type { WebdavSyncSettings } from "../settings";
import { type ConflictChoice, ConflictModal } from "../ui/conflictModal";
import type { Client } from "../webdav/client";
import type { StateStore, SyncFileEntry } from "./state";

export type ConflictResolver = (
	path: string,
	localMtime: number,
	remoteMtime: number,
	localContent: ArrayBuffer,
	remoteContent: ArrayBuffer,
) => Promise<ConflictChoice>;

type LocalFile = {
	path: string;
	extension: string;
	mtime: number;
	parentPath: string | null;
};

type UploadAction = { type: "upload"; local: LocalFile };
type DownloadAction = { type: "download"; remotePath: string; remoteMtime: number };
type ConflictAction = {
	type: "conflict";
	local: LocalFile;
	remotePath: string;
	remoteMtime: number;
};
type DeleteRemoteAction = { type: "delete-remote"; remotePath: string };
type DeleteLocalAction = { type: "delete-local"; local: LocalFile };
type SkipAction = { type: "skip" };

type Action =
	| UploadAction
	| DownloadAction
	| ConflictAction
	| DeleteRemoteAction
	| DeleteLocalAction
	| SkipAction;

export class SyncEngine {
	private conflictResolver: ConflictResolver;

	constructor(
		private app: App,
		private client: Client,
		private settings: WebdavSyncSettings,
		private store: StateStore,
		conflictResolver?: ConflictResolver,
		private logger: Logger = SILENT_LOGGER,
	) {
		this.conflictResolver = conflictResolver ?? SyncEngine.makeModalResolver(app);
	}

	private static makeModalResolver(app: App): ConflictResolver {
		return (path, localMtime, remoteMtime, localContent, remoteContent) =>
			new Promise((resolve) => {
				new ConflictModal(
					app,
					path,
					localMtime,
					remoteMtime,
					localContent,
					remoteContent,
					resolve,
				).open();
			});
	}

	registerVaultEvents(registerEvent: (event: EventRef) => void): void {
		registerEvent(
			this.app.vault.on("rename", async (abstractFile, oldPath) => {
				if (this.settings.syncDirection === "remote-to-local") return;

				if (abstractFile instanceof TFile) {
					const tracked = this.store.files[oldPath];
					if (!tracked) return;
					try {
						await this.client.moveFile(oldPath, abstractFile.path);
						this.store.files[abstractFile.path] = tracked;
						delete this.store.files[oldPath];
						await this.store.save();
					} catch (err) {
						this.logger.error("rename failed", err);
						if (this.settings.notificationsEnabled)
							new Notice(`WebDAV sync: rename failed for "${oldPath}"`);
					}
				} else if (abstractFile instanceof TFolder) {
					const prefix = `${oldPath}/`;
					const affected = Object.keys(this.store.files).filter((p) => p.startsWith(prefix));
					if (affected.length === 0) return;
					try {
						await this.client.moveFile(oldPath, abstractFile.path);
						for (const oldFilePath of affected) {
							const newFilePath = `${abstractFile.path}/${oldFilePath.slice(prefix.length)}`;
							const entry = this.store.files[oldFilePath];
							if (entry) this.store.files[newFilePath] = entry;
							delete this.store.files[oldFilePath];
						}
						await this.store.save();
					} catch (err) {
						this.logger.error("folder rename failed", err);
						if (this.settings.notificationsEnabled)
							new Notice(`WebDAV sync: folder rename failed for "${oldPath}"`);
					}
				}
			}),
		);

		registerEvent(
			this.app.vault.on("delete", async (abstractFile) => {
				if (this.settings.syncDirection === "remote-to-local") return;
				if (this.settings.deletionHandling === "never-delete-remote") return;

				if (abstractFile instanceof TFile) {
					if (!this.store.files[abstractFile.path]) return;
					try {
						await this.client.deleteFile(abstractFile.path);
						delete this.store.files[abstractFile.path];
						await this.store.save();
					} catch (err) {
						this.logger.error("delete failed", err);
						if (this.settings.notificationsEnabled)
							new Notice(`WebDAV sync: delete failed for "${abstractFile.path}"`);
					}
				} else if (abstractFile instanceof TFolder) {
					const prefix = `${abstractFile.path}/`;
					const affected = Object.keys(this.store.files).filter((p) => p.startsWith(prefix));
					for (const path of affected) {
						try {
							await this.client.deleteFile(path);
						} catch (err) {
							this.logger.error("delete failed for", path, err);
							if (this.settings.notificationsEnabled)
								new Notice(`WebDAV sync: delete failed for "${path}"`);
						}
						delete this.store.files[path];
					}
					if (affected.length > 0) await this.store.save();
				}
			}),
		);
	}

	async sync(): Promise<void> {
		const t0 = Date.now();
		this.logger.debug("Sync started");

		await this.client.ensureRemoteBasePath();
		const { localByPath, remoteByPath, setOfAllPaths } = await this.retrievePaths();

		this.logger.debug(
			`Found ${setOfAllPaths.size} paths: ${localByPath.size} local, ${remoteByPath.size} remote`,
		);

		const actions: Action[] = [];
		for (const path of setOfAllPaths) {
			const local = localByPath.get(path);
			const remote = remoteByPath.get(path);
			actions.push(this.classify(local, remote, this.store.files[path]));
		}

		const counts = {
			upload: 0,
			download: 0,
			conflict: 0,
			"delete-remote": 0,
			"delete-local": 0,
			skip: 0,
		};
		for (const a of actions) counts[a.type]++;
		this.logger.debug(
			`Actions: ${counts.upload} uploads, ${counts.download} downloads, ${counts.conflict} conflicts, ${counts["delete-remote"] + counts["delete-local"]} deletions, ${counts.skip} skips`,
		);

		await this.execute(actions);
		this.store.lastSync = Date.now();
		await this.store.save();

		this.logger.debug(`Sync completed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
	}

	/**
	 * | tracked | local | remote | result                                    |
	 * |---------|-------|--------|-------------------------------------------|
	 * |   no    |  yes  |   no   | upload  (new local file)                  |
	 * |   no    |   no  |  yes   | download (new remote file)                |
	 * |   no    |  yes  |  yes   | conflict (both sides created same path)   |
	 * |  yes    |  yes  |  yes   | depends on mtime comparison (see below)   |
	 * |  yes    |  yes  |   no   | delete-local  (remote deleted it)         |
	 * |  yes    |   no  |  yes   | delete-remote (local deleted it)          |
	 */
	private classify(
		local: LocalFile | undefined,
		remote: FileStat | undefined,
		tracked: SyncFileEntry | undefined,
	): Action {
		const remoteMtime = remote ? new Date(remote.lastmod).getTime() : 0;

		if (!tracked) {
			if (local && !remote) return { type: "upload", local };
			if (!local && remote) return { type: "download", remotePath: remote.filename, remoteMtime };
			if (local && remote) {
				return { type: "conflict", local, remotePath: remote.filename, remoteMtime };
			}
			return { type: "skip" };
		}

		if (local && remote) {
			const localChanged = local.mtime > tracked.localMtime;
			const remoteChanged = remoteMtime > tracked.remoteMtime;

			if (!localChanged && !remoteChanged) return { type: "skip" };
			if (localChanged && !remoteChanged) return { type: "upload", local };
			if (!localChanged && remoteChanged) {
				return { type: "download", remotePath: remote.filename, remoteMtime };
			}
			return { type: "conflict", local, remotePath: remote.filename, remoteMtime };
		}

		if (local && !remote) return { type: "delete-local", local };
		if (!local && remote) return { type: "delete-remote", remotePath: remote.filename };

		return { type: "skip" };
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
	private async execute(actions: Action[]): Promise<void> {
		const { syncDirection, conflictResolution, deletionHandling } = this.settings;

		for (const action of actions) {
			if (action.type === "skip") continue;

			try {
				if (action.type === "upload") {
					if (syncDirection === "remote-to-local") continue;
					this.logger.debug(`upload "${action.local.path}"`);
					await this.upload(action.local);
				} else if (action.type === "download") {
					if (syncDirection === "local-to-remote") continue;
					this.logger.debug(`download "${this.stripBasePath(action.remotePath)}"`);
					await this.download(action.remotePath, action.remoteMtime);
				} else if (action.type === "conflict") {
					this.logger.debug(`conflict "${action.local.path}" — resolving`);
					await this.resolveConflict(action, conflictResolution, syncDirection);
				} else if (action.type === "delete-remote") {
					if (syncDirection === "remote-to-local") continue;
					if (deletionHandling === "never-delete-remote") continue;
					const localPath = this.stripBasePath(action.remotePath);
					this.logger.debug(`delete-remote "${localPath}"`);
					await this.client.deleteFile(localPath);
					delete this.store.files[localPath];
					await this.store.save();
				} else if (action.type === "delete-local") {
					if (syncDirection === "local-to-remote") continue;
					if (deletionHandling === "never-delete-local") continue;
					this.logger.debug(`delete-local "${action.local.path}"`);
					delete this.store.files[action.local.path]; // Prevent race condition with delete event handler
					await this.store.save();
					const tFile = this.app.vault.getFileByPath(action.local.path);
					if (tFile) {
						await this.app.vault.delete(tFile);
					} else {
						await this.app.vault.adapter.remove(action.local.path);
					}
				}
			} catch (err) {
				const path = "local" in action ? action.local.path : action.remotePath;
				this.logger.error(`Action "${action.type}" failed for "${path}"`, err);
				new Notice(`WebDAV sync: ${action.type} failed for "${path}"`);
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
	 *   "newest-wins"  → upload if local.mtime >= remoteMtime, else download
	 *   "ask"          → not yet implemented; falls back to newest-wins with a
	 *                    console warning. Will be replaced by ConflictModal in Step 7.
	 */
	private async resolveConflict(
		action: ConflictAction,
		resolution: WebdavSyncSettings["conflictResolution"],
		direction: WebdavSyncSettings["syncDirection"],
	): Promise<void> {
		if (direction === "local-to-remote") {
			await this.upload(action.local);
			return;
		}
		if (direction === "remote-to-local") {
			await this.download(action.remotePath, action.remoteMtime);
			return;
		}

		// two-way: apply conflict resolution strategy
		if (resolution === "local-wins") {
			this.logger.debug(`conflict "${action.local.path}": local-wins → upload`);
			await this.upload(action.local);
		} else if (resolution === "remote-wins") {
			this.logger.debug(`conflict "${action.local.path}": remote-wins → download`);
			await this.download(action.remotePath, action.remoteMtime);
		} else if (resolution === "newest-wins") {
			const pickLocal = action.local.mtime >= action.remoteMtime;
			this.logger.debug(
				`conflict "${action.local.path}": newest-wins (local=${new Date(action.local.mtime).toISOString()}, remote=${new Date(action.remoteMtime).toISOString()}) → ${pickLocal ? "upload" : "download"}`,
			);
			if (pickLocal) {
				await this.upload(action.local);
			} else {
				await this.download(action.remotePath, action.remoteMtime);
			}
		} else {
			// "ask" — delegate to injected resolver (default: ConflictModal)
			const localContent = await this.app.vault.adapter.readBinary(action.local.path);
			const remoteContent = await this.client.downloadFile(action.local.path);
			const choice = await this.conflictResolver(
				action.local.path,
				action.local.mtime,
				action.remoteMtime,
				localContent,
				remoteContent,
			);
			this.logger.debug(`conflict "${action.local.path}": ask → user chose ${choice}`);
			if (choice === "keep-local") {
				await this.upload(action.local);
			} else {
				await this.download(action.remotePath, action.remoteMtime);
			}
		}
	}

	private async upload(file: LocalFile): Promise<void> {
		if (file.parentPath) await this.client.ensureDirectory(file.parentPath);
		const content = await this.app.vault.adapter.readBinary(file.path);
		await this.client.uploadFile(file.path, content);
		const remoteMtime = await this.client.statFile(file.path);
		const entry = this.store.files[file.path] ?? { localMtime: 0, remoteMtime: 0 };
		this.store.files[file.path] = {
			...entry,
			localMtime: file.mtime,
			remoteMtime,
		};
		await this.store.save();
	}

	private async download(remotePath: string, remoteMtime: number): Promise<void> {
		const localPath = this.stripBasePath(remotePath);
		const content = await this.client.downloadFile(localPath);
		const file = this.app.vault.getFileByPath(localPath);
		if (file) {
			await this.app.vault.modifyBinary(file, content);
		} else {
			const dir = localPath.split("/").slice(0, -1).join("/");
			if (dir) await this.app.vault.adapter.mkdir(dir).catch(() => {});
			await this.app.vault.adapter.writeBinary(localPath, content);
		}
		const entry = this.store.files[localPath] ?? { localMtime: 0, remoteMtime: 0 };
		this.store.files[localPath] = { ...entry, localMtime: remoteMtime, remoteMtime };
		await this.store.save();
	}

	private async retrievePaths(): Promise<{
		localByPath: Map<string, LocalFile>;
		remoteByPath: Map<string, FileStat>;
		setOfAllPaths: Set<string>;
	}> {
		const localFiles = await this.getLocalFiles();
		const remoteFiles = await this.client.listAllFiles("/");

		const localByPath = new Map(localFiles.map((f) => [f.path, f]));
		const remoteByPath = new Map(
			remoteFiles
				.map((f) => [this.stripBasePath(f.filename), f] as [string, FileStat])
				.filter(([path]) => this.isInScope(path)),
		);

		const setOfAllPaths = new Set([...localByPath.keys(), ...remoteByPath.keys()]);

		return { localByPath, remoteByPath, setOfAllPaths };
	}

	// Returns all in-scope local files as LocalFile records.
	// vault.getFiles() omits .obsidian/ — for full-vault that directory is
	// listed separately via the adapter so it can be included.
	private async getLocalFiles(): Promise<LocalFile[]> {
		const vaultFiles = this.app.vault
			.getFiles()
			.map((f) => ({
				path: f.path,
				extension: f.extension,
				mtime: f.stat.mtime,
				parentPath: f.parent?.path ?? null,
			}))
			.filter((f) => this.isInScope(f.path));

		if (this.settings.syncScope !== "full-vault") return vaultFiles;

		const obsidianFiles = await this.listAdapterDir(".obsidian");
		return [...vaultFiles, ...obsidianFiles.filter((f) => this.isInScope(f.path))];
	}

	private async listAdapterDir(dirPath: string): Promise<LocalFile[]> {
		const { files, folders } = await this.app.vault.adapter.list(dirPath);
		const results: LocalFile[] = [];

		for (const filePath of files) {
			const stat = await this.app.vault.adapter.stat(filePath);
			if (!stat) continue;
			const parts = filePath.split("/");
			const filename = parts.at(-1) ?? "";
			results.push({
				path: filePath,
				extension: filename.split(".").pop() ?? "",
				mtime: stat.mtime,
				parentPath: parts.length > 1 ? parts.slice(0, -1).join("/") : null,
			});
		}

		for (const folder of folders) {
			results.push(...(await this.listAdapterDir(folder)));
		}

		return results;
	}

	// Returns true when a vault-relative path falls within the configured syncScope.
	// The state file is always excluded to prevent sync loops.
	private isInScope(vaultPath: string): boolean {
		if (vaultPath === this.store.stateFilePath) return false;
		const { syncScope, customSyncFolder } = this.settings;
		if (syncScope === "full-vault") return true;
		if (syncScope === "exclude-obsidian") return !vaultPath.startsWith(".obsidian/");
		if (syncScope === "markdown-only") return vaultPath.endsWith(".md");
		if (syncScope === "custom-folder") return vaultPath.startsWith(`${customSyncFolder}/`);
		return true;
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
