import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TFile, TFolder } from "obsidian";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebdavSyncSettings } from "../src/settings.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { SyncEngine } from "../src/sync/engine.js";
import { StateStore } from "../src/sync/state.js";
import { Client } from "../src/webdav/client.js";
import { NodeFsApp } from "./helpers/node-fs-app.js";
import { WEBDAV_PASSWORD, WEBDAV_URL, WEBDAV_USERNAME } from "./helpers/webdav-server.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const encode = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;
const decode = (b: ArrayBuffer) => new TextDecoder().decode(b);

function makeTFileInstance(path: string, mtime = Date.now()): TFile {
	return Object.assign(new TFile(), {
		path,
		extension: path.split(".").pop() ?? "",
		parent: path.includes("/") ? { path: path.split("/").slice(0, -1).join("/") } : null,
		stat: { mtime, ctime: mtime, size: 0 },
	});
}

function makeTFolderInstance(path: string): TFolder {
	return Object.assign(new TFolder(), { path, children: [] });
}

// ─── Shared setup ─────────────────────────────────────────────────────────────

let vaultDir: string;
let app: NodeFsApp;
let client: Client;
let engine: SyncEngine;
let store: StateStore;
let settings: WebdavSyncSettings;

beforeEach(async () => {
	vaultDir = await mkdtemp(join(tmpdir(), "webdav-sync-"));
	const prefix = `/test-${crypto.randomUUID()}`;
	settings = {
		...DEFAULT_SETTINGS,
		serverUrl: WEBDAV_URL,
		username: WEBDAV_USERNAME,
		passwordSecret: "key",
		remoteBasePath: prefix,
	};
	app = new NodeFsApp(vaultDir, WEBDAV_PASSWORD);
	client = new Client(app as never, settings);
	store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
	engine = new SyncEngine(app as never, client, settings, store);

	const setupClient = new Client(new NodeFsApp(vaultDir, WEBDAV_PASSWORD) as never, {
		...settings,
		remoteBasePath: "",
	});
	await setupClient.ensureDirectory(prefix);
});

afterEach(async () => {
	await rm(vaultDir, { recursive: true, force: true });
});

// Returns vault-relative paths of all files currently on the server.
async function listServerPaths(): Promise<string[]> {
	const files = await client.listAllFiles("/");
	const base = `${settings.remoteBasePath.replace(/\/$/, "")}/`;
	return files.map((f) => f.filename.replace(base, ""));
}

// ─── sync() scenarios ─────────────────────────────────────────────────────────

describe("upload new local file", () => {
	it("content verifiable on server after sync", async () => {
		await app.vault.writeFile("notes.md", "Hello");
		await engine.sync();
		expect(decode(await client.downloadFile("notes.md"))).toBe("Hello");
	});
});

describe("download new remote file", () => {
	it("file appears on disk with correct content", async () => {
		await client.uploadFile("remote.md", encode("remote content"));
		await engine.sync();
		expect(await readFile(join(vaultDir, "remote.md"), "utf-8")).toBe("remote content");
	});
});

describe("skip when nothing changed", () => {
	it("no upload or download on second sync", async () => {
		await app.vault.writeFile("notes.md", "unchanged");
		await engine.sync();

		const uploadSpy = vi.spyOn(client, "uploadFile");
		const downloadSpy = vi.spyOn(client, "downloadFile");
		await engine.sync();

		expect(uploadSpy).not.toHaveBeenCalled();
		expect(downloadSpy).not.toHaveBeenCalled();
	});
});

describe("upload when local mtime > tracked", () => {
	it("updated content verifiable on server", async () => {
		const file = await app.vault.writeFile("notes.md", "v1");
		await engine.sync();

		await app.vault.writeFile("notes.md", "v2", file.stat.mtime + 60_000);
		await engine.sync();

		expect(decode(await client.downloadFile("notes.md"))).toBe("v2");
	});
});

describe("download when remote mtime > tracked", () => {
	it("updated content appears on disk", async () => {
		const localTime = Date.now() - 120_000;
		await app.vault.writeFile("notes.md", "local-v1", localTime);
		await client.uploadFile("notes.md", encode("server-v2")); // server mtime ≈ now > localTime
		store.files["notes.md"] = { localMtime: localTime, remoteMtime: localTime };

		await engine.sync(); // remoteChanged = true, localChanged = false → download

		expect(await readFile(join(vaultDir, "notes.md"), "utf-8")).toBe("server-v2");
	});
});

