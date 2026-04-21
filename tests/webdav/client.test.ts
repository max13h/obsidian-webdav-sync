import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileStat } from "webdav";
import { createClient } from "webdav";
import { Client } from "../../src/webdav/client";
import { makeClientApp, makeSettings, mockWebdavLibClient } from "../mocks";

vi.mock("obsidian", () => ({}));
vi.mock("webdav");

describe("Client", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(createClient).mockReturnValue(mockWebdavLibClient as never);
	});

	describe("getClient — credential resolution", () => {
		it("passes the resolved password string (not a Promise) to createClient", async () => {
			mockWebdavLibClient.getDirectoryContents.mockResolvedValue([]);
			const client = new Client(makeClientApp("s3cr3t"), makeSettings({ username: "alice" }));

			await client.testConnection();

			expect(vi.mocked(createClient)).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ username: "alice", password: "s3cr3t" }),
			);
		});
	});

	describe("testConnection", () => {
		it("returns true when server is reachable", async () => {
			mockWebdavLibClient.getDirectoryContents.mockResolvedValue([]);
			const client = new Client(makeClientApp(), makeSettings());

			const result = await client.testConnection();

			expect(result).toBe(true);
			expect(mockWebdavLibClient.getDirectoryContents).toHaveBeenCalledWith("/vault");
		});

		it("uses '/' as base path when remoteBasePath is empty", async () => {
			mockWebdavLibClient.getDirectoryContents.mockResolvedValue([]);
			const client = new Client(makeClientApp(), makeSettings({ remoteBasePath: "" }));

			await client.testConnection();

			expect(mockWebdavLibClient.getDirectoryContents).toHaveBeenCalledWith("/");
		});

		it("returns false when the server throws", async () => {
			mockWebdavLibClient.getDirectoryContents.mockRejectedValue(new Error("Network error"));
			const client = new Client(makeClientApp(), makeSettings());

			const result = await client.testConnection();

			expect(result).toBe(false);
		});
	});

	describe("uploadFile", () => {
		it("uploads to the resolved path", async () => {
			mockWebdavLibClient.putFileContents.mockResolvedValue(undefined);
			const client = new Client(makeClientApp(), makeSettings());
			const content = new ArrayBuffer(4);

			await client.uploadFile("notes/file.md", content);

			expect(mockWebdavLibClient.putFileContents).toHaveBeenCalledWith(
				"/vault/notes/file.md",
				content,
				{ overwrite: true },
			);
		});

		it("handles leading slash in remote path", async () => {
			mockWebdavLibClient.putFileContents.mockResolvedValue(undefined);
			const client = new Client(makeClientApp(), makeSettings());

			await client.uploadFile("/notes/file.md", new ArrayBuffer(0));

			expect(mockWebdavLibClient.putFileContents).toHaveBeenCalledWith(
				"/vault/notes/file.md",
				expect.anything(),
				{ overwrite: true },
			);
		});
	});

	describe("downloadFile", () => {
		it("returns the file contents from the resolved path", async () => {
			const buffer = new ArrayBuffer(8);
			mockWebdavLibClient.getFileContents.mockResolvedValue(buffer);
			const client = new Client(makeClientApp(), makeSettings());

			const result = await client.downloadFile("notes/file.md");

			expect(result).toBe(buffer);
			expect(mockWebdavLibClient.getFileContents).toHaveBeenCalledWith("/vault/notes/file.md");
		});
	});

	describe("deleteFile", () => {
		it("deletes at the resolved path", async () => {
			mockWebdavLibClient.deleteFile.mockResolvedValue(undefined);
			const client = new Client(makeClientApp(), makeSettings());

			await client.deleteFile("notes/old.md");

			expect(mockWebdavLibClient.deleteFile).toHaveBeenCalledWith("/vault/notes/old.md");
		});
	});

	describe("ensureDirectory", () => {
		it("creates each path segment incrementally", async () => {
			mockWebdavLibClient.createDirectory.mockResolvedValue(undefined);
			const client = new Client(makeClientApp(), makeSettings());

			await client.ensureDirectory("a/b/c");

			expect(mockWebdavLibClient.createDirectory).toHaveBeenCalledTimes(4);
			expect(mockWebdavLibClient.createDirectory).toHaveBeenNthCalledWith(1, "/vault");
			expect(mockWebdavLibClient.createDirectory).toHaveBeenNthCalledWith(2, "/vault/a");
			expect(mockWebdavLibClient.createDirectory).toHaveBeenNthCalledWith(3, "/vault/a/b");
			expect(mockWebdavLibClient.createDirectory).toHaveBeenNthCalledWith(4, "/vault/a/b/c");
		});

		it("silently continues when createDirectory throws (directory already exists)", async () => {
			mockWebdavLibClient.createDirectory.mockRejectedValue(new Error("Already exists"));
			const client = new Client(makeClientApp(), makeSettings());

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
			mockWebdavLibClient.getDirectoryContents.mockResolvedValue(items);
			const client = new Client(makeClientApp(), makeSettings());

			const result = await client.listAllFiles("/");

			expect(result).toHaveLength(2);
			expect(result.every((f) => f.type === "file")).toBe(true);
		});

		it("calls getDirectoryContents with deep: true", async () => {
			mockWebdavLibClient.getDirectoryContents.mockResolvedValue([]);
			const client = new Client(makeClientApp(), makeSettings());

			await client.listAllFiles("/");

			expect(mockWebdavLibClient.getDirectoryContents).toHaveBeenCalledWith("/vault/", {
				deep: true,
			});
		});
	});

	describe("path resolution", () => {
		it("strips trailing slash from remoteBasePath", async () => {
			mockWebdavLibClient.putFileContents.mockResolvedValue(undefined);
			const client = new Client(makeClientApp(), makeSettings({ remoteBasePath: "/vault/" }));

			await client.uploadFile("file.md", new ArrayBuffer(0));

			expect(mockWebdavLibClient.putFileContents).toHaveBeenCalledWith(
				"/vault/file.md",
				expect.anything(),
				expect.anything(),
			);
		});

		it("works with no remoteBasePath", async () => {
			mockWebdavLibClient.putFileContents.mockResolvedValue(undefined);
			const client = new Client(makeClientApp(), makeSettings({ remoteBasePath: "" }));

			await client.uploadFile("file.md", new ArrayBuffer(0));

			expect(mockWebdavLibClient.putFileContents).toHaveBeenCalledWith(
				"/file.md",
				expect.anything(),
				expect.anything(),
			);
		});
	});
});
