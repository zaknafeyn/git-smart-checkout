# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development

- `yarn compile` - Compile TypeScript and run lint checks
- `yarn watch` - Start development with file watching (runs esbuild + TypeScript compiler)
- `yarn package` - Build for production (includes type checking and linting)
- `yarn check-types` - TypeScript type checking (extension)
- `yarn check-types-webview` - TypeScript type checking (webview)
- `yarn lint` - Run ESLint on source files

### Testing

- `yarn test` / `yarn test:unit` - Run unit tests (compiles first)
- `yarn test:e2e` - Run e2e tests in manual (visual) mode
- `yarn test:e2e:ci` - Run e2e tests headless via xvfb
- `yarn test:e2e:heavy` - Heavy e2e suite (large real repo fixtures, opt-in)
- `yarn compile-tests` - Compile test files only
- `yarn watch-tests` - Watch and compile tests

Tests use `@vscode/test-cli` with Mocha (bdd). Suite labels (`unit`, `e2e-manual`, `e2e-ci`, `e2e-heavy`) are defined in `.vscode-test.mjs`. To filter unit tests:
```
MOCHA_GREP="branch template" yarn test:unit
```

Test files: `src/test/unit/`, `src/test/e2e/`, `src/test/heavy/`.

### Webview Development

- `yarn dev` - Start extension watcher + webview dev server with HMR (recommended)
- `yarn serve-webview` - Webview webpack dev server only
- `yarn build-webview` - Build webview for production
- `yarn watch-webview` - Watch/build webview (no HMR)

HMR: run `yarn dev`, then launch extension (F5). The extension detects `context.extensionMode` to enable HMR automatically.

### Extension Packaging

- `yarn build-vsix` - Production VSIX
- `yarn build-vsix-dev` - Dev VSIX without bundled dependencies
- `yarn publish` - Publish to VS Code marketplace

## Architecture

See @.claude/rules/architecture.md for full architecture details.

Key points:
- All commands extend `BaseCommand` / `ICommand`; register in `extension.ts` via `CommandManager`
- Business logic lives in `src/services/` (not in command classes)
- `VscodeGitProvider` for git **reads**; `GitExecutor` for git **mutations**
- New config settings require changes in both `package.json` `contributes.configuration` and `ExtensionConfig` in `src/configuration/extensionConfig.ts`
- PR Clone has two strategies: in-place (`PrCloneInPlaceService`) and temp-worktree (`PrCloneTempWorktreeService`), selected by `useInPlaceCherryPick` config

## React Guidelines

See @.claude/rules/react-guidelines.md.
