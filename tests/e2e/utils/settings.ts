import { ElectronApplication, Page } from "@playwright/test";
import { TextDocument } from "../objects/editor/TextDocument";
import { executeVSCodeCommand } from "./commands";

// `window.menuStyle` must be set to "custom" for right-click context menu actions (e.g. deleting
// schemas, generating projects from sidebar resources, etc), but Windows already sets this to
// inherit the "custom" setting value from `window.titleBarStyle`, so we shouldn't set it or it will
// require a restart to take effect. (Also, based on our system dialog stubbing, if we updated this
// on Windows, we would auto-reload the window and lose our Electron/page context, which will cause
// all sorts of odd test failures.)
//
// see:
//   - https://code.visualstudio.com/updates/v1_101#_custom-menus-with-native-window-title-bar
//   - https://github.com/confluentinc/vscode/issues/2609#issuecomment-3300206479
const DEFAULT_UI_SETTINGS = process.platform === "win32" ? {} : { "window.menuStyle": "custom" };

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
    async (content) => await navigator.clipboard.writeText(content),
    JSON.stringify({ ...DEFAULT_SETTINGS, ...(settings ?? {}) }, null, 2),
  );
  await settingsJson.deleteAll();
  await page.keyboard.press("ControlOrMeta+v");
  await settingsJson.save();
  await settingsJson.close();
}
