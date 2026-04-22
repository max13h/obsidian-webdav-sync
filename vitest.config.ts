import { resolve as resolvePath } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			obsidian: resolvePath(__dirname, "tests/helpers/obsidian-shim.ts"),
		},
	},
	test: {
		environment: "node",
		globalSetup: ["tests/global-setup.ts"],
		testTimeout: 15_000,
		coverage: {
			provider: "v8",
			include: ["src/**/*.ts"],
			exclude: ["src/main.ts", "src/ui/**", "src/settings.ts"],
		},
	},
});