describe("conflict: local-wins", () => {
	it("local content ends up on server", async () => {
		await client.uploadFile("conflict.md", encode("remote content"));
		await app.vault.writeFile("conflict.md", "local content");

		await new SyncEngine(
			app as never,
			client,
			{ ...settings, conflictResolution: "local-wins" },
			store,
		).sync();

		expect(decode(await client.downloadFile("conflict.md"))).toBe("local content");
	});
});

describe("conflict: remote-wins", () => {
	it("remote content ends up on disk", async () => {
		await client.uploadFile("conflict.md", encode("remote content"));
		await app.vault.writeFile("conflict.md", "local content");

		await new SyncEngine(
			app as never,
			client,
			{ ...settings, conflictResolution: "remote-wins" },
			store,
		).sync();

		expect(await readFile(join(vaultDir, "conflict.md"), "utf-8")).toBe("remote content");
	});
});

describe("conflict: newest-wins", () => {
	it("local content wins when local mtime is newer", async () => {
		await client.uploadFile("conflict.md", encode("remote content")); // server mtime ≈ now
		await app.vault.writeFile("conflict.md", "local content", Date.now() + 60_000);

		await new SyncEngine(
			app as never,
			client,
			{ ...settings, conflictResolution: "newest-wins" },
			store,
		).sync();

		expect(decode(await client.downloadFile("conflict.md"))).toBe("local content");
	});

	it("remote content wins when remote mtime is newer", async () => {
		await client.uploadFile("conflict.md", encode("remote content")); // server mtime ≈ now
		await app.vault.writeFile("conflict.md", "local content", 1000); // epoch — very old

		await new SyncEngine(
			app as never,
			client,
			{ ...settings, conflictResolution: "newest-wins" },
			store,
		).sync();

		expect(await readFile(join(vaultDir, "conflict.md"), "utf-8")).toBe("remote content");
	});
});

describe("delete-local: tracked file, remote gone", () => {
	it("file removed from disk", async () => {
		const file = await app.vault.writeFile("notes.md", "content");
		store.files["notes.md"] = { localMtime: file.stat.mtime, remoteMtime: file.stat.mtime };

		await new SyncEngine(
			app as never,
			client,
			{ ...settings, deletionHandling: "mirror" },
			store,
		).sync();

		const exists = await access(join(vaultDir, "notes.md"))
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(false);
	});

	it("no 404 error when vault events are also registered (regression)", async () => {
		// Scenario: file synced, then deleted on remote, then user triggers sync.
		// vault.delete() emits a "delete" event; the handler must not try to delete
		// the already-gone server file and produce a spurious 404.
		await app.vault.writeFile("notes.md", "content");
		await engine.sync(); // uploads + tracks
		await client.deleteFile("notes.md"); // simulate external remote deletion

		const mirrorEngine = new SyncEngine(
			app as never,
			client,
			{ ...settings, deletionHandling: "mirror" },
			store,
		);
		mirrorEngine.registerVaultEvents(vi.fn());

		const deleteFileSpy = vi.spyOn(client, "deleteFile");
		await expect(mirrorEngine.sync()).resolves.not.toThrow();
		expect(deleteFileSpy).not.toHaveBeenCalled(); // handler must not attempt the server delete
	});
});

describe("delete-remote: tracked file, local gone", () => {
	it("file removed from server", async () => {
		await client.uploadFile("notes.md", encode("content"));
		store.files["notes.md"] = { localMtime: Date.now(), remoteMtime: Date.now() };
		// File is absent from the vault index — simulates local deletion

		await new SyncEngine(
			app as never,
			client,
			{ ...settings, deletionHandling: "mirror" },
			store,
		).sync();

		expect(await listServerPaths()).toHaveLength(0);
	});
});

describe("syncDirection: local-to-remote", () => {
	it("remote files are not downloaded", async () => {
		await client.uploadFile("remote.md", encode("remote content"));

		await new SyncEngine(
			app as never,
			client,
			{ ...settings, syncDirection: "local-to-remote" },
			store,
		).sync();

		const exists = await access(join(vaultDir, "remote.md"))
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(false);
	});
});

