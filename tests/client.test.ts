import { describe, expect, it } from "vitest";
import type { WebdavSyncSettings } from "../src/settings.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { Client } from "../src/webdav/client.js";
import { MockApp } from "./helpers/obsidian-mock.js";
import { WEBDAV_PASSWORD, WEBDAV_URL, WEBDAV_USERNAME } from "./helpers/webdav-server.js";

function makeSettings(overrides: Partial<WebdavSyncSettings> = {}): WebdavSyncSettings {
	return {
		...DEFAULT_SETTINGS,
		serverUrl: WEBDAV_URL,
		username: WEBDAV_USERNAME,
		passwordSecret: "test-key",
		remoteBasePath: "",
		...overrides,
	};
}

function makeClient(overrides: Partial<WebdavSyncSettings> = {}): Client {
	const app = new MockApp(WEBDAV_PASSWORD);
	return new Client(app as never, makeSettings(overrides));
}

function uniquePrefix(): string {
	return `test-${crypto.randomUUID()}`;
}

describe("Client", () => {
	it("testConnection returns true for a reachable server", async () => {
		const client = makeClient();
		expect(await client.testConnection()).toBe(true);
	});

	it("testConnection returns false for an unreachable server", async () => {
		const client = makeClient({ serverUrl: "http://localhost:9999" });
		expect(await client.testConnection()).toBe(false);
	});

	it("uploadFile then downloadFile round-trips content", async () => {
		const client = makeClient();
		const prefix = uniquePrefix();
		const path = `${prefix}/hello.txt`;
		const content = new TextEncoder().encode("hello world").buffer as ArrayBuffer;

		await client.ensureDirectory(prefix);
		await client.uploadFile(path, content);
		const downloaded = await client.downloadFile(path);

		expect(new TextDecoder().decode(downloaded)).toBe("hello world");
	});

	it("deleteFile removes the file from the server", async () => {
		const client = makeClient();
		const prefix = uniquePrefix();
		const path = `${prefix}/to-delete.txt`;

		await client.ensureDirectory(prefix);
		await client.uploadFile(path, new ArrayBuffer(0));
		await client.deleteFile(path);

		const files = await client.listAllFiles(prefix);
		expect(files).toHaveLength(0);
	});

	it("listAllFiles returns only files, not directories", async () => {
		const client = makeClient();
		const prefix = uniquePrefix();

		await client.ensureDirectory(`${prefix}/subdir`);
		await client.uploadFile(`${prefix}/a.txt`, new ArrayBuffer(0));
		await client.uploadFile(`${prefix}/subdir/b.txt`, new ArrayBuffer(0));

		const files = await client.listAllFiles(prefix);

		expect(files.every((f) => f.type === "file")).toBe(true);
		expect(files).toHaveLength(2);
	});

	it("ensureDirectory does not throw for nested paths", async () => {
		const client = makeClient();
		const prefix = uniquePrefix();
		await expect(client.ensureDirectory(`${prefix}/a/b/c`)).resolves.not.toThrow();
	});
});
