---
paths:
  - src/webview/**/*.spec.ts
---

# Functional Tests (Playwright Webview Tests)

## Framework & Location

- Webview tests in `src/webview/*.spec.ts` using Playwright
- Run with `npx gulp functional`
- Test UI validation and user interactions in webview forms

## Purpose

Functional tests verify webview behavior — form validation, user interactions, data binding — in a
real browser environment via Playwright. They complement unit tests by testing the HTML/CSS/JS layer
that unit tests can't reach.
