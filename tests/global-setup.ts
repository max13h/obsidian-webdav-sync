import { execSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForServer } from "./helpers/webdav-server.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function setup(): Promise<void> {
	execSync("docker compose up -d", { cwd: projectRoot, stdio: "inherit" });
	await waitForServer();
}

export async function teardown(): Promise<void> {
	execSync("docker compose down", { cwd: projectRoot, stdio: "inherit" });
}
