import { setIcon } from "obsidian";
import type WebdavSync from "../main";
import type { StateStore } from "../sync/state";

export class StatusBar {
	private readonly el: HTMLElement;

	constructor(plugin: WebdavSync, store: StateStore) {
		this.el = plugin.addStatusBarItem();
		this.el.addClass("webdav-sync-status");
		this.setIdle(store.lastSync || null);
	}

	public setIdle(lastSync: number | null): void {
		this.el.empty();
		this.el.removeClasses(["webdav-sync-error", "spinning-icon"]);
		setIcon(this.el, "refresh-cw");
		const label = lastSync ? `Synced ${this.formatTime(lastSync)}` : "Never synced";
		this.el.createSpan({ text: ` ${label}` });
	}

	public setSyncing(): void {
		this.el.empty();
		this.el.removeClass("webdav-sync-error");
		setIcon(this.el, "loader-2");
		this.el.createSpan({ text: " Syncing…" });
	}

	public setError(message: string): void {
		this.el.empty();
		this.el.addClass("webdav-sync-error");
		setIcon(this.el, "alert-circle");
		this.el.createSpan({ text: ` ${message}` });
	}

	public destroy(): void {
		this.el.remove();
	}

	private formatTime(ms: number): string {
		return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	}
}
