import type { TFile } from "obsidian";
import { vi } from "vitest";

// --- vault & app factories (fresh instance per test, used in state tests) ---

export function makeVault(overrides: Record<string, ReturnType<typeof vi.fn>> = {}) {
	return {
		getFileByPath: vi.fn().mockReturnValue(null),
		read: vi.fn(),
		modify: vi.fn().mockResolvedValue(undefined),
		create: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
}

export function makeVaultApp(overrides?: Record<string, ReturnType<typeof vi.fn>>) {
	return { vault: makeVault(overrides) } as never;
}

// App with secretStorage (used in Client tests)
export function makeClientApp(password = "secret") {
	return {
		secretStorage: {
			getSecret: vi.fn().mockResolvedValue(password),
		},
	} as never;
}

// --- shared instances (cleared by vi.clearAllMocks(), used in engine tests) ---

export const mockVault = {
	getFiles: vi.fn(),
	readBinary: vi.fn(),
	modifyBinary: vi.fn(),
	createBinary: vi.fn(),
	createFolder: vi.fn(),
	delete: vi.fn(),
	getFileByPath: vi.fn(),
};

export const mockApp = { vault: mockVault } as never;

// --- TFile factory ---

export function makeTFile(path: string, mtime: number, extension = "md"): TFile {
	const parts = path.split("/");
	const parentPath = parts.length > 1 ? parts.slice(0, -1).join("/") : null;
	return {
		path,
		extension,
		stat: { mtime, ctime: 0, size: 0 },
		parent: parentPath ? { path: parentPath } : null,
	} as unknown as TFile;
}
