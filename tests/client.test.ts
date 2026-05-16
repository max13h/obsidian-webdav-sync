import { describe, expect, it, vi } from "vitest";
import type { WebdavSyncSettings } from "../src/settings.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { Client } from "../src/webdav/client.js";
import { NodeFsApp } from "./helpers/node-fs-app.js";
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
	const app = new NodeFsApp("/tmp/webdav-client-test", WEBDAV_PASSWORD);
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
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = makeClient({ serverUrl: "http://localhost:9999" });
		expect(await client.testConnection()).toBe(false);
		vi.restoreAllMocks();
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

	it("moveFile renames a file on the server", async () => {
		const client = makeClient();
		const prefix = uniquePrefix();
		await client.ensureDirectory(prefix);
		await client.uploadFile(
			`${prefix}/original.txt`,
			new TextEncoder().encode("data").buffer as ArrayBuffer,
		);

		await client.moveFile(`${prefix}/original.txt`, `${prefix}/renamed.txt`);

		const files = await client.listAllFiles(prefix);
		expect(files.map((f) => f.basename)).toContain("renamed.txt");
		expect(files.map((f) => f.basename)).not.toContain("original.txt");
	});

	it("files are accessible under a non-empty remoteBasePath", async () => {
		const base = `/base-${crypto.randomUUID()}`;
		const client = makeClient({ remoteBasePath: base });
		const content = new TextEncoder().encode("base-path content").buffer as ArrayBuffer;

		await client.ensureDirectory("sub");
		await client.uploadFile("sub/note.txt", content);
		const downloaded = await client.downloadFile("sub/note.txt");

		expect(new TextDecoder().decode(downloaded)).toBe("base-path content");

		const files = await client.listAllFiles("sub");
		expect(files).toHaveLength(1);
	});

	it("testConnection returns false when credentials are wrong", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const app = new NodeFsApp("/tmp/webdav-client-test", "wrong-password");
		const client = new Client(app as never, makeSettings());
		expect(await client.testConnection()).toBe(false);
		vi.restoreAllMocks();
	});

	it("testConnection returns false when authType is digest against a basic-auth server", async () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const client = makeClient({ authType: "digest" });
		expect(await client.testConnection()).toBe(false);
		vi.restoreAllMocks();
	});

	describe("listAllFiles: BFS mode (listingDepth: manual_1)", () => {
		it("returns files from nested directories", async () => {
			const client = makeClient({ listingDepth: "manual_1" });
			const prefix = uniquePrefix();

			await client.ensureDirectory(`${prefix}/sub/deep`);
			await client.uploadFile(`${prefix}/root.txt`, new ArrayBuffer(0));
			await client.uploadFile(`${prefix}/sub/mid.txt`, new ArrayBuffer(0));
			await client.uploadFile(`${prefix}/sub/deep/leaf.txt`, new ArrayBuffer(0));

			const files = await client.listAllFiles(prefix);

			expect(files.every((f) => f.type === "file")).toBe(true);
			expect(files).toHaveLength(3);
			expect(files.map((f) => f.basename).sort()).toEqual(["leaf.txt", "mid.txt", "root.txt"]);
		});

		it("produces the same file list as Depth:infinity", async () => {
			const prefix = uniquePrefix();
			const infinity = makeClient({ listingDepth: "infinity" });
			const bfs = makeClient({ listingDepth: "manual_1" });

			await infinity.ensureDirectory(`${prefix}/a/b`);
			await infinity.uploadFile(`${prefix}/one.txt`, new ArrayBuffer(0));
			await infinity.uploadFile(`${prefix}/a/two.txt`, new ArrayBuffer(0));
			await infinity.uploadFile(`${prefix}/a/b/three.txt`, new ArrayBuffer(0));

			const fromInfinity = (await infinity.listAllFiles(prefix)).map((f) => f.filename).sort();
			const fromBfs = (await bfs.listAllFiles(prefix)).map((f) => f.filename).sort();

			expect(fromBfs).toEqual(fromInfinity);
		});
	});
});
