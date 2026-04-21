import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WebdavSyncSettings } from "../../src/settings";
import { SyncEngine } from "../../src/sync/engine";
import { loadState, saveState } from "../../src/sync/state";
import {
	makeRemoteFile,
	makeSettings,
	makeState,
	makeTFile,
	mockApp,
	mockClient,
	mockVault,
} from "../mocks";

vi.mock("obsidian", () => ({}));
vi.mock("../../src/sync/state");

const mockLoadState = vi.mocked(loadState);
const mockSaveState = vi.mocked(saveState);

function makeEngine(overrides: Partial<WebdavSyncSettings> = {}): SyncEngine {
	return new SyncEngine(mockApp, mockClient as never, makeSettings(overrides));
}

beforeEach(() => {
	vi.clearAllMocks();
	mockSaveState.mockResolvedValue(undefined);
	mockVault.readBinary.mockResolvedValue(new ArrayBuffer(0));
	mockVault.modifyBinary.mockResolvedValue(undefined);
	mockVault.createBinary.mockResolvedValue(undefined);
	mockVault.createFolder.mockResolvedValue(undefined);
	mockVault.delete.mockResolvedValue(undefined);
	mockVault.getFileByPath.mockReturnValue(null);
	mockClient.uploadFile.mockResolvedValue(undefined);
	mockClient.downloadFile.mockResolvedValue(new ArrayBuffer(0));
	mockClient.deleteFile.mockResolvedValue(undefined);
	mockClient.ensureDirectory.mockResolvedValue(undefined);
});

// --- classify decision table ---

