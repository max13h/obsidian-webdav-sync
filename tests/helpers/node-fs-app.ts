import {
	mkdir as fsMkdir,
	readdir as fsReaddir,
	readFile as fsReadFile,
	rm as fsRm,
	stat as fsStat,
	utimes as fsUtimes,
	writeFile as fsWriteFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { TFile, type TFolder } from "obsidian";

type EventHandler = (...args: unknown[]) => unknown;
export type EventRef = { event: string; id: symbol; handler: EventHandler };

function makeTFile(path: string, mtime: number, size = 0): TFile {
	return Object.assign(new TFile(), {
		path,
		extension: path.split(".").pop() ?? "",
		parent: path.includes("/") ? { path: path.split("/").slice(0, -1).join("/") } : null,
		stat: { mtime, ctime: mtime, size },
	});
}

export class NodeFsAdapter {
	constructor(
		private rootDir: string,
		private vault: NodeFsVault,
	) {}

	private abs(path: string): string {
		return join(this.rootDir, path);
	}

	async read(path: string): Promise<string> {
		return fsReadFile(this.abs(path), "utf-8");
	}

	async write(path: string, content: string): Promise<void> {
		await fsMkdir(dirname(this.abs(path)), { recursive: true });
		await fsWriteFile(this.abs(path), content, "utf-8");
	}

	async exists(path: string): Promise<boolean> {
		try {
			await fsStat(this.abs(path));
			return true;
		} catch {
			return false;
		}
	}

	async readBinary(path: string): Promise<ArrayBuffer> {
		const buf = await fsReadFile(this.abs(path));
		return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	}

	async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
		const absPath = this.abs(path);
		await fsMkdir(dirname(absPath), { recursive: true });
		await fsWriteFile(absPath, Buffer.from(content));
		const s = await fsStat(absPath);
		this.vault._setInIndex(path, s.mtimeMs, s.size);
	}

	async mkdir(path: string): Promise<void> {
		await fsMkdir(this.abs(path), { recursive: true });
	}

	async remove(path: string): Promise<void> {
		await fsRm(this.abs(path), { force: true });
		this.vault._removeFromIndex(path);
	}

	async stat(
		path: string,
	): Promise<{ type: "file"; mtime: number; ctime: number; size: number } | null> {
		try {
			const s = await fsStat(this.abs(path));
			return { type: "file", mtime: s.mtimeMs, ctime: s.ctimeMs, size: s.size };
		} catch {
			return null;
		}
	}

	async list(dirPath: string): Promise<{ files: string[]; folders: string[] }> {
		const abs = this.abs(dirPath);
		const entries = await fsReaddir(abs, { withFileTypes: true }).catch(() => []);
		const files: string[] = [];
		const folders: string[] = [];
		for (const entry of entries) {
			const rel = dirPath ? `${dirPath}/${entry.name}` : entry.name;
			if (entry.isDirectory()) folders.push(rel);
			else files.push(rel);
		}
		return { files, folders };
	}
}

export class NodeFsVault {
	private _index = new Map<string, TFile>();
	private _handlers = new Map<string, Set<EventRef>>();
	adapter: NodeFsAdapter;

	constructor(private rootDir: string) {
		this.adapter = new NodeFsAdapter(rootDir, this);
	}

	// ── internal index helpers (called by adapter) ────────────────────────────

	_setInIndex(path: string, mtime: number, size: number): void {
		this._index.set(path, makeTFile(path, mtime, size));
	}

	_removeFromIndex(path: string): void {
		this._index.delete(path);
	}

	// ── vault API ─────────────────────────────────────────────────────────────

	getFiles(): TFile[] {
		return [...this._index.values()].filter((f) => !f.path.startsWith(".obsidian/"));
	}

	getFileByPath(path: string): TFile | null {
		return this._index.get(path) ?? null;
	}

	async readBinary(file: TFile): Promise<ArrayBuffer> {
		return this.adapter.readBinary(file.path);
	}

	async modifyBinary(file: TFile, content: ArrayBuffer): Promise<void> {
		const absPath = join(this.rootDir, file.path);
		await fsWriteFile(absPath, Buffer.from(content));
		const s = await fsStat(absPath);
		file.stat.mtime = s.mtimeMs;
		file.stat.size = s.size;
	}

	async createBinary(path: string, content: ArrayBuffer): Promise<TFile> {
		const absPath = join(this.rootDir, path);
		await fsMkdir(dirname(absPath), { recursive: true });
		await fsWriteFile(absPath, Buffer.from(content));
		const s = await fsStat(absPath);
		const file = makeTFile(path, s.mtimeMs, s.size);
		this._index.set(path, file);
		return file;
	}

	async createFolder(path: string): Promise<void> {
		await fsMkdir(join(this.rootDir, path), { recursive: true });
	}

	async delete(file: TFile): Promise<void> {
		await fsRm(join(this.rootDir, file.path), { force: true });
		this._index.delete(file.path);
		await this._emit("delete", file);
	}

	on(event: string, handler: EventHandler): EventRef {
		if (!this._handlers.has(event)) this._handlers.set(event, new Set());
		const ref: EventRef = { event, id: Symbol(), handler };
		this._handlers.get(event)?.add(ref);
		return ref;
	}

	offref(ref: EventRef): void {
		this._handlers.get(ref.event)?.delete(ref);
	}

	// ── test helpers ──────────────────────────────────────────────────────────

	async writeFile(path: string, content: string | ArrayBuffer, mtime?: number): Promise<TFile> {
		const absPath = join(this.rootDir, path);
		await fsMkdir(dirname(absPath), { recursive: true });
		if (typeof content === "string") {
			await fsWriteFile(absPath, content, "utf-8");
		} else {
			await fsWriteFile(absPath, Buffer.from(content));
		}
		if (mtime !== undefined) {
			const mtimeSec = mtime / 1000;
			await fsUtimes(absPath, mtimeSec, mtimeSec);
		}
		const s = await fsStat(absPath);
		const file = makeTFile(path, s.mtimeMs, s.size);
		this._index.set(path, file);
		return file;
	}

	async emitRename(file: TFile | TFolder, oldPath: string): Promise<void> {
		await this._emit("rename", file, oldPath);
	}

	async emitDelete(file: TFile | TFolder): Promise<void> {
		await this._emit("delete", file);
	}

	private async _emit(event: string, ...args: unknown[]): Promise<void> {
		for (const ref of this._handlers.get(event) ?? []) {
			await ref.handler(...args);
		}
	}
}

export class NodeFsApp {
	vault: NodeFsVault;
	secretStorage: { getSecret: (_key: string) => string };

	constructor(rootDir: string, password: string) {
		this.vault = new NodeFsVault(rootDir);
		this.secretStorage = { getSecret: () => password };
	}
}
