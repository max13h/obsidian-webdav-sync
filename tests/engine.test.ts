import { TFile, TFolder } from "obsidian";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileStat } from "webdav";
import type { WebdavSyncSettings } from "../src/settings.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { SyncEngine } from "../src/sync/engine.js";
import { StateStore } from "../src/sync/state.js";
import { Client } from "../src/webdav/client.js";
import { MockApp, makeTFile } from "./helpers/obsidian-mock.js";
import { WEBDAV_PASSWORD, WEBDAV_URL, WEBDAV_USERNAME } from "./helpers/webdav-server.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRemoteFile(filename: string, mtime: number): FileStat {
	return {
		filename,
		basename: filename.split("/").at(-1) ?? "",
		lastmod: new Date(mtime).toUTCString(),
		size: 0,
		type: "file",
		etag: null,
	};
}

function makeSettings(overrides: Partial<WebdavSyncSettings> = {}): WebdavSyncSettings {
	return { ...DEFAULT_SETTINGS, remoteBasePath: "", ...overrides };
}

function makeMockClient(remoteFiles: FileStat[] = []) {
	return {
		listAllFiles: vi.fn(async () => remoteFiles),
		uploadFile: vi.fn(async () => {}),
		downloadFile: vi.fn(async () => new ArrayBuffer(0)),
		deleteFile: vi.fn(async () => {}),
		moveFile: vi.fn(async () => {}),
		ensureDirectory: vi.fn(async () => {}),
		testConnection: vi.fn(async () => true),
	};
}

function deleteLocalSetup() {
	const app = new MockApp();
	const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
	const file = makeTFile("notes.md", 1000);
	store.files["notes.md"] = { localMtime: 1000, remoteMtime: 1000 };
	const client = makeMockClient([]);
	app.vault.addFile(file);
	vi.spyOn(app.vault, "delete");
	return { app, store, file, client };
}

function makeEngine(
	app: MockApp,
	client: ReturnType<typeof makeMockClient> | Client,
	settings: WebdavSyncSettings,
	store: StateStore,
): SyncEngine {
	return new SyncEngine(app as never, client as never, settings, store);
}

// ─── classify() via sync() ────────────────────────────────────────────────────

describe("classify: new local file → upload", () => {
	it("calls uploadFile when file exists locally but not remotely", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient([]);
		const file = makeTFile("notes.md", 1000);
		app.vault.addFile(file, new TextEncoder().encode("hi").buffer as ArrayBuffer);

		await makeEngine(app, client, makeSettings(), store).sync();

		expect(client.uploadFile).toHaveBeenCalledWith("notes.md", expect.any(ArrayBuffer));
	});
});

describe("classify: new remote file → download", () => {
	it("calls downloadFile and creates the file in the vault", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient([makeRemoteFile("/notes.md", 1000)]);

		await makeEngine(app, client, makeSettings(), store).sync();

		expect(client.downloadFile).toHaveBeenCalledWith("notes.md");
		expect(app.vault.getFileByPath("notes.md")).not.toBeNull();
	});
});

describe("classify: both exist with no tracked state → conflict", () => {
	it("resolves with newest-wins (remote newer → download)", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient([makeRemoteFile("/notes.md", 2000)]);
		app.vault.addFile(makeTFile("notes.md", 1000));

		await makeEngine(
			app,
			client,
			makeSettings({ conflictResolution: "newest-wins" }),
			store,
		).sync();

		expect(client.downloadFile).toHaveBeenCalledWith("notes.md");
		expect(client.uploadFile).not.toHaveBeenCalled();
	});

	it("resolves with newest-wins (local newer → upload)", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient([makeRemoteFile("/notes.md", 500)]);
		app.vault.addFile(makeTFile("notes.md", 2000));

		await makeEngine(
			app,
			client,
			makeSettings({ conflictResolution: "newest-wins" }),
			store,
		).sync();

		expect(client.uploadFile).toHaveBeenCalledWith("notes.md", expect.any(ArrayBuffer));
		expect(client.downloadFile).not.toHaveBeenCalled();
	});
});