describe("syncDirection: remote-to-local", () => {
	it("local files are not uploaded", async () => {
		await app.vault.writeFile("local.md", "local content");

		await new SyncEngine(
			app as never,
			client,
			{ ...settings, syncDirection: "remote-to-local" },
			store,
		).sync();

		expect(await listServerPaths()).toHaveLength(0);
	});
});

describe("deletionHandling: never-delete-remote", () => {
	it("file survives on server when local is gone", async () => {
		await client.uploadFile("notes.md", encode("content"));
		store.files["notes.md"] = { localMtime: Date.now(), remoteMtime: Date.now() };

		await new SyncEngine(
			app as never,
			client,
			{ ...settings, deletionHandling: "never-delete-remote" },
			store,
		).sync();

		expect(await listServerPaths()).toContain("notes.md");
	});
});

describe("syncScope: markdown-only", () => {
	it("non-md files absent from server after sync", async () => {
		await app.vault.writeFile("notes.md", "md");
		await app.vault.writeFile("image.png", "png");

		await new SyncEngine(
			app as never,
			client,
			{ ...settings, syncScope: "markdown-only" },
			store,
		).sync();

		const paths = await listServerPaths();
		expect(paths).toContain("notes.md");
		expect(paths).not.toContain("image.png");
	});
});

describe("syncScope: custom-folder", () => {
	it("out-of-scope files absent from server after sync", async () => {
		await app.vault.writeFile("work/task.md", "task");
		await app.vault.writeFile("personal/diary.md", "diary");

		await new SyncEngine(
			app as never,
			client,
			{ ...settings, syncScope: "custom-folder", customSyncFolder: "work" },
			store,
		).sync();

		const paths = await listServerPaths();
		expect(paths).toContain("work/task.md");
		expect(paths).not.toContain("personal/diary.md");
	});
});

describe("subdirectory upload", () => {
	it("file downloadable at folder/notes.md on server", async () => {
		await app.vault.writeFile("folder/notes.md", "nested content");
		await engine.sync();
		expect(decode(await client.downloadFile("folder/notes.md"))).toBe("nested content");
	});
});

describe("state persisted to disk", () => {
	it("store entries survive a reload from disk", async () => {
		await app.vault.writeFile("tracked.md", "x");
		await engine.sync();

		const store2 = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		await store2.load();

		expect(store2.files["tracked.md"]?.localMtime).toBeGreaterThan(0);
		expect(store2.files["tracked.md"]?.remoteMtime).toBeGreaterThan(0);
	});
});

// ─── registerVaultEvents() ────────────────────────────────────────────────────

describe("registerVaultEvents: rename file", () => {
	it("file at new path on server, old path gone", async () => {
		await app.vault.writeFile("old.md", "content");
		await engine.sync();
		engine.registerVaultEvents(vi.fn());

		await app.vault.emitRename(makeTFileInstance("new.md"), "old.md");

		const paths = await listServerPaths();
		expect(paths).toContain("new.md");
		expect(paths).not.toContain("old.md");
		expect(store.files["new.md"]).toBeDefined();
		expect(store.files["old.md"]).toBeUndefined();
	});

	it("does nothing when file is not tracked", async () => {
		await client.uploadFile("old.md", encode("content")); // on server, not tracked
		engine.registerVaultEvents(vi.fn());

		await app.vault.emitRename(makeTFileInstance("new.md"), "old.md");

		const paths = await listServerPaths();
		expect(paths).toContain("old.md");
		expect(paths).not.toContain("new.md");
	});

	it("does nothing when syncDirection is remote-to-local", async () => {
		await app.vault.writeFile("old.md", "content");
		await engine.sync();

		const rtlEngine = new SyncEngine(
			app as never,
			client,
			{ ...settings, syncDirection: "remote-to-local" },
			store,
		);
		rtlEngine.registerVaultEvents(vi.fn());

		await app.vault.emitRename(makeTFileInstance("new.md"), "old.md");

		const paths = await listServerPaths();
		expect(paths).toContain("old.md");
		expect(paths).not.toContain("new.md");
	});
});

