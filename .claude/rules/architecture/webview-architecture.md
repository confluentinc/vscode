---
paths:
  - src/webview/**/*
---

# Webview Architecture

Webviews render rich UI inside VS Code using HTML/CSS/JS in sandboxed iframes.

## Template Engine

- HTML templates in `src/webview/*.html` with template variables and functions like `this.${var}()`
  bound to the `ViewModel` in corresponding `.ts` files
- Signal-based data binding for Template + ViewModel via custom template engine in
  `src/webview/bindings`

## Communication

- Webviews communicate with the VS Code host via `sendWebviewMessage()` and message handlers in
  `src/webview/comms`
- The comms layer wraps the vscode webview message API to provide type safety
- Messages flow: webview → postMessage → extension host handler → response → webview

## Styling

- General CSS styles in `src/webview/uikit/uikit.css` with view-specific overrides in individual
  HTML templates
- VS Code color theme variables preferred and used when appropriate
- **`@vscode/webview-ui-toolkit` is deprecated** — don't use it in new code; use UIKit styles on
  HTML elements instead

## Functional Tests

Webview functional tests (`src/webview/*.spec.ts`) use Playwright to test UI validation and user
interactions. See the functional tests rule for details.
