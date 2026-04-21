import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Scheduler } from "../../src/sync/scheduler";
import { makeSettings } from "../mocks";

vi.mock("obsidian", () => ({}));

// window.setInterval / window.clearInterval do not exist in Node — stub them.
const mockSetInterval = vi.fn().mockReturnValue(99);
const mockClearInterval = vi.fn();
vi.stubGlobal("window", { setInterval: mockSetInterval, clearInterval: mockClearInterval });

function makeVault() {
	return {
		on: vi.fn().mockReturnValue({ id: "mock-ref" }),
		offref: vi.fn(),
	};
}

function makeApp() {
	return { vault: makeVault() } as never;
}

describe("Scheduler.start()", () => {
	beforeEach(() => vi.clearAllMocks());

	it("sets an interval with the correct delay when periodicSync is enabled", () => {
		const syncFn = vi.fn();
		const app = makeApp();
		const scheduler = new Scheduler(
			app,
			syncFn,
			makeSettings({ periodicSync: true, periodicSyncInterval: 5 }),
		);

		scheduler.start();

		expect(mockSetInterval).toHaveBeenCalledOnce();
		expect(mockSetInterval).toHaveBeenCalledWith(expect.any(Function), 5 * 60 * 1_000);
	});

	it("does not set an interval when periodicSync is disabled", () => {
		const scheduler = new Scheduler(makeApp(), vi.fn(), makeSettings({ periodicSync: false }));

		scheduler.start();

		expect(mockSetInterval).not.toHaveBeenCalled();
	});

	it("registers a vault modify listener when syncOnSave is enabled", () => {
		const app = makeApp();
		const scheduler = new Scheduler(app, vi.fn(), makeSettings({ syncOnSave: true }));

		scheduler.start();

		expect(app.vault.on).toHaveBeenCalledWith("modify", expect.any(Function));
	});

	it("does not register a vault listener when syncOnSave is disabled", () => {
		const app = makeApp();
		const scheduler = new Scheduler(app, vi.fn(), makeSettings({ syncOnSave: false }));

		scheduler.start();

		expect(app.vault.on).not.toHaveBeenCalled();
	});

	it("does nothing when both periodicSync and syncOnSave are disabled", () => {
		const app = makeApp();
		const scheduler = new Scheduler(
			app,
			vi.fn(),
			makeSettings({ periodicSync: false, syncOnSave: false }),
		);

		scheduler.start();

		expect(mockSetInterval).not.toHaveBeenCalled();
		expect(app.vault.on).not.toHaveBeenCalled();
	});
});

describe("Scheduler.stop()", () => {
	beforeEach(() => vi.clearAllMocks());

	it("clears the interval that was set on start", () => {
		const scheduler = new Scheduler(makeApp(), vi.fn(), makeSettings({ periodicSync: true }));
		scheduler.start();

		scheduler.stop();

		expect(mockClearInterval).toHaveBeenCalledWith(99);
	});

	it("unregisters the vault listener via offref", () => {
		const app = makeApp();
		const ref = { id: "mock-ref" };
		app.vault.on.mockReturnValue(ref);
		const scheduler = new Scheduler(app, vi.fn(), makeSettings({ syncOnSave: true }));
		scheduler.start();

		scheduler.stop();

		expect(app.vault.offref).toHaveBeenCalledWith(ref);
	});

	it("is safe to call when nothing was started", () => {
		const scheduler = new Scheduler(
			makeApp(),
			vi.fn(),
			makeSettings({ periodicSync: false, syncOnSave: false }),
		);

		expect(() => scheduler.stop()).not.toThrow();
		expect(mockClearInterval).not.toHaveBeenCalled();
	});

	it("is idempotent — safe to call twice", () => {
		const scheduler = new Scheduler(
			makeApp(),
			vi.fn(),
			makeSettings({ periodicSync: true, syncOnSave: true }),
		);
		scheduler.start();

		scheduler.stop();
		scheduler.stop();

		expect(mockClearInterval).toHaveBeenCalledOnce();
	});
});

describe("syncOnSave debounce", () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it("calls syncFn once after 5 s even when modify fires multiple times rapidly", async () => {
		const syncFn = vi.fn().mockResolvedValue(undefined);
		const app = makeApp();
		const scheduler = new Scheduler(app, syncFn, makeSettings({ syncOnSave: true }));
		scheduler.start();

		const modifyCallback = app.vault.on.mock.calls[0]?.[1] as () => void;
		modifyCallback();
		modifyCallback();
		modifyCallback();

		expect(syncFn).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(5_000);

		expect(syncFn).toHaveBeenCalledOnce();
	});

	it("resets the 5 s window on each modify event", async () => {
		const syncFn = vi.fn().mockResolvedValue(undefined);
		const app = makeApp();
		const scheduler = new Scheduler(app, syncFn, makeSettings({ syncOnSave: true }));
		scheduler.start();

		const modifyCallback = app.vault.on.mock.calls[0]?.[1] as () => void;
		modifyCallback();
		await vi.advanceTimersByTimeAsync(4_000); // 4 s in — not fired yet
		modifyCallback(); // reset the timer
		await vi.advanceTimersByTimeAsync(4_000); // another 4 s — still not 5 s since last event

		expect(syncFn).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1_000); // now 5 s since the last event

		expect(syncFn).toHaveBeenCalledOnce();
	});

	it("does not call syncFn after stop() cancels the debounce timer", async () => {
		const syncFn = vi.fn().mockResolvedValue(undefined);
		const app = makeApp();
		const scheduler = new Scheduler(app, syncFn, makeSettings({ syncOnSave: true }));
		scheduler.start();

		const modifyCallback = app.vault.on.mock.calls[0]?.[1] as () => void;
		modifyCallback();
		scheduler.stop();

		await vi.advanceTimersByTimeAsync(5_000);

		expect(syncFn).not.toHaveBeenCalled();
	});
});
