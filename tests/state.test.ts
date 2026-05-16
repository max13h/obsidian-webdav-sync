import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StateStore } from "../src/sync/state.js";
import { NodeFsApp } from "./helpers/node-fs-app.js";

const PLUGIN_DIR = ".obsidian/plugins/webdav-sync";
const STATE_PATH = `${PLUGIN_DIR}/state.json`;

describe("StateStore", () => {
	let vaultDir: string;
	let app: NodeFsApp;
	let store: StateStore;

	beforeEach(async () => {
		vaultDir = await mkdtemp(join(tmpdir(), "webdav-sync-state-"));
		app = new NodeFsApp(vaultDir, "");
		store = new StateStore(app as never, PLUGIN_DIR);
	});

	afterEach(() => rm(vaultDir, { recursive: true, force: true }));

	it("defaults to empty state when file is missing", async () => {
		await store.load();
		expect(store.lastSync).toBe(0);
		expect(store.files).toEqual({});
	});

	it("parses lastSync and files from valid JSON", async () => {
		const data = {
			lastSync: 1000,
			files: { "notes.md": { localMtime: 500, remoteMtime: 500 } },
		};
		await app.vault.adapter.write(STATE_PATH, JSON.stringify(data));

		await store.load();

		expect(store.lastSync).toBe(1000);
		expect(store.files["notes.md"]).toEqual({ localMtime: 500, remoteMtime: 500 });
	});

	it("falls back to empty state on malformed JSON", async () => {
		await app.vault.adapter.write(STATE_PATH, "not json {{");

		await store.load();

		expect(store.lastSync).toBe(0);
		expect(store.files).toEqual({});
	});

	it("saves well-formed JSON to disk", async () => {
		store.lastSync = 9999;
		store.files["doc.md"] = { localMtime: 100, remoteMtime: 200 };

		await store.save();

		const raw = await app.vault.adapter.read(STATE_PATH);
		const parsed = JSON.parse(raw);
		expect(parsed.lastSync).toBe(9999);
		expect(parsed.files["doc.md"]).toEqual({ localMtime: 100, remoteMtime: 200 });
	});

	it("round-trips through save and load", async () => {
		store.lastSync = 42;
		store.files["a.md"] = { localMtime: 10, remoteMtime: 20 };
		await store.save();

		const store2 = new StateStore(app as never, PLUGIN_DIR);
		await store2.load();

		expect(store2.lastSync).toBe(42);
		expect(store2.files["a.md"]).toEqual({ localMtime: 10, remoteMtime: 20 });
	});
});
