import { commands } from "vscode";
import {
  Preferences,
  PreferencesResourceApi,
  PreferencesSpec,
  ResponseError,
  SidecarError,
} from "../clients/sidecar";
import { logError } from "../errors";
import { Logger } from "../logging";
import {
  DEFAULT_ERROR_NOTIFICATION_BUTTONS,
  showErrorNotificationWithButtons,
} from "../notifications";
import { getSidecar } from "../sidecar";
import { KRB5_CONFIG_PATH, SSL_PEM_PATHS, SSL_VERIFY_SERVER_CERT_DISABLED } from "./constants";

const logger = new Logger("preferences.sidecarSync");

/**
 * Load the current preferences API related values from the workspace configuration / user settings.
 * @returns {PreferencesSpec} The current preferences.
 */
export function loadPreferencesFromWorkspaceConfig(): PreferencesSpec {
  const pemPaths: string[] = SSL_PEM_PATHS.value;
  const trustAllCerts: boolean = SSL_VERIFY_SERVER_CERT_DISABLED.value;
  const krb5ConfigPath: string = KRB5_CONFIG_PATH.value;
  return {
    tls_pem_paths: pemPaths,
    trust_all_certificates: trustAllCerts,
    kerberos_config_file_path: krb5ConfigPath,
  };
}

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
    logger.debug("Successfully synced preferences with sidecar: ", { resp });
  } catch (error) {
    let sentryContext = {};
    if (error instanceof Error) {
      let errorMsg = error.message;
      let buttons: Record<string, () => void> | undefined;
      if (error instanceof ResponseError) {
        // most likely a response error about the cert path not being valid
        try {
          const body = await error.response.clone().json();
          if (Array.isArray(body.errors) && body.errors.length) {
            const errorDetails: string[] = [];
            body.errors.forEach((err: SidecarError) => {
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
                      `@id:${SSL_PEM_PATHS.id}`,
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
      if (!(error instanceof ResponseError) || error.response.status !== 400) {
        // no need to send error 400 responses to Sentry; the notification should tell the user what
        // needs to be changed
        sentryContext = { extra: { functionName: "updatePreferences" } };
      }
    }
    logError(error, "syncing settings to sidecar preferences API", sentryContext);
  }
}