describe("classify: tracked file, nothing changed → skip", () => {
	it("does not call upload or download", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		store.files["notes.md"] = { localMtime: 1000, remoteMtime: 1000 };
		const client = makeMockClient([makeRemoteFile("/notes.md", 1000)]);
		app.vault.addFile(makeTFile("notes.md", 1000));

		await makeEngine(app, client, makeSettings(), store).sync();

		expect(client.uploadFile).not.toHaveBeenCalled();
		expect(client.downloadFile).not.toHaveBeenCalled();
	});
});

describe("classify: tracked file, local newer → upload", () => {
	it("calls uploadFile", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		store.files["notes.md"] = { localMtime: 1000, remoteMtime: 1000 };
		const client = makeMockClient([makeRemoteFile("/notes.md", 1000)]);
		app.vault.addFile(makeTFile("notes.md", 2000));

		await makeEngine(app, client, makeSettings(), store).sync();

		expect(client.uploadFile).toHaveBeenCalledWith("notes.md", expect.any(ArrayBuffer));
	});
});

describe("classify: tracked file, remote newer → download", () => {
	it("calls downloadFile", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		store.files["notes.md"] = { localMtime: 1000, remoteMtime: 1000 };
		const client = makeMockClient([makeRemoteFile("/notes.md", 2000)]);
		app.vault.addFile(makeTFile("notes.md", 1000));

		await makeEngine(app, client, makeSettings(), store).sync();

		expect(client.downloadFile).toHaveBeenCalledWith("notes.md");
	});
});

describe("classify: tracked file, both sides changed → conflict", () => {
	it("resolves with local-wins → upload", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		store.files["notes.md"] = { localMtime: 1000, remoteMtime: 1000 };
		const client = makeMockClient([makeRemoteFile("/notes.md", 2000)]);
		app.vault.addFile(makeTFile("notes.md", 3000));

		await makeEngine(app, client, makeSettings({ conflictResolution: "local-wins" }), store).sync();

		expect(client.uploadFile).toHaveBeenCalledWith("notes.md", expect.any(ArrayBuffer));
		expect(client.downloadFile).not.toHaveBeenCalled();
	});
});

describe("classify: tracked file, remote deleted → delete-local", () => {
	it("calls vault.delete when deletionHandling allows it", async () => {
		const { app, store, file, client } = deleteLocalSetup();

		await makeEngine(app, client, makeSettings({ deletionHandling: "mirror" }), store).sync();

		expect(app.vault.delete).toHaveBeenCalledWith(file);
	});
});

describe("classify: tracked file, local deleted → delete-remote", () => {
	it("calls client.deleteFile when deletionHandling allows it", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		store.files["notes.md"] = { localMtime: 1000, remoteMtime: 1000 };
		const client = makeMockClient([makeRemoteFile("/notes.md", 1000)]);

		await makeEngine(app, client, makeSettings({ deletionHandling: "mirror" }), store).sync();

		expect(client.deleteFile).toHaveBeenCalledWith("notes.md");
	});
});

describe("upload: ensureDirectory called for files in subdirectories", () => {
	it("calls ensureDirectory with the parent path before uploading", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient([]);
		const file = makeTFile("folder/notes.md", 1000);
		app.vault.addFile(file, new TextEncoder().encode("hi").buffer as ArrayBuffer);

		await makeEngine(app, client, makeSettings(), store).sync();

		expect(client.ensureDirectory).toHaveBeenCalledWith("folder");
		expect(client.uploadFile).toHaveBeenCalledWith("folder/notes.md", expect.any(ArrayBuffer));
	});

	it("does not call ensureDirectory for top-level files", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient([]);
		app.vault.addFile(
			makeTFile("notes.md", 1000),
			new TextEncoder().encode("hi").buffer as ArrayBuffer,
		);

		await makeEngine(app, client, makeSettings(), store).sync();

		expect(client.ensureDirectory).not.toHaveBeenCalled();
	});
});

