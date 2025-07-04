import { expect, Locator, Page } from "@playwright/test";
import { Quickpick } from "../objects/quickInputs/Quickpick";

/**
 * Executes a VS Code command using the command palette.
 * @param commandFilter - The name or `id` of the command to execute.
 */
export async function executeVSCodeCommand(page: Page, commandFilter: string): Promise<void> {
  await page.keyboard.press("Shift+ControlOrMeta+P");

  const commandPalette = new Quickpick(page);
  await expect(commandPalette.locator).toBeVisible();

  // ">" prefix needed to filter commands, otherwise it will try to match files
  await commandPalette.textInput.fill(`>${commandFilter}`);
  const commands: Locator = commandPalette.items;
  await expect(commands).not.toHaveCount(0);
  await commands.first().click();
}