describe("registerVaultEvents: rename folder", () => {
	it("all contained files at new paths on server", async () => {
		await app.vault.writeFile("docs/a.md", "a");
		await app.vault.writeFile("docs/b.md", "b");
		await engine.sync();
		engine.registerVaultEvents(vi.fn());

		await app.vault.emitRename(makeTFolderInstance("archive"), "docs");

		const paths = await listServerPaths();
		expect(paths).toContain("archive/a.md");
		expect(paths).toContain("archive/b.md");
		expect(paths).not.toContain("docs/a.md");
		expect(paths).not.toContain("docs/b.md");
		expect(store.files["archive/a.md"]).toBeDefined();
		expect(store.files["archive/b.md"]).toBeDefined();
		expect(store.files["docs/a.md"]).toBeUndefined();
		expect(store.files["docs/b.md"]).toBeUndefined();
	});

	it("does nothing when no tracked files are inside the folder", async () => {
		await client.ensureDirectory("docs");
		await client.uploadFile("docs/a.md", encode("a")); // on server, not tracked
		engine.registerVaultEvents(vi.fn());

		const moveFileSpy = vi.spyOn(client, "moveFile");
		await app.vault.emitRename(makeTFolderInstance("archive"), "docs");

		expect(moveFileSpy).not.toHaveBeenCalled();
	});
});

describe("registerVaultEvents: delete file", () => {
	it("file removed from server when deletionHandling is mirror", async () => {
		await app.vault.writeFile("notes.md", "content");
		await engine.sync();

		const mirrorEngine = new SyncEngine(
			app as never,
			client,
			{ ...settings, deletionHandling: "mirror" },
			store,
		);
		mirrorEngine.registerVaultEvents(vi.fn());

		// vault.delete removes from disk and emits "delete" — the registered handler deletes from server
		const file = app.vault.getFileByPath("notes.md")!;
		await app.vault.delete(file);

		expect(await listServerPaths()).toHaveLength(0);
		expect(store.files["notes.md"]).toBeUndefined();
	});

	it("does nothing when file is not tracked", async () => {
		await client.uploadFile("notes.md", encode("content")); // on server, not tracked
		engine.registerVaultEvents(vi.fn());

		const deleteFileSpy = vi.spyOn(client, "deleteFile");
		await app.vault.emitDelete(makeTFileInstance("notes.md")); // emit without removing from server

		expect(deleteFileSpy).not.toHaveBeenCalled();
		expect(await listServerPaths()).toContain("notes.md");
	});

	it("does nothing when syncDirection is remote-to-local", async () => {
		await app.vault.writeFile("notes.md", "content");
		await engine.sync();

		const rtlEngine = new SyncEngine(
			app as never,
			client,
			{ ...settings, syncDirection: "remote-to-local" },
			store,
		);
		rtlEngine.registerVaultEvents(vi.fn());

		const deleteFileSpy = vi.spyOn(client, "deleteFile");
		await app.vault.emitDelete(makeTFileInstance("notes.md"));

		expect(deleteFileSpy).not.toHaveBeenCalled();
		expect(await listServerPaths()).toContain("notes.md");
	});

	it("does nothing when deletionHandling is never-delete-remote", async () => {
		await app.vault.writeFile("notes.md", "content");
		await engine.sync();

		const ndrEngine = new SyncEngine(
			app as never,
			client,
			{ ...settings, deletionHandling: "never-delete-remote" },
			store,
		);
		ndrEngine.registerVaultEvents(vi.fn());

		const deleteFileSpy = vi.spyOn(client, "deleteFile");
		await app.vault.emitDelete(makeTFileInstance("notes.md"));

		expect(deleteFileSpy).not.toHaveBeenCalled();
		expect(await listServerPaths()).toContain("notes.md");
	});
});

describe("registerVaultEvents: delete folder", () => {
	it("all tracked files inside removed from server", async () => {
		await app.vault.writeFile("docs/a.md", "a");
		await app.vault.writeFile("docs/b.md", "b");
		await engine.sync();

		const mirrorEngine = new SyncEngine(
			app as never,
			client,
			{ ...settings, deletionHandling: "mirror" },
			store,
		);
		mirrorEngine.registerVaultEvents(vi.fn());

		await app.vault.emitDelete(makeTFolderInstance("docs"));

		expect(await listServerPaths()).toHaveLength(0);
		expect(store.files["docs/a.md"]).toBeUndefined();
		expect(store.files["docs/b.md"]).toBeUndefined();
	});
});
