import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebdavSyncSettings } from "../src/settings.js";
import { DEFAULT_SETTINGS } from "../src/settings.js";
import { Scheduler } from "../src/sync/scheduler.js";

// scheduler.ts uses window.setInterval/clearInterval — map window to globalThis for Node.js.
beforeAll(() => {
	vi.stubGlobal("window", globalThis);
});

type EventRef = { event: string; handler: () => void };

type VaultMock = {
	on: (event: string, handler: () => void) => EventRef;
	offref: ReturnType<typeof vi.fn>;
	trigger: (event: string) => void;
};

function makeVault(): VaultMock {
	const handlers = new Map<string, Set<() => void>>();
	const offref = vi.fn();

	return {
		on(event: string, handler: () => void): EventRef {
			if (!handlers.has(event)) handlers.set(event, new Set());
			handlers.get(event)?.add(handler);
			return { event, handler };
		},
		offref,
		trigger(event: string) {
			handlers.get(event)?.forEach((h) => {
				h();
			});
		},
	};
}

function makeScheduler(
	vault: VaultMock,
	syncFn: () => Promise<void>,
	overrides: Partial<WebdavSyncSettings> = {},
): Scheduler {
	return new Scheduler({ vault } as never, syncFn, { ...DEFAULT_SETTINGS, ...overrides });
}

describe("Scheduler", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe("periodic sync", () => {
		it("fires syncFn once per interval when periodicSync is enabled", async () => {
			const syncFn = vi.fn().mockResolvedValue(undefined);
			const vault = makeVault();
			const scheduler = makeScheduler(vault, syncFn, {
				periodicSync: true,
				periodicSyncInterval: 5,
			});

			scheduler.start();

			await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
			expect(syncFn).toHaveBeenCalledTimes(1);

			await vi.advanceTimersByTimeAsync(5 * 60 * 1_000);
			expect(syncFn).toHaveBeenCalledTimes(2);

			scheduler.stop();
		});

		it("does not fire syncFn when periodicSync is disabled", async () => {
			const syncFn = vi.fn().mockResolvedValue(undefined);
			const vault = makeVault();
			const scheduler = makeScheduler(vault, syncFn, { periodicSync: false });

			scheduler.start();
			await vi.advanceTimersByTimeAsync(60 * 60 * 1_000);
			expect(syncFn).not.toHaveBeenCalled();

			scheduler.stop();
		});

		it("stop() cancels the periodic interval", async () => {
			const syncFn = vi.fn().mockResolvedValue(undefined);
			const vault = makeVault();
			const scheduler = makeScheduler(vault, syncFn, {
				periodicSync: true,
				periodicSyncInterval: 5,
			});

			scheduler.start();
			scheduler.stop();

			await vi.advanceTimersByTimeAsync(60 * 60 * 1_000);
			expect(syncFn).not.toHaveBeenCalled();
		});
	});

	describe("sync on save", () => {
		it("fires syncFn after the 5 s debounce delay on modify", async () => {
			const syncFn = vi.fn().mockResolvedValue(undefined);
			const vault = makeVault();
			const scheduler = makeScheduler(vault, syncFn, { syncOnSave: true });

			scheduler.start();
			vault.trigger("modify");

			await vi.advanceTimersByTimeAsync(4_999);
			expect(syncFn).not.toHaveBeenCalled();

			await vi.advanceTimersByTimeAsync(1);
			expect(syncFn).toHaveBeenCalledTimes(1);

			scheduler.stop();
		});

		it("debounces rapid modify events into a single syncFn call", async () => {
			const syncFn = vi.fn().mockResolvedValue(undefined);
			const vault = makeVault();
			const scheduler = makeScheduler(vault, syncFn, { syncOnSave: true });

			scheduler.start();

			// Three modify events 1 s apart — each resets the debounce timer.
			vault.trigger("modify");
			await vi.advanceTimersByTimeAsync(1_000);
			vault.trigger("modify");
			await vi.advanceTimersByTimeAsync(1_000);
			vault.trigger("modify");
			await vi.advanceTimersByTimeAsync(5_000);

			expect(syncFn).toHaveBeenCalledTimes(1);

			scheduler.stop();
		});

		it("does not fire syncFn when syncOnSave is disabled", async () => {
			const syncFn = vi.fn().mockResolvedValue(undefined);
			const vault = makeVault();
			const scheduler = makeScheduler(vault, syncFn, { syncOnSave: false });

			scheduler.start();
			vault.trigger("modify");
			await vi.advanceTimersByTimeAsync(10_000);
			expect(syncFn).not.toHaveBeenCalled();

			scheduler.stop();
		});

		it("stop() cancels a pending debounce before it fires", async () => {
			const syncFn = vi.fn().mockResolvedValue(undefined);
			const vault = makeVault();
			const scheduler = makeScheduler(vault, syncFn, { syncOnSave: true });

			scheduler.start();
			vault.trigger("modify");
			scheduler.stop();

			await vi.advanceTimersByTimeAsync(10_000);
			expect(syncFn).not.toHaveBeenCalled();
		});

		it("stop() calls vault.offref to unregister the modify listener", () => {
			const vault = makeVault();
			const scheduler = makeScheduler(vault, vi.fn().mockResolvedValue(undefined), {
				syncOnSave: true,
			});

			scheduler.start();
			scheduler.stop();

			expect(vault.offref).toHaveBeenCalledTimes(1);
		});

		it("stop() does not call vault.offref when syncOnSave is disabled", () => {
			const vault = makeVault();
			const scheduler = makeScheduler(vault, vi.fn().mockResolvedValue(undefined), {
				syncOnSave: false,
			});

			scheduler.start();
			scheduler.stop();

			expect(vault.offref).not.toHaveBeenCalled();
		});
	});
});
