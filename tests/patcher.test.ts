import { describe, expect, it } from "vitest";
import { normalizeBody } from "../src/webdav/patcher.js";

describe("normalizeBody", () => {
	it("returns undefined for null", () => {
		expect(normalizeBody(null)).toBeUndefined();
	});

	it("returns undefined for undefined", () => {
		expect(normalizeBody(undefined)).toBeUndefined();
	});

	it("returns the string unchanged", () => {
		expect(normalizeBody("hello world")).toBe("hello world");
	});

	it("returns an empty string unchanged", () => {
		expect(normalizeBody("")).toBe("");
	});

	it("returns an ArrayBuffer as-is", () => {
		const buf = new ArrayBuffer(4);
		expect(normalizeBody(buf)).toBe(buf);
	});

	it("extracts the full ArrayBuffer from a Uint8Array view", () => {
		const arr = new Uint8Array([1, 2, 3, 4]);
		const result = normalizeBody(arr) as ArrayBuffer;
		expect(result).toBeInstanceOf(ArrayBuffer);
		expect(result.byteLength).toBe(4);
		expect(Array.from(new Uint8Array(result))).toEqual([1, 2, 3, 4]);
	});

	it("extracts the correct slice from a byte-offset Uint8Array subarray", () => {
		// The backing buffer is 10 bytes; the view covers bytes 2–4 (byteOffset=2, byteLength=3).
		// normalizeBody must slice the backing buffer to that range, not copy the full buffer.
		const full = new Uint8Array([0, 0, 10, 20, 30, 0, 0, 0, 0, 0]);
		const view = full.subarray(2, 5); // byteOffset=2, byteLength=3
		const result = normalizeBody(view) as ArrayBuffer;
		expect(result.byteLength).toBe(3);
		expect(Array.from(new Uint8Array(result))).toEqual([10, 20, 30]);
	});

	it("returns undefined for a Blob", () => {
		expect(normalizeBody(new Blob(["data"]))).toBeUndefined();
	});

	it("returns undefined for a FormData", () => {
		expect(normalizeBody(new FormData())).toBeUndefined();
	});

	it("returns undefined for URLSearchParams", () => {
		expect(normalizeBody(new URLSearchParams("a=1"))).toBeUndefined();
	});
});