describe("classify", () => {
	it("local only, untracked → upload", async () => {
		const local = makeTFile("notes/a.md", 100);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([]);
		mockLoadState.mockResolvedValue(makeState());

		await makeEngine().sync();

		expect(mockClient.uploadFile).toHaveBeenCalledWith("notes/a.md", expect.anything());
	});

	it("remote only, untracked → download", async () => {
		mockVault.getFiles.mockReturnValue([]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/notes/a.md", 100)]);
		mockLoadState.mockResolvedValue(makeState());

		await makeEngine().sync();

		expect(mockClient.downloadFile).toHaveBeenCalledWith("/vault/notes/a.md");
	});

	it("both sides, untracked → conflict (defaults to newest-wins → upload when local is newer)", async () => {
		const local = makeTFile("notes/a.md", 200);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/notes/a.md", 100)]);
		mockLoadState.mockResolvedValue(makeState());

		await makeEngine().sync();

		expect(mockClient.uploadFile).toHaveBeenCalledWith("notes/a.md", expect.anything());
	});

	it("both sides, tracked, only local changed → upload", async () => {
		const local = makeTFile("notes/a.md", 200);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/notes/a.md", 100)]);
		mockLoadState.mockResolvedValue(
			makeState({ "notes/a.md": { localMtime: 100, remoteMtime: 100 } }),
		);

		await makeEngine().sync();

		expect(mockClient.uploadFile).toHaveBeenCalledWith("notes/a.md", expect.anything());
		expect(mockClient.downloadFile).not.toHaveBeenCalled();
	});

	it("both sides, tracked, only remote changed → download", async () => {
		const local = makeTFile("notes/a.md", 100);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/notes/a.md", 200)]);
		mockLoadState.mockResolvedValue(
			makeState({ "notes/a.md": { localMtime: 100, remoteMtime: 100 } }),
		);

		await makeEngine().sync();

		expect(mockClient.downloadFile).toHaveBeenCalledWith("/vault/notes/a.md");
		expect(mockClient.uploadFile).not.toHaveBeenCalled();
	});

	it("both sides, tracked, both changed → conflict (newest-wins: upload when local newer)", async () => {
		const local = makeTFile("notes/a.md", 300);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/notes/a.md", 200)]);
		mockLoadState.mockResolvedValue(
			makeState({ "notes/a.md": { localMtime: 100, remoteMtime: 100 } }),
		);

		await makeEngine().sync();

		expect(mockClient.uploadFile).toHaveBeenCalled();
	});

	it("both sides, tracked, neither changed → skip", async () => {
		const local = makeTFile("notes/a.md", 100);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/notes/a.md", 100)]);
		mockLoadState.mockResolvedValue(
			makeState({ "notes/a.md": { localMtime: 100, remoteMtime: 100 } }),
		);

		await makeEngine().sync();

		expect(mockClient.uploadFile).not.toHaveBeenCalled();
		expect(mockClient.downloadFile).not.toHaveBeenCalled();
	});

	it("local only, tracked → delete-local (remote deleted it)", async () => {
		const local = makeTFile("notes/a.md", 100);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([]);
		mockLoadState.mockResolvedValue(
			makeState({ "notes/a.md": { localMtime: 100, remoteMtime: 100 } }),
		);

		await makeEngine().sync();

		expect(mockVault.delete).toHaveBeenCalledWith(local);
	});

	it("remote only, tracked → delete-remote (local deleted it)", async () => {
		mockVault.getFiles.mockReturnValue([]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/notes/a.md", 100)]);
		mockLoadState.mockResolvedValue(
			makeState({ "notes/a.md": { localMtime: 100, remoteMtime: 100 } }),
		);

		await makeEngine().sync();

		expect(mockClient.deleteFile).toHaveBeenCalledWith("/vault/notes/a.md");
	});
});

// --- execute: direction guards ---

describe("execute — direction guards", () => {
	it("remote-to-local skips uploads", async () => {
		const local = makeTFile("a.md", 100);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([]);
		mockLoadState.mockResolvedValue(makeState());

		await makeEngine({ syncDirection: "remote-to-local" }).sync();

		expect(mockClient.uploadFile).not.toHaveBeenCalled();
	});

	it("local-to-remote skips downloads", async () => {
		mockVault.getFiles.mockReturnValue([]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/a.md", 100)]);
		mockLoadState.mockResolvedValue(makeState());

		await makeEngine({ syncDirection: "local-to-remote" }).sync();

		expect(mockClient.downloadFile).not.toHaveBeenCalled();
	});

	it("remote-to-local skips delete-remote", async () => {
		mockVault.getFiles.mockReturnValue([]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/a.md", 100)]);
		mockLoadState.mockResolvedValue(makeState({ "a.md": { localMtime: 100, remoteMtime: 100 } }));

		await makeEngine({ syncDirection: "remote-to-local" }).sync();

		expect(mockClient.deleteFile).not.toHaveBeenCalled();
	});

	it("local-to-remote skips delete-local", async () => {
		const local = makeTFile("a.md", 100);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([]);
		mockLoadState.mockResolvedValue(makeState({ "a.md": { localMtime: 100, remoteMtime: 100 } }));

		await makeEngine({ syncDirection: "local-to-remote" }).sync();

		expect(mockVault.delete).not.toHaveBeenCalled();
	});
});

// --- execute: deletion handling guards ---

describe("execute — deletion handling guards", () => {
	it("never-delete-remote skips delete-remote actions", async () => {
		mockVault.getFiles.mockReturnValue([]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/a.md", 100)]);
		mockLoadState.mockResolvedValue(makeState({ "a.md": { localMtime: 100, remoteMtime: 100 } }));

		await makeEngine({ deletionHandling: "never-delete-remote" }).sync();

		expect(mockClient.deleteFile).not.toHaveBeenCalled();
	});

	it("never-delete-local skips delete-local actions", async () => {
		const local = makeTFile("a.md", 100);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([]);
		mockLoadState.mockResolvedValue(makeState({ "a.md": { localMtime: 100, remoteMtime: 100 } }));

		await makeEngine({ deletionHandling: "never-delete-local" }).sync();

		expect(mockVault.delete).not.toHaveBeenCalled();
	});

	it("mirror executes both delete-remote and delete-local", async () => {
		const local = makeTFile("local-deleted.md", 100);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/remote-deleted.md", 100)]);
		mockLoadState.mockResolvedValue(
			makeState({
				"local-deleted.md": { localMtime: 100, remoteMtime: 100 },
				"remote-deleted.md": { localMtime: 100, remoteMtime: 100 },
			}),
		);

		await makeEngine({ deletionHandling: "mirror" }).sync();

		expect(mockVault.delete).toHaveBeenCalledWith(local);
		expect(mockClient.deleteFile).toHaveBeenCalledWith("/vault/remote-deleted.md");
	});
});

// --- conflict resolution ---

describe("resolveConflict", () => {
	function setupConflict(localMtime: number, remoteMtime: number) {
		const local = makeTFile("notes/a.md", localMtime);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/notes/a.md", remoteMtime)]);
		mockLoadState.mockResolvedValue(makeState()); // untracked → conflict
	}

	it("local-to-remote direction always uploads", async () => {
		setupConflict(100, 200);
		await makeEngine({ syncDirection: "local-to-remote" }).sync();
		expect(mockClient.uploadFile).toHaveBeenCalled();
		expect(mockClient.downloadFile).not.toHaveBeenCalled();
	});

	it("remote-to-local direction always downloads", async () => {
		setupConflict(200, 100);
		await makeEngine({ syncDirection: "remote-to-local" }).sync();
		expect(mockClient.downloadFile).toHaveBeenCalled();
		expect(mockClient.uploadFile).not.toHaveBeenCalled();
	});

	it("two-way + local-wins → upload regardless of mtime", async () => {
		setupConflict(100, 200); // remote is newer
		await makeEngine({ conflictResolution: "local-wins" }).sync();
		expect(mockClient.uploadFile).toHaveBeenCalled();
		expect(mockClient.downloadFile).not.toHaveBeenCalled();
	});

	it("two-way + remote-wins → download regardless of mtime", async () => {
		setupConflict(200, 100); // local is newer
		await makeEngine({ conflictResolution: "remote-wins" }).sync();
		expect(mockClient.downloadFile).toHaveBeenCalled();
		expect(mockClient.uploadFile).not.toHaveBeenCalled();
	});

	it("two-way + newest-wins → upload when local is newer", async () => {
		setupConflict(300, 100);
		await makeEngine({ conflictResolution: "newest-wins" }).sync();
		expect(mockClient.uploadFile).toHaveBeenCalled();
		expect(mockClient.downloadFile).not.toHaveBeenCalled();
	});

	it("two-way + newest-wins → download when remote is newer", async () => {
		setupConflict(100, 300);
		await makeEngine({ conflictResolution: "newest-wins" }).sync();
		expect(mockClient.downloadFile).toHaveBeenCalled();
		expect(mockClient.uploadFile).not.toHaveBeenCalled();
	});

	it("two-way + ask falls back to newest-wins", async () => {
		setupConflict(100, 300); // remote is newer
		await makeEngine({ conflictResolution: "ask" }).sync();
		expect(mockClient.downloadFile).toHaveBeenCalled();
		expect(mockClient.uploadFile).not.toHaveBeenCalled();
	});
});

// --- getLocalFiles scope filters ---

describe("getLocalFiles — scope filters", () => {
	const files = [
		makeTFile(".obsidian/config", 100, ""),
		makeTFile("notes/a.md", 100, "md"),
		makeTFile("assets/img.png", 100, "png"),
		makeTFile("work/b.md", 100, "md"),
	];

	beforeEach(() => {
		mockClient.listAllFiles.mockResolvedValue([]);
		mockLoadState.mockResolvedValue(makeState());
		mockVault.getFiles.mockReturnValue(files);
	});

	it("full-vault includes all files", async () => {
		await makeEngine({ syncScope: "full-vault" }).sync();
		expect(mockClient.uploadFile).toHaveBeenCalledTimes(4);
	});

	it("exclude-obsidian skips .obsidian/ files", async () => {
		await makeEngine({ syncScope: "exclude-obsidian" }).sync();
		expect(mockClient.uploadFile).toHaveBeenCalledTimes(3);
		expect(mockClient.uploadFile).not.toHaveBeenCalledWith(".obsidian/config", expect.anything());
	});

	it("markdown-only includes only .md files", async () => {
		await makeEngine({ syncScope: "markdown-only" }).sync();
		expect(mockClient.uploadFile).toHaveBeenCalledTimes(2);
		expect(mockClient.uploadFile).toHaveBeenCalledWith("notes/a.md", expect.anything());
		expect(mockClient.uploadFile).toHaveBeenCalledWith("work/b.md", expect.anything());
	});

	it("custom-folder includes only files under the configured folder", async () => {
		await makeEngine({ syncScope: "custom-folder", customSyncFolder: "work" }).sync();
		expect(mockClient.uploadFile).toHaveBeenCalledTimes(1);
		expect(mockClient.uploadFile).toHaveBeenCalledWith("work/b.md", expect.anything());
	});
});

// --- upload / download state mutations ---

describe("upload — state mutation", () => {
	it("sets both localMtime and remoteMtime to the file's mtime", async () => {
		const local = makeTFile("a.md", 500);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([]);
		const state = makeState();
		mockLoadState.mockResolvedValue(state);

		await makeEngine().sync();

		expect(state.files["a.md"]).toEqual({ localMtime: 500, remoteMtime: 500 });
	});

	it("calls ensureDirectory when the file has a parent folder", async () => {
		const local = makeTFile("notes/a.md", 100);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([]);
		mockLoadState.mockResolvedValue(makeState());

		await makeEngine().sync();

		expect(mockClient.ensureDirectory).toHaveBeenCalledWith("notes");
	});
});

describe("download — state mutation", () => {
	it("sets both localMtime and remoteMtime to the remote mtime", async () => {
		mockVault.getFiles.mockReturnValue([]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/a.md", 800)]);
		const state = makeState();
		mockLoadState.mockResolvedValue(state);

		await makeEngine().sync();

		expect(state.files["a.md"]).toEqual({ localMtime: 800, remoteMtime: 800 });
	});

	it("calls modifyBinary when the file already exists locally", async () => {
		const existingFile = makeTFile("a.md", 100);
		mockVault.getFiles.mockReturnValue([]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/a.md", 200)]);
		mockLoadState.mockResolvedValue(makeState());
		mockVault.getFileByPath.mockReturnValue(existingFile);

		await makeEngine().sync();

		expect(mockVault.modifyBinary).toHaveBeenCalledWith(existingFile, expect.anything());
		expect(mockVault.createBinary).not.toHaveBeenCalled();
	});

	it("calls createBinary (and createFolder) when file does not exist locally", async () => {
		mockVault.getFiles.mockReturnValue([]);
		mockClient.listAllFiles.mockResolvedValue([makeRemoteFile("/vault/notes/a.md", 200)]);
		mockLoadState.mockResolvedValue(makeState());
		mockVault.getFileByPath.mockReturnValue(null);

		await makeEngine().sync();

		expect(mockVault.createFolder).toHaveBeenCalledWith("notes");
		expect(mockVault.createBinary).toHaveBeenCalledWith("notes/a.md", expect.anything());
	});
});

// --- sync lifecycle ---

describe("sync — state lifecycle", () => {
	it("calls saveState after a successful sync", async () => {
		mockVault.getFiles.mockReturnValue([]);
		mockClient.listAllFiles.mockResolvedValue([]);
		mockLoadState.mockResolvedValue(makeState());

		await makeEngine().sync();

		expect(mockSaveState).toHaveBeenCalledOnce();
	});

	it("does not call saveState when execute throws mid-sync", async () => {
		const local = makeTFile("a.md", 100);
		mockVault.getFiles.mockReturnValue([local]);
		mockClient.listAllFiles.mockResolvedValue([]);
		mockLoadState.mockResolvedValue(makeState());
		mockClient.uploadFile.mockRejectedValue(new Error("network failure"));

		await expect(makeEngine().sync()).rejects.toThrow("network failure");

		expect(mockSaveState).not.toHaveBeenCalled();
	});
});