describe("syncScope filtering", () => {
	it("markdown-only excludes non-md files from upload", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient([]);
		app.vault.addFile(
			makeTFile("notes.md", 1000),
			new TextEncoder().encode("md").buffer as ArrayBuffer,
		);
		app.vault.addFile(
			makeTFile("image.png", 1000),
			new TextEncoder().encode("png").buffer as ArrayBuffer,
		);

		await makeEngine(app, client, makeSettings({ syncScope: "markdown-only" }), store).sync();

		expect(client.uploadFile).toHaveBeenCalledWith("notes.md", expect.any(ArrayBuffer));
		expect(client.uploadFile).not.toHaveBeenCalledWith("image.png", expect.any(ArrayBuffer));
	});

	it("exclude-obsidian excludes .obsidian/ files from upload", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient([]);
		app.vault.addFile(
			makeTFile("notes.md", 1000),
			new TextEncoder().encode("md").buffer as ArrayBuffer,
		);
		app.vault.addFile(
			makeTFile(".obsidian/workspace.json", 1000),
			new TextEncoder().encode("ws").buffer as ArrayBuffer,
		);

		await makeEngine(app, client, makeSettings({ syncScope: "exclude-obsidian" }), store).sync();

		expect(client.uploadFile).toHaveBeenCalledWith("notes.md", expect.any(ArrayBuffer));
		expect(client.uploadFile).not.toHaveBeenCalledWith(
			".obsidian/workspace.json",
			expect.any(ArrayBuffer),
		);
	});

	it("full-vault includes .obsidian/ files that exclude-obsidian would skip", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient([]);
		app.vault.addFile(
			makeTFile(".obsidian/workspace.json", 1000),
			new TextEncoder().encode("ws").buffer as ArrayBuffer,
		);

		await makeEngine(app, client, makeSettings({ syncScope: "full-vault" }), store).sync();

		expect(client.uploadFile).toHaveBeenCalledWith(
			".obsidian/workspace.json",
			expect.any(ArrayBuffer),
		);
	});

	it("custom-folder only uploads files inside the configured folder", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient([]);
		app.vault.addFile(
			makeTFile("work/task.md", 1000),
			new TextEncoder().encode("task").buffer as ArrayBuffer,
		);
		app.vault.addFile(
			makeTFile("personal/diary.md", 1000),
			new TextEncoder().encode("diary").buffer as ArrayBuffer,
		);

		await makeEngine(
			app,
			client,
			makeSettings({ syncScope: "custom-folder", customSyncFolder: "work" }),
			store,
		).sync();

		expect(client.uploadFile).toHaveBeenCalledWith("work/task.md", expect.any(ArrayBuffer));
		expect(client.uploadFile).not.toHaveBeenCalledWith(
			"personal/diary.md",
			expect.any(ArrayBuffer),
		);
	});
});

// ─── execute() policy guards ──────────────────────────────────────────────────

describe("execute: syncDirection guards", () => {
	it("skips uploads when direction is remote-to-local", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient([]);
		app.vault.addFile(makeTFile("notes.md", 1000));

		await makeEngine(app, client, makeSettings({ syncDirection: "remote-to-local" }), store).sync();

		expect(client.uploadFile).not.toHaveBeenCalled();
	});

	it("skips downloads when direction is local-to-remote", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient([makeRemoteFile("/notes.md", 1000)]);

		await makeEngine(app, client, makeSettings({ syncDirection: "local-to-remote" }), store).sync();

		expect(client.downloadFile).not.toHaveBeenCalled();
	});
});

describe("execute: deletionHandling guards", () => {
	it("skips delete-remote when deletionHandling is never-delete-remote", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		store.files["notes.md"] = { localMtime: 1000, remoteMtime: 1000 };
		const client = makeMockClient([makeRemoteFile("/notes.md", 1000)]);

		await makeEngine(
			app,
			client,
			makeSettings({ deletionHandling: "never-delete-remote" }),
			store,
		).sync();

		expect(client.deleteFile).not.toHaveBeenCalled();
	});

	it("skips delete-local when deletionHandling is never-delete-local", async () => {
		const { app, store, client } = deleteLocalSetup();

		await makeEngine(
			app,
			client,
			makeSettings({ deletionHandling: "never-delete-local" }),
			store,
		).sync();

		expect(app.vault.delete).not.toHaveBeenCalled();
	});
});

// ─── resolveConflict() ────────────────────────────────────────────────────────

