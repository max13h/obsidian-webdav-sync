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

export class MockVaultAdapter {
	files = new Map<string, string>();

	async read(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`File not found: ${path}`);
		return content;
	}

	async write(path: string, content: string): Promise<void> {
		this.files.set(path, content);
	}
}

export class MockVault {
	private _files = new Map<string, { file: TFileStub; content: ArrayBuffer }>();
	private _handlers = new Map<string, ((...args: unknown[]) => unknown)[]>();
	adapter = new MockVaultAdapter();

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
		return [...this._files.values()].map((v) => v.file);
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
