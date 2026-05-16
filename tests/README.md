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

### `node-fs-app.ts`

Real-filesystem implementations of the Obsidian `App`/`Vault` interface used by all tests except the scheduler. Each test creates a fresh temp directory via `mkdtemp` and constructs a `NodeFsApp` pointing at it.

**`NodeFsApp`** — top-level container with `vault` and `secretStorage`.

**`NodeFsVault`** — maintains an in-memory file index (required because `getFiles()` and `getFileByPath()` are synchronous in Obsidian). The index is updated whenever files are created, modified, or deleted through the vault or its adapter.

**`NodeFsAdapter`** — handles raw I/O (`read`, `write`, `readBinary`, `writeBinary`, `exists`, `stat`, `list`, `mkdir`, `remove`). `writeBinary` and `remove` update the vault index automatically.

Test helpers on `NodeFsVault`:

| Helper | Purpose |
|---|---|
| `writeFile(path, content, mtime?)` | Write a file to disk, optionally pin its mtime, add it to the index |
| `emitRename(file, oldPath)` | Fire a `"rename"` vault event (for testing `registerVaultEvents`) |
| `emitDelete(file)` | Fire a `"delete"` vault event without removing from disk (for guard-condition tests) |

---

## Docker WebDAV server

The tests use `hacdias/webdav` (Go-based) instead of the more common `bytemark/webdav` (Apache) because Apache blocks `PROPFIND Depth: infinity`, which is required for recursive directory listing.

Each test gets its own unique `/test-<uuid>/` path prefix on the server for full isolation.

---

## Test strategy

All engine, state, and client tests are end-to-end: they use a real temp-directory vault and the real Docker WebDAV server. Assertions check actual state — file content on the server, file presence on disk, `state.json` entries — rather than whether mock methods were called.

The scheduler tests keep fake timers because debounce and interval behaviour is inherently timer-dependent and not meaningfully testable with real waits. `patcher.test.ts` stays as a pure unit test since `normalizeBody` has no I/O.
