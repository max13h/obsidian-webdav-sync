import { setIcon } from "obsidian";

export class SyncIndicator {
	private el: HTMLElement;

	constructor() {
		this.el = createEl("div", { cls: "webdav-sync-indicator spinning-icon" });
		this.attach();
	}

	private attach(): void {
		const viewActions = document.getElementsByClassName("view-actions")[0];
		viewActions?.prepend(this.el);
	}

	setSyncing(): void {
		this.attach();
		this.el.empty();
		setIcon(this.el, "loader-2");
		this.el.show();
	}

	setIdle(): void {
		this.el.hide();
	}

	destroy(): void {
		this.el.remove();
	}
}
