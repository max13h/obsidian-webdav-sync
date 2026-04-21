import { describe, expect, it, vi } from "vitest";
import { loadState, saveState } from "../../src/sync/state";
import { makeVault, makeVaultApp } from "../mocks";

vi.mock("obsidian", () => ({}));

describe("loadState", () => {
	it("returns empty state when state file does not exist", async () => {
		const state = await loadState(makeVaultApp());
		expect(state).toEqual({ lastSync: 0, files: {} });
	});

	it("returns parsed state when file exists and contains valid JSON", async () => {
		const stored = {
			lastSync: 1000,
			files: { "notes/a.md": { localMtime: 100, remoteMtime: 100 } },
		};
		const app = makeVaultApp({
			getFileByPath: vi.fn().mockReturnValue({ path: ".webdav-sync-state.json" }),
			read: vi.fn().mockResolvedValue(JSON.stringify(stored)),
		});

		const state = await loadState(app);

		expect(state).toEqual(stored);
	});

	it("returns empty state when file contains invalid JSON", async () => {
		const app = makeVaultApp({
			getFileByPath: vi.fn().mockReturnValue({ path: ".webdav-sync-state.json" }),
			read: vi.fn().mockResolvedValue("not-json{{{"),
		});

		const state = await loadState(app);

		expect(state).toEqual({ lastSync: 0, files: {} });
	});

	it("returns empty state when read throws", async () => {
		const app = makeVaultApp({
			getFileByPath: vi.fn().mockReturnValue({ path: ".webdav-sync-state.json" }),
			read: vi.fn().mockRejectedValue(new Error("disk error")),
		});

		const state = await loadState(app);

		expect(state).toEqual({ lastSync: 0, files: {} });
	});
});

describe("saveState", () => {
	const state = { lastSync: 500, files: { "a.md": { localMtime: 1, remoteMtime: 1 } } };
	const expectedJson = JSON.stringify(state, null, 2);

	it("modifies the existing file when it already exists", async () => {
		const file = { path: ".webdav-sync-state.json" };
		const vault = makeVault({ getFileByPath: vi.fn().mockReturnValue(file) });
		const app = { vault } as never;

		await saveState(app, state);

		expect(vault.modify).toHaveBeenCalledWith(file, expectedJson);
		expect(vault.create).not.toHaveBeenCalled();
	});

	it("creates a new file when none exists", async () => {
		const vault = makeVault();
		const app = { vault } as never;

		await saveState(app, state);

		expect(vault.create).toHaveBeenCalledWith(".webdav-sync-state.json", expectedJson);
		expect(vault.modify).not.toHaveBeenCalled();
	});
});
