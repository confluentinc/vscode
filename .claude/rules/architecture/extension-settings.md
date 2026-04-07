---
paths:
  - src/extensionSettings/**/*
---

# Extension Settings Pattern

## Defining Settings

- Define settings in `src/extensionSettings/constants.ts` as `ExtensionSetting<T>` instances
- Must match `package.json`'s `contributes.configuration` sections exactly
- Access current value via `.value` property — automatically syncs with VS Code configuration
- Changes handled by `src/extensionSettings/listener.ts`

## Adding a New Setting

1. Add the configuration entry to `package.json` under `contributes.configuration`
2. Create an `ExtensionSetting<T>` instance in `src/extensionSettings/constants.ts`
3. If the setting needs side effects on change, add a handler in `listener.ts`
