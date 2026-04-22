# Tests

## Running

```bash
pnpm test           # starts Docker, runs all tests, stops Docker
pnpm test:coverage  # same + coverage report
```

Docker must be running. The WebDAV server starts and stops automatically.

---

## Helpers

### `obsidian-shim.ts`

The `obsidian` package is an Electron API — it doesn't exist in Node.js. This file is a no-op stub that replaces it at test time (via `resolve.alias` in `vitest.config.ts`).

Its exports are never called by tests. They exist so that ESM module linking doesn't crash when source files import `Notice`, `PluginSettingTab`, etc. from `"obsidian"`.

### `obsidian-mock.ts`

In-memory implementations of the Obsidian API used to build test fixtures: `MockApp`, `MockVault`, `makeTFile`. These are what test files actually import.

---

## Docker WebDAV server

The tests use `hacdias/webdav` (Go-based) instead of the more common `bytemark/webdav` (Apache) because Apache blocks `PROPFIND Depth: infinity`, which is required for recursive directory listing.

Each test uses a unique `/test-<uuid>/` path prefix on the server for isolation.
