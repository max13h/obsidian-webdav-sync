import { type RequestUrlParam, requestUrl } from "obsidian";
import { getPatcher } from "webdav";

// Patch the webdav library's fetch with Obsidian's requestUrl, which bypasses
// CORS by routing through Electron's net module instead of the browser's fetch.
export const patchWebdavFetch = () => {
	getPatcher().patch("fetch", async (...args: unknown[]): Promise<Response> => {
		const [url, init] = args as [string, RequestInit | undefined];
		const headers: Record<string, string> = {};
		if (init?.headers) {
			if (init.headers instanceof Headers) {
				init.headers.forEach((value, key) => {
					headers[key] = value;
				});
			} else if (Array.isArray(init.headers)) {
				for (const [key, value] of init.headers as [string, string][]) {
					headers[key] = value;
				}
			} else {
				Object.assign(headers, init.headers);
			}
		}

		let body: string | ArrayBuffer | undefined;
		if (init != null && init.body != null) {
			if (typeof init.body === "string" || init.body instanceof ArrayBuffer) {
				body = init.body;
			} else if (init.body instanceof Uint8Array) {
				// Buffer / Uint8Array — slice out the exact bytes to get a plain ArrayBuffer
				body = init.body.buffer.slice(
					init.body.byteOffset,
					init.body.byteOffset + init.body.byteLength,
				);
			} else if (typeof (init.body as { arrayBuffer?: unknown }).arrayBuffer === "function") {
				// Blob or similar — materialise synchronously via arrayBuffer()
				body = await (init.body as Blob).arrayBuffer();
			}
			// ReadableStream and other exotic types are not supported by requestUrl;
			// leaving body undefined causes the request to proceed without a body,
			// which is wrong for uploads but at least won't crash Electron.
		}

		const params: RequestUrlParam = {
			url,
			method: init?.method ?? "GET",
			headers,
			body,
			throw: false,
		};

		const res = await requestUrl(params);

		return new Response(res.arrayBuffer, {
			status: res.status,
			headers: new Headers(res.headers),
		});
	});
};
