export const WEBDAV_URL = "http://localhost:8080";
export const WEBDAV_USERNAME = "test";
export const WEBDAV_PASSWORD = "test";

export async function waitForServer(maxMs = 15_000): Promise<void> {
	const deadline = Date.now() + maxMs;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(WEBDAV_URL, { method: "OPTIONS" });
			if (res.status < 500) return;
		} catch {
			// not ready yet
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error("WebDAV server did not become ready in time");
}