describe("resolveConflict", () => {
	function conflictSetup(localMtime: number, remoteMtime: number) {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		// No tracked state → conflict
		const client = makeMockClient([makeRemoteFile("/notes.md", remoteMtime)]);
		app.vault.addFile(makeTFile("notes.md", localMtime));
		return { app, store, client };
	}

	it("local-wins → always uploads", async () => {
		const { app, store, client } = conflictSetup(1000, 2000);
		await makeEngine(
			app,
			client,
			makeSettings({ syncDirection: "two-way", conflictResolution: "local-wins" }),
			store,
		).sync();
		expect(client.uploadFile).toHaveBeenCalled();
		expect(client.downloadFile).not.toHaveBeenCalled();
	});

	it("remote-wins → always downloads", async () => {
		const { app, store, client } = conflictSetup(2000, 1000);
		await makeEngine(
			app,
			client,
			makeSettings({ syncDirection: "two-way", conflictResolution: "remote-wins" }),
			store,
		).sync();
		expect(client.downloadFile).toHaveBeenCalled();
		expect(client.uploadFile).not.toHaveBeenCalled();
	});

	it("newest-wins with local newer → uploads", async () => {
		const { app, store, client } = conflictSetup(3000, 1000);
		await makeEngine(
			app,
			client,
			makeSettings({ syncDirection: "two-way", conflictResolution: "newest-wins" }),
			store,
		).sync();
		expect(client.uploadFile).toHaveBeenCalled();
		expect(client.downloadFile).not.toHaveBeenCalled();
	});

	it("newest-wins with remote newer → downloads", async () => {
		const { app, store, client } = conflictSetup(1000, 3000);
		await makeEngine(
			app,
			client,
			makeSettings({ syncDirection: "two-way", conflictResolution: "newest-wins" }),
			store,
		).sync();
		expect(client.downloadFile).toHaveBeenCalled();
		expect(client.uploadFile).not.toHaveBeenCalled();
	});

	it("direction local-to-remote overrides conflict resolution → uploads", async () => {
		const { app, store, client } = conflictSetup(1000, 3000);
		await makeEngine(
			app,
			client,
			makeSettings({ syncDirection: "local-to-remote", conflictResolution: "remote-wins" }),
			store,
		).sync();
		expect(client.uploadFile).toHaveBeenCalled();
		expect(client.downloadFile).not.toHaveBeenCalled();
	});

	it("direction remote-to-local overrides conflict resolution → downloads", async () => {
		const { app, store, client } = conflictSetup(3000, 1000);
		await makeEngine(
			app,
			client,
			makeSettings({ syncDirection: "remote-to-local", conflictResolution: "local-wins" }),
			store,
		).sync();
		expect(client.downloadFile).toHaveBeenCalled();
		expect(client.uploadFile).not.toHaveBeenCalled();
	});

	it("ask falls back to newest-wins: local newer → uploads", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { app, store, client } = conflictSetup(3000, 1000);
		await makeEngine(
			app,
			client,
			makeSettings({ syncDirection: "two-way", conflictResolution: "ask" }),
			store,
		).sync();
		expect(client.uploadFile).toHaveBeenCalled();
		expect(client.downloadFile).not.toHaveBeenCalled();
		vi.restoreAllMocks();
	});

	it("ask falls back to newest-wins: remote newer → downloads", async () => {
		vi.spyOn(console, "warn").mockImplementation(() => {});
		const { app, store, client } = conflictSetup(1000, 3000);
		await makeEngine(
			app,
			client,
			makeSettings({ syncDirection: "two-way", conflictResolution: "ask" }),
			store,
		).sync();
		expect(client.downloadFile).toHaveBeenCalled();
		expect(client.uploadFile).not.toHaveBeenCalled();
		vi.restoreAllMocks();
	});
});

// ─── registerVaultEvents() ────────────────────────────────────────────────────

function makeTFileInstance(path: string, mtime = 1000): TFile {
	return Object.assign(new TFile(), {
		path,
		extension: path.split(".").pop() ?? "",
		parent: path.includes("/") ? { path: path.split("/").slice(0, -1).join("/") } : null,
		stat: { mtime, ctime: mtime, size: 0 },
	});
}

function makeTFolderInstance(path: string): TFolder {
	return Object.assign(new TFolder(), { path });
}

