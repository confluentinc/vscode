import { ElectronApplication, Page } from "@playwright/test";
import { TextDocument } from "../objects/editor/TextDocument";
import { executeVSCodeCommand } from "./commands";

const DEFAULT_UI_SETTINGS = {
  // required for right-click context menu action to delete subject schemas
  // (see https://code.visualstudio.com/updates/v1_101#_custom-menus-with-native-window-title-bar)
  "window.menuStyle": "custom",
};

const DEFAULT_EDITOR_SETTINGS = {
  // this is to avoid VS Code incorrectly setting the language of .proto files as C# so they
  // appear correctly (as "plaintext") in the URI quickpick
  "workbench.editor.languageDetection": false,
  // we also have to disable a lot of auto-formatting so the .insertContent() method properly
  // adds the schema/produce-message content as it exists in the fixture files
  "editor.autoClosingBrackets": "never",
  "editor.autoClosingQuotes": "never",
  "editor.autoIndent": "none",
  "editor.autoSurround": "never",
  "editor.formatOnType": false,
  "editor.insertSpaces": false,
  "json.format.enable": false,
  "json.validate.enable": false,
  // this prevents skipping newlines/commas while content is added to the editor
  "editor.acceptSuggestionOnEnter": "off",
  // this prevents VS Code from converting the `http` to `https` in `$schema` URIs:
  "editor.linkedEditing": false,
};

const DEFAULT_SETTINGS = { ...DEFAULT_EDITOR_SETTINGS, ...DEFAULT_UI_SETTINGS };

/**
 * Configures VS Code settings via the (temporary) User Settings JSON file.
 * If `settings` is not provided, the settings will be reset to {@link DEFAULT_SETTINGS test defaults}.
 *
 * (User settings are not carried over between test runs since we launch with a fresh temporary
 * `--user-data-dir` each time, so we don't need to reset after tests run.)
 */
export async function configureVSCodeSettings(
  page: Page,
  electronApp: ElectronApplication,
  settings?: Record<string, any>,
): Promise<void> {
  await executeVSCodeCommand(page, "Preferences: Open User Settings (JSON)");

  const settingsJson = new TextDocument(page, "settings.json");
  await settingsJson.locator.waitFor({ state: "visible" });

  // XXX: VS Code will have some file-formatting settings enabled by default. As a result of this,
  // we can't really insert text directly without risking it being auto-formatted, auto-indented,
  // pairs auto-closed/etc. Instead, we write to the clipboard and paste directly into the document.
  await electronApp.context().grantPermissions(["clipboard-write"]);
  await page.evaluate(
    (content) => navigator.clipboard.writeText(content),
    JSON.stringify({ ...DEFAULT_SETTINGS, ...(settings ?? {}) }, null, 2),
  );
  await settingsJson.deleteAll();
  await page.keyboard.press("ControlOrMeta+v");
  await settingsJson.save();
  await settingsJson.close();
}
