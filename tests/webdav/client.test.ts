import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileStat } from "webdav";
import type { WebdavSyncSettings } from "../../src/settings";
import { Client } from "../../src/webdav/client";

// Mock the webdav module
const mockWebdavClient = {
	getDirectoryContents: vi.fn(),
	putFileContents: vi.fn(),
	getFileContents: vi.fn(),
	deleteFile: vi.fn(),
	createDirectory: vi.fn(),
};

vi.mock("webdav", () => ({
	createClient: vi.fn(() => mockWebdavClient),
}));

// Mock obsidian
vi.mock("obsidian", () => ({}));

function makeApp(password = "secret"): { secretStorage: { getSecret: ReturnType<typeof vi.fn> } } {
	return {
		secretStorage: {
			getSecret: vi.fn().mockResolvedValue(password),
		},
	};
}

function makeSettings(overrides: Partial<WebdavSyncSettings> = {}): WebdavSyncSettings {
	return {
		serverUrl: "https://dav.example.com",
		remoteBasePath: "/vault",
		username: "user",
		passwordSecret: "mySecret",
		syncDirection: "two-way",
		conflictResolution: "newest-wins",
		deletionHandling: "never-delete-remote",
		syncScope: "exclude-obsidian",
		customSyncFolder: "",
		syncOnStartup: false,
		syncOnSave: false,
		periodicSync: false,
		periodicSyncInterval: 5,
		statusBarEnabled: true,
		notificationsEnabled: true,
		...overrides,
	};
}

describe("Client", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("testConnection", () => {
		it("returns true when server is reachable", async () => {
			mockWebdavClient.getDirectoryContents.mockResolvedValue([]);
			const client = new Client(makeApp() as never, makeSettings());

			const result = await client.testConnection();

			expect(result).toBe(true);
			expect(mockWebdavClient.getDirectoryContents).toHaveBeenCalledWith("/vault");
		});

		it("uses '/' as base path when remoteBasePath is empty", async () => {
			mockWebdavClient.getDirectoryContents.mockResolvedValue([]);
			const client = new Client(makeApp() as never, makeSettings({ remoteBasePath: "" }));

			await client.testConnection();

			expect(mockWebdavClient.getDirectoryContents).toHaveBeenCalledWith("/");
		});

		it("returns false when the server throws", async () => {
			mockWebdavClient.getDirectoryContents.mockRejectedValue(new Error("Network error"));
			const client = new Client(makeApp() as never, makeSettings());

			const result = await client.testConnection();

			expect(result).toBe(false);
		});
	});

	describe("uploadFile", () => {
		it("uploads to the resolved path", async () => {
			mockWebdavClient.putFileContents.mockResolvedValue(undefined);
			const client = new Client(makeApp() as never, makeSettings());
			const content = new ArrayBuffer(4);

			await client.uploadFile("notes/file.md", content);

			expect(mockWebdavClient.putFileContents).toHaveBeenCalledWith(
				"/vault/notes/file.md",
				content,
				{ overwrite: true },
			);
		});

		it("handles leading slash in remote path", async () => {
			mockWebdavClient.putFileContents.mockResolvedValue(undefined);
			const client = new Client(makeApp() as never, makeSettings());

			await client.uploadFile("/notes/file.md", new ArrayBuffer(0));

			expect(mockWebdavClient.putFileContents).toHaveBeenCalledWith(
				"/vault/notes/file.md",
				expect.anything(),
				{ overwrite: true },
			);
		});
	});

	describe("downloadFile", () => {
		it("returns the file contents from the resolved path", async () => {
			const buffer = new ArrayBuffer(8);
			mockWebdavClient.getFileContents.mockResolvedValue(buffer);
			const client = new Client(makeApp() as never, makeSettings());

			const result = await client.downloadFile("notes/file.md");

			expect(result).toBe(buffer);
			expect(mockWebdavClient.getFileContents).toHaveBeenCalledWith("/vault/notes/file.md");
		});
	});

	describe("deleteFile", () => {
		it("deletes at the resolved path", async () => {
			mockWebdavClient.deleteFile.mockResolvedValue(undefined);
			const client = new Client(makeApp() as never, makeSettings());

			await client.deleteFile("notes/old.md");

			expect(mockWebdavClient.deleteFile).toHaveBeenCalledWith("/vault/notes/old.md");
		});
	});

	describe("ensureDirectory", () => {
		it("creates each path segment incrementally", async () => {
			mockWebdavClient.createDirectory.mockResolvedValue(undefined);
			const client = new Client(makeApp() as never, makeSettings());

			await client.ensureDirectory("a/b/c");

			expect(mockWebdavClient.createDirectory).toHaveBeenCalledTimes(4);
			expect(mockWebdavClient.createDirectory).toHaveBeenNthCalledWith(1, "/vault");
			expect(mockWebdavClient.createDirectory).toHaveBeenNthCalledWith(2, "/vault/a");
			expect(mockWebdavClient.createDirectory).toHaveBeenNthCalledWith(3, "/vault/a/b");
			expect(mockWebdavClient.createDirectory).toHaveBeenNthCalledWith(4, "/vault/a/b/c");
		});

		it("silently continues when createDirectory throws (directory already exists)", async () => {
			mockWebdavClient.createDirectory.mockRejectedValue(new Error("Already exists"));
			const client = new Client(makeApp() as never, makeSettings());

			await expect(client.ensureDirectory("a/b")).resolves.toBeUndefined();
		});
	});

	describe("listAllFiles", () => {
		it("returns only files, not directories", async () => {
			const items: Partial<FileStat>[] = [
				{ type: "file", filename: "/vault/a.md" },
				{ type: "directory", filename: "/vault/subdir" },
				{ type: "file", filename: "/vault/b.md" },
			];
			mockWebdavClient.getDirectoryContents.mockResolvedValue(items);
			const client = new Client(makeApp() as never, makeSettings());

			const result = await client.listAllFiles("/");

			expect(result).toHaveLength(2);
			expect(result.every((f) => f.type === "file")).toBe(true);
		});

		it("calls getDirectoryContents with deep: true", async () => {
			mockWebdavClient.getDirectoryContents.mockResolvedValue([]);
			const client = new Client(makeApp() as never, makeSettings());

			await client.listAllFiles("/");

			expect(mockWebdavClient.getDirectoryContents).toHaveBeenCalledWith("/vault/", { deep: true });
		});
	});

	describe("path resolution", () => {
		it("strips trailing slash from remoteBasePath", async () => {
			mockWebdavClient.putFileContents.mockResolvedValue(undefined);
			const client = new Client(makeApp() as never, makeSettings({ remoteBasePath: "/vault/" }));

			await client.uploadFile("file.md", new ArrayBuffer(0));

			expect(mockWebdavClient.putFileContents).toHaveBeenCalledWith(
				"/vault/file.md",
				expect.anything(),
				expect.anything(),
			);
		});

		it("works with no remoteBasePath", async () => {
			mockWebdavClient.putFileContents.mockResolvedValue(undefined);
			const client = new Client(makeApp() as never, makeSettings({ remoteBasePath: "" }));

			await client.uploadFile("file.md", new ArrayBuffer(0));

			expect(mockWebdavClient.putFileContents).toHaveBeenCalledWith(
				"/file.md",
				expect.anything(),
				expect.anything(),
			);
		});
	});
});
