import { type App, Modal, Notice } from "obsidian";

export type ConflictChoice = "keep-local" | "keep-remote";

export class ConflictModal extends Modal {
	private _resolved = false;

	constructor(
		app: App,
		private filePath: string,
		private localMtime: number,
		private remoteMtime: number,
		private localContent: ArrayBuffer,
		private remoteContent: ArrayBuffer,
		private resolve: (choice: ConflictChoice) => void,
	) {
		super(app);
	}

	private choose(choice: ConflictChoice): void {
		if (this._resolved) return;
		this._resolved = true;
		this.close();
		this.resolve(choice);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;

		modalEl.addClass("webdav-conflict-modal");

		contentEl.createEl("h2", { text: "Sync conflict" });
		contentEl.createEl("p", {
			text: `"${this.filePath}" was modified on both sides since the last sync.`,
		});

		const localNewer = this.localMtime >= this.remoteMtime;
		const fmt = (ms: number) => new Date(ms).toLocaleString();

		const columns = contentEl.createDiv({ cls: "webdav-conflict-columns" });

		const sides = [
			{
				label: "Local",
				mtime: this.localMtime,
				content: this.localContent,
				newer: localNewer,
				choice: "keep-local" as ConflictChoice,
				copyLabel: "Copy local",
				keepLabel: "Keep local",
				primary: true,
			},
			{
				label: "Remote",
				mtime: this.remoteMtime,
				content: this.remoteContent,
				newer: !localNewer,
				choice: "keep-remote" as ConflictChoice,
				copyLabel: "Copy remote",
				keepLabel: "Keep remote",
				primary: false,
			},
		];

		for (const side of sides) {
			const col = columns.createDiv({ cls: "webdav-conflict-col" });

			const header = col.createDiv({ cls: "webdav-conflict-col-header" });
			header.createEl("strong", { text: side.label });
			header.createEl("span", { text: `${fmt(side.mtime)}${side.newer ? " (newer)" : ""}` });

			const pane = col.createDiv({ cls: "webdav-conflict-pane" });
			const decoded = new TextDecoder().decode(side.content);
			if (decoded.includes("\x00")) {
				pane.createEl("em", { text: "Binary file — content cannot be displayed." });
			} else {
				pane.createEl("pre").textContent = decoded;
			}

			const actions = col.createDiv({ cls: "webdav-conflict-actions" });

			const copyBtn = actions.createEl("button", { text: side.copyLabel });
			copyBtn.addEventListener("click", () => void this.copyToClipboard(side.content, copyBtn));

			actions
				.createEl("button", {
					text: side.keepLabel,
					cls: side.primary ? "mod-cta" : "",
				})
				.addEventListener("click", () => this.choose(side.choice));
		}
	}

	onClose(): void {
		if (!this._resolved) {
			this._resolved = true;
			this.resolve("keep-local");
		}
		this.contentEl.empty();
	}

	private async copyToClipboard(content: ArrayBuffer, btn: HTMLButtonElement): Promise<void> {
		const decoded = new TextDecoder().decode(content);
		if (decoded.includes("\x00")) {
			new Notice("Binary file — cannot copy as text.");
			return;
		}
		try {
			await navigator.clipboard.writeText(decoded);
			const original = btn.textContent ?? "Copy";
			btn.textContent = "Copied!";
			setTimeout(() => {
				btn.textContent = original;
			}, 2000);
		} catch {
			new Notice("Failed to copy to clipboard.");
		}
	}
}
