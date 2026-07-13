# React / Webview Development Guidelines

- Create each component in its own folder (`src/webview/components/<Name>/`) with a sibling CSS module file. Don't add component styles to `global.css`.
- Import order in React components:
  1. npm packages (`react` always first)
  2. Project-level imports (blank line separator)
  3. Local/sibling imports (blank line separator)
