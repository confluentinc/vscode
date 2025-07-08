import { ElectronApplication, Page } from "@playwright/test";
import { TextDocument } from "../objects/editor/TextDocument";
import { executeVSCodeCommand } from "./commands";

/** Configures VS Code settings via the (temporary) User Settings JSON file. */
export async function configureVSCodeSettings(
  page: Page,
  electronApp: ElectronApplication,
  settings: Record<string, any>,
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
    JSON.stringify(settings, null, 2),
  );
  await settingsJson.deleteAll();
  await page.keyboard.press("ControlOrMeta+v");
  await settingsJson.save();
  await settingsJson.close();
}
