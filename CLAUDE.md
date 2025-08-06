# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development

- `yarn compile` - Compile TypeScript and run lint checks
- `yarn watch` - Start development with file watching (runs both esbuild and TypeScript compiler)
- `yarn package` - Build for production (includes type checking and linting)
- `yarn check-types` - Run TypeScript type checking without emitting files
- `yarn lint` - Run ESLint on source files

### Testing

- `yarn test` - Run all tests (includes compilation and linting)
- `yarn compile-tests` - Compile test files only
- `yarn watch-tests` - Watch and compile tests

### Webview Development

- `yarn dev` - Start both extension watcher and webview dev server with HMR (recommended for development)
- `yarn serve-webview` - Start webpack dev server for hot reload during webview development
- `yarn build-webview` - Build webview for production
- `yarn watch-webview` - Watch and build webview for development (without HMR)
- `yarn check-types-webview` - Run TypeScript type checking for webview files

### Hot Module Replacement (HMR)

The webview supports hot reloading during development:

1. Run `yarn dev` to start both extension compilation and webview dev server
2. Launch VS Code extension (F5) - the webview will automatically detect development mode
3. Edit any webview React components in `src/webview/` - changes will hot reload instantly
4. The extension uses `context.extensionMode` to detect development vs production

### Extension Packaging

- `yarn build-vsix` - Build production VSIX package
- `yarn build-vsix-dev` - Build development VSIX without dependencies
- `yarn publish` - Publish to VS Code marketplace

## Code Architecture

### Extension Structure

This is a VS Code extension that provides intelligent Git checkout functionality with automatic stashing. The extension follows a modular architecture with clear separation of concerns:

**Core Components:**

- `CommandManager` - Centralized command registration and error handling
- `ConfigurationManager` - Manages VS Code settings and user preferences
- `StatusBarManager` - Handles the status bar display showing current stash mode
- `LoggingService` - Centralized logging with configurable output
- `PrCloneWebViewProvider` - PR Clone webview for GitHub pull request operations

### Command Pattern Implementation

All commands implement the `ICommand` interface and are registered through the `CommandManager`. This provides consistent error handling and makes commands easily testable. Each command is in its own directory under `src/commands/`.

### Configuration System

The extension uses a layered configuration approach:

- VS Code workspace settings via `ConfigurationManager`
- Real-time configuration updates through `onDidChangeConfiguration`
- Global configuration persistence for user preferences

### Git Integration

Git operations are abstracted through `GitExecutor` in `src/common/git/`, which provides:

- Promise-based command execution
- Consistent error handling
- Type-safe Git operation interfaces

### Stash Modes

The extension supports multiple auto-stash strategies:

- **Manual**: User chooses stash behavior each time
- **Auto stash in current branch**: Creates branch-specific stashes
- **Auto stash and pop**: Transfers changes to new branch (destructive)
- **Auto stash and apply**: Transfers changes while preserving original stash

### WebView Integration

The extension provides two collapsible webviews for PR cloning functionality:

1. **PR Clone WebView** (`PrCloneWebViewProvider`): Main form with branch selection, feature branch name, and description fields. Contains Cancel and Create buttons.

2. **PR Commits WebView** (`PrCommitsWebViewProvider`): Separate webview displaying the list of commits to cherry-pick. Users can select/deselect commits independently.

Both webviews communicate through VS Code commands and message passing. The commits webview has a transparent background to integrate seamlessly with VS Code's theme. The webpack configuration generates separate bundles (`main.js` and `commits.js`) for each webview.

### Build System

Uses esbuild for fast bundling with a custom problem matcher plugin for VS Code integration. The build outputs to `dist/extension.js` as a CommonJS bundle with VS Code as an external dependency.

### Extension Manifest

Key package.json contributions:

- Activity bar container: `git-smart-checkout`
- PR Clone view: `git-smart-checkout.prClone` (conditionally shown)
- Commands: checkout, pull-with-stash, switch-mode, clone-pull-request
- Configuration properties for stash modes and logging

## Important Development Notes

### Command Registration

When adding new commands, register them in `extension.ts` using the `CommandManager` pattern and ensure they implement the `ICommand` interface.

### Configuration Changes

New settings must be added to both `package.json` contributions and the `ExtensionConfig` interface in `src/configuration/extensionConfig.ts`.

### Git Operations

All Git commands should go through `GitExecutor` for consistency. The utility functions in `src/commands/utils/` provide common Git operations like branch listing and stash message formatting.

### WebView Updates

The WebView provider creates HTML with VS Code CSS variables for proper theming. Message handling between WebView and extension happens through `onDidReceiveMessage`.

## React Development Guidelines

- When creating React components, create them in a separate folder along with own CSS module file, and add styles related to this component to neighbour CSS module file, avoid using global CSS file unless it's necessary
- When adding or editing a React component, order imports in the following order:
  1. npm dependencies (with 'react' always first, if required by the component)
  2. Project dependencies (separated by an empty line from npm dependencies)
  3. Local dependencies from the same or nearby directories (separated by an empty line from project dependencies)
