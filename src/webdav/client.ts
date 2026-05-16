import type { App } from "obsidian";
import type { FileStat } from "webdav";
import { createClient } from "webdav";
import type { WebdavSyncSettings } from "../settings";

export class Client {
	private client: ReturnType<typeof createClient> | null = null;

	constructor(
		private app: App,
		private settings: WebdavSyncSettings,
	) {}

	private resolvePath(remotePath: string): string {
		const base = this.settings.remoteBasePath.replace(/\/$/, "");
		const path = remotePath.startsWith("/") ? remotePath : `/${remotePath}`;
		return base ? `${base}${path}` : path;
	}

	private async getClient(force: boolean = false) {
		if (!this.client || force) {
			const password = this.app.secretStorage.getSecret(this.settings.passwordSecret) ?? "";
			this.client = createClient(this.settings.serverUrl, {
				username: this.settings.username,
				password,
			});
		}
		return this.client;
	}

	async testConnection(): Promise<boolean> {
		try {
			const client = await this.getClient(true);
			const basePath = this.settings.remoteBasePath || "/";
			await client.getDirectoryContents(basePath);
			return true;
		} catch (error) {
			console.error("WebDAV Connection Error:", error);
			this.client = null;
			return false;
		}
	}

	async uploadFile(remotePath: string, content: ArrayBuffer): Promise<void> {
		const client = await this.getClient();
		await client.putFileContents(this.resolvePath(remotePath), content, { overwrite: true });
	}

	async downloadFile(remotePath: string): Promise<ArrayBuffer> {
		const client = await this.getClient();
		const data = await client.getFileContents(this.resolvePath(remotePath));
		return data as ArrayBuffer;
	}

	async deleteFile(remotePath: string): Promise<void> {
		const client = await this.getClient();
		await client.deleteFile(this.resolvePath(remotePath));
	}

	async moveFile(srcPath: string, destPath: string): Promise<void> {
		const client = await this.getClient();
		await client.moveFile(this.resolvePath(srcPath), this.resolvePath(destPath));
	}

	async ensureDirectory(remotePath: string): Promise<void> {
		const client = await this.getClient();
		const resolved = this.resolvePath(remotePath);
		const parts = resolved.replace(/^\//, "").split("/");
		let current = "";
		for (const part of parts) {
			if (!part) continue;
			current += `/${part}`;
			try {
				await client.createDirectory(current);
			} catch {
				// Directory likely already exists
			}
		}
	}

	async ensureRemoteBasePath(): Promise<void> {
		const base = this.settings.remoteBasePath.replace(/\/$/, "");
		if (!base) return;
		const client = await this.getClient();
		const parts = base.replace(/^\//, "").split("/");
		let current = "";
		for (const part of parts) {
			if (!part) continue;
			current += `/${part}`;
			try {
				await client.createDirectory(current);
			} catch {
				// Already exists
			}
		}
	}

	async statFile(remotePath: string): Promise<number> {
		const client = await this.getClient();
		const stat = (await client.stat(this.resolvePath(remotePath))) as FileStat;
		return new Date(stat.lastmod).getTime();
	}

	async listAllFiles(remotePath: string): Promise<FileStat[]> {
		const client = await this.getClient();
		const contents = await client.getDirectoryContents(this.resolvePath(remotePath), {
			deep: true,
		});
		return (contents as FileStat[]).filter((item) => item.type === "file");
	}
}
