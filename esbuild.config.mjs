import esbuild from "esbuild";
import process from "process";
import { builtinModules } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';

const prod = (process.argv[2] === "production");

const context = await esbuild.context({
	entryPoints: [
		{ in: "src/main.ts", out: "main" },
		{ in: "styles.css", out: "styles" },
	],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtinModules],
	format: "cjs",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outdir: "dist",
	minify: prod,
});

// Add manifest.json to output
mkdirSync("dist", { recursive: true });
copyFileSync("manifest.json", "dist/manifest.json");

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
