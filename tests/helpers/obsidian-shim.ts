// Runtime stub for the "obsidian" module, used via vitest resolve.alias.
// Every named export used by source files at module-evaluation time must be present,
// otherwise ESM linking throws a SyntaxError before tests even run.

export class Modal {
	contentEl = {} as HTMLElement;
	open() {}
	close() {}
}

export class TFile {
	path = "";
	extension = "";
	parent: { path: string } | null = null;
	stat = { mtime: 0, ctime: 0, size: 0 };
}

export class TFolder {
	path = "";
	children: unknown[] = [];
}

export class Notice {}

export class PluginSettingTab {
	display(): void {}
}

export class Setting {
	setName(_n: string) {
		return this;
	}
	setDesc(_d: string) {
		return this;
	}
	setHeading() {
		return this;
	}
	addText(_cb: unknown) {
		return this;
	}
	addTextArea(_cb: unknown) {
		return this;
	}
	addDropdown(_cb: unknown) {
		return this;
	}
	addToggle(_cb: unknown) {
		return this;
	}
	addSlider(_cb: unknown) {
		return this;
	}
	addButton(_cb: unknown) {
		return this;
	}
	addComponent(_cb: unknown) {
		return this;
	}
}

export class SecretComponent {
	setValue(_v: string) {
		return this;
	}
	onChange(_cb: unknown) {
		return this;
	}
}

// Never called in tests — exists so patcher.ts links without crashing.
export async function requestUrl(
	_params: unknown,
): Promise<{ status: number; arrayBuffer: ArrayBuffer; headers: Record<string, string> }> {
	return { status: 200, arrayBuffer: new ArrayBuffer(0), headers: {} };
}
