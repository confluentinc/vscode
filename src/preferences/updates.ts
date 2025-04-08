import { commands, workspace, WorkspaceConfiguration } from "vscode";
import {
  Preferences,
  PreferencesResourceApi,
  PreferencesSpec,
  ResponseError,
} from "../clients/sidecar";
import {
  DEFAULT_ERROR_NOTIFICATION_BUTTONS,
  logError,
  showErrorNotificationWithButtons,
} from "../errors";
import { Logger } from "../logging";
import { getSidecar } from "../sidecar";
import {
  DEFAULT_SSL_PEM_PATHS,
  DEFAULT_TRUST_ALL_CERTIFICATES,
  SSL_PEM_PATHS,
  SSL_VERIFY_SERVER_CERT_DISABLED,
} from "./constants";

const logger = new Logger("preferences.updates");

/**
 * Load the current preferences API related values from the workspace configuration / user settings.
 * @returns {PreferencesSpec} The current preferences.
 */
export function loadPreferencesFromWorkspaceConfig(): PreferencesSpec {
  const configs: WorkspaceConfiguration = workspace.getConfiguration();

  const pemPaths: string[] = configs.get(SSL_PEM_PATHS, DEFAULT_SSL_PEM_PATHS);
  const trustAllCerts: boolean = configs.get(
    SSL_VERIFY_SERVER_CERT_DISABLED,
    DEFAULT_TRUST_ALL_CERTIFICATES,
  );

  return {
    tls_pem_paths: pemPaths,
    trust_all_certificates: trustAllCerts,
  };
}

// TODO: move this if needed elsewhere, or remove entirely if the spec updates away from `Error`
export type PreferencesFailureError = {
  code?: string;
  status?: string;
  title?: string;
  id?: string;
  detail?: string;
  source?: string; // spec says it's a JsonNode, but it's a string in the error response
};

/** Update the sidecar's preferences API with the current user settings. */
export async function updatePreferences() {
  const preferencesSpec: PreferencesSpec = loadPreferencesFromWorkspaceConfig();
  const preferences: Preferences = {
    api_version: "gateway/v1",
    kind: "Preferences",
    spec: preferencesSpec,
  };

  const client: PreferencesResourceApi = (await getSidecar()).getPreferencesApi();
  try {
    const resp = await client.gatewayV1PreferencesPut({
      Preferences: preferences,
    });
    logger.debug("Successfully updated preferences: ", { resp });
  } catch (error) {
    logError(error, "updating preferences", {}, true);
    if (error instanceof Error) {
      let errorMsg = error.message;
      let buttons: Record<string, () => void> | undefined;
      if (error instanceof ResponseError) {
        // most likely a response error about the cert path not being valid
        try {
          const body = await error.response.clone().json();
          if (Array.isArray(body.errors) && body.errors.length) {
            const errorDetails: string[] = [];
            body.errors.forEach((err: PreferencesFailureError) => {
              if (typeof err.detail === "string") {
                errorDetails.push(err.detail);
              }
              if (
                typeof err.source === "string" &&
                (err.source as string).includes("tls_pem_paths")
              ) {
                buttons = {
                  "Update Settings": () =>
                    commands.executeCommand(
                      "workbench.action.openSettings",
                      `@id:${SSL_PEM_PATHS}`,
                    ),
                  ...DEFAULT_ERROR_NOTIFICATION_BUTTONS,
                };
              }
            });
            errorMsg = errorDetails.join("; ");
          }
        } catch {
          errorMsg = await error.response.clone().text();
        }
      }
      if (errorMsg) {
        showErrorNotificationWithButtons(`Failed to sync settings: ${errorMsg}`, buttons);
      }
    }
  }
}
