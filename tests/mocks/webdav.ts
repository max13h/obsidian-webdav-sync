import { vi } from "vitest";
import type { FileStat } from "webdav";

// Raw webdav library client mock (used when testing our Client wrapper)
export const mockWebdavLibClient = {
	getDirectoryContents: vi.fn(),
	putFileContents: vi.fn(),
	getFileContents: vi.fn(),
	deleteFile: vi.fn(),
	createDirectory: vi.fn(),
};

// Mock of our Client class (used when testing SyncEngine)
export const mockClient = {
	listAllFiles: vi.fn(),
	uploadFile: vi.fn(),
	downloadFile: vi.fn(),
	deleteFile: vi.fn(),
	ensureDirectory: vi.fn(),
};

export function makeRemoteFile(filename: string, mtime: number): FileStat {
	return {
		filename,
		type: "file",
		lastmod: new Date(mtime).toISOString(),
		size: 0,
	} as unknown as FileStat;
}
