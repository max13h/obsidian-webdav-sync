import { createClient } from "webdav";
import type { WebdavSyncSettings } from "../settings";

export class Client {
	private client: ReturnType<typeof createClient> | null = null;

	constructor(private settings: WebdavSyncSettings) {}

	private getClient() {
		if (!this.client) {
			this.client = createClient(this.settings.serverUrl, {
				username: this.settings.username,
				password: this.settings.password,
			});
		}
		return this.client;
	}

	async testConnection(): Promise<boolean> {
		try {
			await this.getClient().getDirectoryContents("/");
			return true;
		} catch (error) {
			console.error("WebDAV Connection Error:", error);
			return false;
		}
	}

	async listFiles(path = "/"): Promise<string[]> {
		const contents = await this.getClient().getDirectoryContents(path);
		return (contents as Array<{ filename: string }>).map((item) => item.filename);
	}
}
