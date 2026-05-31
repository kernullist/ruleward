# Project Rules

This project is a TypeScript service. It uses pnpm as the package manager.

## Code Style

- Use tabs for indentation.
- Always use single quotes.
- Maximum line length 100 characters.
- Write clean, maintainable code.

## Architecture

- Never import from `src/legacy/*`; use `@core/*` instead.
- Do not use `OldClient`; prefer `NewClient`.

## Build & Testing

- Run `pnpm build` before committing.
- Use vitest for tests.
- You may add integration tests under `test/`.
