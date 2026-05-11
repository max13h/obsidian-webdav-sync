export interface TFileStub {
	path: string;
	extension: string;
	parent: { path: string } | null;
	stat: { mtime: number; ctime: number; size: number };
}

export function makeTFile(path: string, mtime: number): TFileStub {
	const parts = path.split("/");
	const parentPath = parts.slice(0, -1).join("/");
	return {
		path,
		extension: path.split(".").pop() ?? "",
		parent: parentPath ? { path: parentPath } : null,
		stat: { mtime, ctime: mtime, size: 0 },
	};
}

type FileEntry = { file: TFileStub; content: ArrayBuffer };

export class MockVaultAdapter {
	// Text files (state.json etc.) — kept public for tests that inspect state directly
	files = new Map<string, string>();

	constructor(private _binaryFiles: Map<string, FileEntry>) {}

	// --- text (state store) ---

	async read(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`File not found: ${path}`);
		return content;
	}

	async write(path: string, content: string): Promise<void> {
		this.files.set(path, content);
	}

	// --- binary ---

	async readBinary(path: string): Promise<ArrayBuffer> {
		const entry = this._binaryFiles.get(path);
		if (!entry) throw new Error(`File not found: ${path}`);
		return entry.content;
	}

	async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
		const existing = this._binaryFiles.get(path);
		if (existing) {
			existing.content = content;
		} else {
			const parts = path.split("/");
			const parentPath = parts.slice(0, -1).join("/");
			const stub: TFileStub = {
				path,
				extension: (parts.at(-1) ?? "").split(".").pop() ?? "",
				parent: parentPath ? { path: parentPath } : null,
				stat: { mtime: Date.now(), ctime: Date.now(), size: content.byteLength },
			};
			this._binaryFiles.set(path, { file: stub, content });
		}
	}

	// --- filesystem ---

	async exists(path: string): Promise<boolean> {
		return this._binaryFiles.has(path) || this.files.has(path);
	}

	async remove(path: string): Promise<void> {
		this._binaryFiles.delete(path);
	}

	async mkdir(_path: string): Promise<void> {}

	async stat(
		path: string,
	): Promise<{ type: "file"; mtime: number; ctime: number; size: number } | null> {
		const entry = this._binaryFiles.get(path);
		if (!entry) return null;
		return {
			type: "file",
			mtime: entry.file.stat.mtime,
			ctime: entry.file.stat.ctime,
			size: entry.file.stat.size,
		};
	}

	async list(dirPath: string): Promise<{ files: string[]; folders: string[] }> {
		const prefix = dirPath === "" || dirPath === "/" ? "" : `${dirPath}/`;
		const files: string[] = [];
		const folders = new Set<string>();

		for (const filePath of this._binaryFiles.keys()) {
			if (prefix && !filePath.startsWith(prefix)) continue;
			const rest = prefix ? filePath.slice(prefix.length) : filePath;
			const slashIdx = rest.indexOf("/");
			if (slashIdx === -1) {
				files.push(filePath);
			} else {
				folders.add(`${prefix}${rest.slice(0, slashIdx)}`);
			}
		}

		return { files, folders: [...folders] };
	}
}

export class MockVault {
	private _files = new Map<string, FileEntry>();
	private _handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();
	adapter: MockVaultAdapter;

	constructor() {
		this.adapter = new MockVaultAdapter(this._files);
	}

	on(event: string, callback: (...args: unknown[]) => unknown): { id: symbol } {
		if (!this._handlers.has(event)) this._handlers.set(event, []);
		this._handlers.get(event)?.push(callback);
		return { id: Symbol() };
	}

	async emit(event: string, ...args: unknown[]): Promise<void> {
		for (const handler of this._handlers.get(event) ?? []) {
			await handler(...args);
		}
	}

	addFile(file: TFileStub, content: ArrayBuffer = new ArrayBuffer(0)) {
		this._files.set(file.path, { file, content });
	}

	getFiles(): TFileStub[] {
		return [...this._files.values()]
			.map((v) => v.file)
			.filter((f) => !f.path.startsWith(".obsidian/"));
	}

	getFileByPath(path: string): TFileStub | null {
		return this._files.get(path)?.file ?? null;
	}

	async readBinary(file: TFileStub): Promise<ArrayBuffer> {
		const entry = this._files.get(file.path);
		if (!entry) throw new Error(`File not found: ${file.path}`);
		return entry.content;
	}

	async modifyBinary(file: TFileStub, content: ArrayBuffer): Promise<void> {
		const entry = this._files.get(file.path);
		if (!entry) throw new Error(`File not found: ${file.path}`);
		entry.content = content;
	}

	async createBinary(path: string, content: ArrayBuffer): Promise<TFileStub> {
		const file = makeTFile(path, Date.now());
		this._files.set(path, { file, content });
		return file;
	}

	async createFolder(_path: string): Promise<void> {}

	async delete(file: TFileStub): Promise<void> {
		this._files.delete(file.path);
	}
}

export class MockApp {
	vault: MockVault;
	secretStorage: { getSecret: (_key: string) => string };

	constructor(password = "test") {
		this.vault = new MockVault();
		this.secretStorage = { getSecret: () => password };
	}
}