describe("registerVaultEvents: rename file", () => {
	it("calls moveFile and updates store when file is tracked", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		store.files["old.md"] = { localMtime: 1000, remoteMtime: 1000 };
		const client = makeMockClient();
		const engine = makeEngine(app, client, makeSettings(), store);
		engine.registerVaultEvents(vi.fn());

		const renamed = makeTFileInstance("new.md");
		await app.vault.emit("rename", renamed, "old.md");

		expect(client.moveFile).toHaveBeenCalledWith("old.md", "new.md");
		expect(store.files["new.md"]).toBeDefined();
		expect(store.files["old.md"]).toBeUndefined();
	});

	it("does nothing when file is not tracked", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient();
		const engine = makeEngine(app, client, makeSettings(), store);
		engine.registerVaultEvents(vi.fn());

		await app.vault.emit("rename", makeTFileInstance("new.md"), "old.md");

		expect(client.moveFile).not.toHaveBeenCalled();
	});

	it("does nothing when syncDirection is remote-to-local", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		store.files["old.md"] = { localMtime: 1000, remoteMtime: 1000 };
		const client = makeMockClient();
		const engine = makeEngine(
			app,
			client,
			makeSettings({ syncDirection: "remote-to-local" }),
			store,
		);
		engine.registerVaultEvents(vi.fn());

		await app.vault.emit("rename", makeTFileInstance("new.md"), "old.md");

		expect(client.moveFile).not.toHaveBeenCalled();
	});
});

describe("registerVaultEvents: rename folder", () => {
	it("calls moveFile and renames all tracked paths inside the folder", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		store.files["docs/a.md"] = { localMtime: 1000, remoteMtime: 1000 };
		store.files["docs/b.md"] = { localMtime: 1000, remoteMtime: 1000 };
		const client = makeMockClient();
		const engine = makeEngine(app, client, makeSettings(), store);
		engine.registerVaultEvents(vi.fn());

		await app.vault.emit("rename", makeTFolderInstance("archive"), "docs");

		expect(client.moveFile).toHaveBeenCalledWith("docs", "archive");
		expect(store.files["archive/a.md"]).toBeDefined();
		expect(store.files["archive/b.md"]).toBeDefined();
		expect(store.files["docs/a.md"]).toBeUndefined();
		expect(store.files["docs/b.md"]).toBeUndefined();
	});

	it("does nothing when no tracked files are inside the folder", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient();
		const engine = makeEngine(app, client, makeSettings(), store);
		engine.registerVaultEvents(vi.fn());

		await app.vault.emit("rename", makeTFolderInstance("archive"), "docs");

		expect(client.moveFile).not.toHaveBeenCalled();
	});
});

describe("registerVaultEvents: delete file", () => {
	it("calls deleteFile and removes from store when file is tracked", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		store.files["notes.md"] = { localMtime: 1000, remoteMtime: 1000 };
		const client = makeMockClient();
		const engine = makeEngine(app, client, makeSettings({ deletionHandling: "mirror" }), store);
		engine.registerVaultEvents(vi.fn());

		await app.vault.emit("delete", makeTFileInstance("notes.md"));

		expect(client.deleteFile).toHaveBeenCalledWith("notes.md");
		expect(store.files["notes.md"]).toBeUndefined();
	});

	it("does nothing when file is not tracked", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		const client = makeMockClient();
		const engine = makeEngine(app, client, makeSettings(), store);
		engine.registerVaultEvents(vi.fn());

		await app.vault.emit("delete", makeTFileInstance("notes.md"));

		expect(client.deleteFile).not.toHaveBeenCalled();
	});

	it("does nothing when syncDirection is remote-to-local", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		store.files["notes.md"] = { localMtime: 1000, remoteMtime: 1000 };
		const client = makeMockClient();
		const engine = makeEngine(
			app,
			client,
			makeSettings({ syncDirection: "remote-to-local" }),
			store,
		);
		engine.registerVaultEvents(vi.fn());

		await app.vault.emit("delete", makeTFileInstance("notes.md"));

		expect(client.deleteFile).not.toHaveBeenCalled();
	});

	it("does nothing when deletionHandling is never-delete-remote", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		store.files["notes.md"] = { localMtime: 1000, remoteMtime: 1000 };
		const client = makeMockClient();
		const engine = makeEngine(
			app,
			client,
			makeSettings({ deletionHandling: "never-delete-remote" }),
			store,
		);
		engine.registerVaultEvents(vi.fn());

		await app.vault.emit("delete", makeTFileInstance("notes.md"));

		expect(client.deleteFile).not.toHaveBeenCalled();
	});
});

