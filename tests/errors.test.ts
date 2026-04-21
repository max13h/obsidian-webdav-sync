import { Notice } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { assertDefined } from "../src/errors";

vi.mock("obsidian", () => ({ Notice: vi.fn() }));

const mockNotice = vi.mocked(Notice);

describe("assertDefined", () => {
	it("does not throw when value is defined", () => {
		expect(() => assertDefined("hello", "msg")).not.toThrow();
		expect(() => assertDefined(0, "msg")).not.toThrow();
		expect(() => assertDefined(false, "msg")).not.toThrow();
	});

	it("throws with the given message when value is null", () => {
		expect(() => assertDefined(null, "missing thing")).toThrow("missing thing");
	});

	it("throws with the given message when value is undefined", () => {
		expect(() => assertDefined(undefined, "missing thing")).toThrow("missing thing");
	});

	it("shows a Notice before throwing", () => {
		expect(() => assertDefined(null, "oops")).toThrow();
		expect(mockNotice).toHaveBeenCalledWith("oops");
	});
});
