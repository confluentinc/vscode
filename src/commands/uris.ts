import type { Disposable, InputBoxValidationMessage } from "vscode";
import { env, InputBoxValidationSeverity, Uri, window } from "vscode";
import { registerCommandWithLogging } from ".";
import { EXTENSION_ID } from "../constants";
import { UriEventHandler } from "../uriHandler";

export const EXT_URI_PREFIX = `${env.uriScheme}://${EXTENSION_ID}/`;

/**
 * Explicitly handle a URI by prompting the user for input, parsing it, and passing it to the
 * {@link UriEventHandler}.
 * This is mainly used for environments where the default URI handling and/or protocol registration
 * does not work (e.g. in CI environments).
 */
export async function handleUriCommand(): Promise<void> {
  const inputString = await window.showInputBox({
    prompt: "Enter a URI",
    placeHolder: `${EXT_URI_PREFIX}path`,
    validateInput: uriValidator,
  });
  if (!inputString) {
    return;
  }

  const inputUri = Uri.parse(inputString);
  const handler = UriEventHandler.getInstance();
  await handler.handleUri(inputUri);
}

export function registerUriCommands(): Disposable[] {
  return [registerCommandWithLogging("confluent.handleUri", handleUriCommand)];
}

export function uriValidator(value: string): InputBoxValidationMessage | undefined {
  if (!value.startsWith(EXT_URI_PREFIX)) {
    return {
      message: `URI must start with ${EXT_URI_PREFIX}`,
      severity: InputBoxValidationSeverity.Error,
    };
  }
  return;
}
