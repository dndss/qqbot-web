# AGENTS Guide for qq-official-bot

This file helps AI coding agents contribute safely and quickly in this repository.

## Primary Workflow

1. Edit source files only in [src](src).
2. Do not hand-edit build outputs in [lib](lib).
3. Validate changes with:
   - pnpm run compile
   - pnpm run build
4. If API behavior changed, update matching docs under [docs/src](docs/src).

## Build and Validation Commands

- Fast compile check: pnpm run compile
- Full package build (JS + d.ts): pnpm run build
- Clean outputs: pnpm run clean
- Docs local dev: pnpm run docs:dev
- Docs build: pnpm run docs:build

Notes:
- The repository has a pnpm lockfile, prefer pnpm commands.
- The test script is a placeholder and currently not a usable validation path.

## Architecture Map

- Public package entry: [src/index.ts](src/index.ts)
- Core runtime orchestration: [src/client.ts](src/client.ts)
- Session/connection/auth core: [src/core](src/core)
- Receiver modes and factories: [src/receivers](src/receivers)
- Message parsing/building: [src/message](src/message)
- API domain services: [src/services](src/services)
- Entity wrappers: [src/entries](src/entries)

## Project Conventions

- Keep internal imports consistent with path aliases configured in TypeScript. Example style is visible across [src](src).
- Generated output path is [lib](lib), produced by TypeScript + alias rewrite tooling from scripts in [package.json](package.json).
- When changing exports, verify index barrels remain consistent, especially [src/index.ts](src/index.ts) and module-level index files.
- Keep source-of-truth in TypeScript under [src](src); avoid applying functional fixes directly in compiled JS.

## Known Pitfalls

- Generic config casts around receiver creation can trigger TS2352 in [src/core/session.ts](src/core/session.ts). If two types have weak overlap, cast through unknown first.
- Environment-specific npmrc warnings may appear during build on some machines; treat them separately from TypeScript correctness.

## Documentation Links

- Project overview and usage: [README.md](README.md)
- Getting started: [docs/src/guide/start.md](docs/src/guide/start.md)
- Configuration reference: [docs/src/config.md](docs/src/config.md)
- API references: [docs/src/api](docs/src/api)
- Message segment references: [docs/src/segment/index.md](docs/src/segment/index.md)

## Change Checklist for Agents

1. Changed only [src](src) (unless updating docs or metadata intentionally).
2. Ran pnpm run compile at minimum.
3. Ran pnpm run build for release-level confidence.
4. Updated docs in [docs/src](docs/src) if behavior or interfaces changed.
5. Confirmed no accidental edits to generated files in [lib](lib).
