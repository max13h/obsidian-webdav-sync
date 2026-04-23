import { type RequestUrlParam, requestUrl } from "obsidian";
import { getPatcher } from "webdav";

// Routes all webdav library requests through Obsidian's requestUrl,
// bypassing Electron's restrictive renderer-process fetch.
export const patchWebdavFetch = () => {
	getPatcher().patch("fetch", async (...args: unknown[]): Promise<Response> => {
		const [url, init] = args as [string, RequestInit | undefined];
		const { "content-length": _, ...headers } = Object.fromEntries(new Headers(init?.headers));
		const body = normalizeBody(init?.body);

		const res = await requestUrl({
			url,
			method: init?.method ?? "GET",
			headers,
			body,
			throw: false,
		});

		const nullBodyStatuses = new Set([101, 204, 205, 304]);
		const responseBody = nullBodyStatuses.has(res.status) ? null : res.arrayBuffer;
		return new Response(responseBody, { status: res.status, headers: new Headers(res.headers) });
	});
};

export function normalizeBody(body: RequestInit["body"]): RequestUrlParam["body"] {
	if (body == null) return undefined;
	if (typeof body === "string" || body instanceof ArrayBuffer) return body;
	if (ArrayBuffer.isView(body))
		return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
	return undefined;
}