describe("registerVaultEvents: delete folder", () => {
	it("calls deleteFile for each tracked file inside and removes them from store", async () => {
		const app = new MockApp();
		const store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		store.files["docs/a.md"] = { localMtime: 1000, remoteMtime: 1000 };
		store.files["docs/b.md"] = { localMtime: 1000, remoteMtime: 1000 };
		const client = makeMockClient();
		const engine = makeEngine(app, client, makeSettings({ deletionHandling: "mirror" }), store);
		engine.registerVaultEvents(vi.fn());

		await app.vault.emit("delete", makeTFolderInstance("docs"));

		expect(client.deleteFile).toHaveBeenCalledWith("docs/a.md");
		expect(client.deleteFile).toHaveBeenCalledWith("docs/b.md");
		expect(store.files["docs/a.md"]).toBeUndefined();
		expect(store.files["docs/b.md"]).toBeUndefined();
	});
});

// ─── Integration: real Docker WebDAV server ───────────────────────────────────

function makeIntegrationSettings(remoteBasePath: string): WebdavSyncSettings {
	return {
		...DEFAULT_SETTINGS,
		serverUrl: WEBDAV_URL,
		username: WEBDAV_USERNAME,
		passwordSecret: "test-key",
		remoteBasePath,
	};
}

describe("SyncEngine integration (Docker WebDAV)", () => {
	let app: MockApp;
	let store: StateStore;
	let client: Client;
	let settings: WebdavSyncSettings;

	beforeEach(async () => {
		// Each test gets its own directory so runs are fully isolated.
		// Leading slash is required for stripBasePath() to recognise the prefix.
		const prefix = `/test-${crypto.randomUUID()}`;
		app = new MockApp(WEBDAV_PASSWORD);
		store = new StateStore(app as never, ".obsidian/plugins/webdav-sync");
		settings = makeIntegrationSettings(prefix);
		client = new Client(app as never, settings);

		// Create the isolated remote directory using a root-level client.
		const setupClient = new Client(
			new MockApp(WEBDAV_PASSWORD) as never,
			makeIntegrationSettings(""),
		);
		await setupClient.ensureDirectory(prefix);
	});

	it("uploads new local files to the remote server", async () => {
		const content = new TextEncoder().encode("sync test content").buffer as ArrayBuffer;
		app.vault.addFile(makeTFile("note.md", Date.now()), content);

		await makeEngine(app, client, settings, store).sync();

		const downloaded = await client.downloadFile("note.md");
		expect(new TextDecoder().decode(downloaded)).toBe("sync test content");
	});

	it("downloads new remote files into the vault", async () => {
		const content = new TextEncoder().encode("remote content").buffer as ArrayBuffer;
		await client.uploadFile("remote.md", content);

		await makeEngine(app, client, settings, store).sync();

		expect(app.vault.getFileByPath("remote.md")).not.toBeNull();
	});

	it("re-uploads a file whose local mtime increased since the last sync", async () => {
		const file = makeTFile("stable.md", 1000);
		app.vault.addFile(file, new TextEncoder().encode("v1").buffer as ArrayBuffer);

		const engine = makeEngine(app, client, settings, store);
		await engine.sync(); // uploads; tracked.localMtime = 1000

		// Simulate a local edit: bump mtime far into the future so it always
		// wins newest-wins conflict resolution against the server's real mtime.
		file.stat.mtime = Date.now() + 60_000;
		app.vault.addFile(file, new TextEncoder().encode("v2").buffer as ArrayBuffer);

		const uploadSpy = vi.spyOn(client, "uploadFile");
		await engine.sync(); // localChanged = true → re-upload

		expect(uploadSpy).toHaveBeenCalledWith("stable.md", expect.anything());
	});

	it("persists state entries for each synced file", async () => {
		app.vault.addFile(
			makeTFile("tracked.md", Date.now()),
			new TextEncoder().encode("x").buffer as ArrayBuffer,
		);

		await makeEngine(app, client, settings, store).sync();

		expect(store.files["tracked.md"]?.localMtime).toBeGreaterThan(0);
	});
});
