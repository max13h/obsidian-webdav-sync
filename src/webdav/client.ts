import type { App } from "obsidian";
import { createClient } from "webdav";
import type { WebdavSyncSettings } from "../settings";

export class Client {
	private client: ReturnType<typeof createClient> | null = null;

	constructor(
		private app: App,
		private settings: WebdavSyncSettings,
	) {}

	private async getClient() {
		if (!this.client) {
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
			const client = await this.getClient();
			console.log(client);
			await client.getDirectoryContents("/");

			return true;
		} catch (error) {
			console.error("WebDAV Connection Error:", error);
			return false;
		}
	}

	async listFiles(path = "/"): Promise<string[]> {
		const contents = await (await this.getClient()).getDirectoryContents(path);
		return (contents as Array<{ filename: string }>).map((item) => item.filename);
	}
}
