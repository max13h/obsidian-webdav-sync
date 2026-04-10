import { setIcon } from "obsidian";
import type WebdavSync from "../main";

export class StatusBar {
	private el: HTMLElement;

	constructor(plugin: WebdavSync) {
		this.el = plugin.addStatusBarItem();
		this.el.addClass("webdav-sync-status");
		this.setIdle(null);
	}

	setIdle(lastSync: number | null): void {
		this.el.empty();
		this.el.removeClass("webdav-sync-error");
		setIcon(this.el, "refresh-cw");
		const label = lastSync ? `Synced ${this.formatTime(lastSync)}` : "Never synced";
		this.el.createSpan({ text: ` ${label}` });
	}

	setSyncing(): void {
		this.el.empty();
		this.el.removeClass("webdav-sync-error");
		setIcon(this.el, "loader-2");
		this.el.createSpan({ text: " Syncing…" });
	}

	setError(message: string): void {
		this.el.empty();
		this.el.addClass("webdav-sync-error");
		setIcon(this.el, "alert-circle");
		this.el.createSpan({ text: ` ${message}` });
	}

	private formatTime(ms: number): string {
		return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}
}
