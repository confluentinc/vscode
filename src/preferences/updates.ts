import { workspace, WorkspaceConfiguration } from "vscode";
import { Preferences, PreferencesResourceApi, PreferencesSpec } from "../clients/sidecar";
import { logError } from "../errors";
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
  }
}
