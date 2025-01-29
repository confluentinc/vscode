import { Preferences, PreferencesResourceApi, PreferencesSpec } from "../clients/sidecar";
import { logError } from "../errors";
import { Logger } from "../logging";
import { getSidecar } from "../sidecar";

const logger = new Logger("preferences.updates");

/** Fetch the current {@link Preferences} from the sidecar. */
export async function fetchPreferences(): Promise<Preferences> {
  const client: PreferencesResourceApi = (await getSidecar()).getPreferencesApi();
  try {
    return await client.gatewayV1PreferencesGet();
  } catch (error) {
    logError(error, "fetching preferences", {}, true);
    throw error;
  }
}

/**
 * Update one or more items in the {@link PreferencesSpec} based on the WorkspaceConfiguration.
 * @param updates - Partial object of key-value pairs to update in the preferences.
 *
 * @example
 * // Update the `tls_pem_paths` preference with the latest value from the workspace configuration.
 * const pemPaths: string[] = configs.get(SSL_PEM_PATHS, []);
 * await updatePreferences({
 *  tls_pem_paths: pemPaths,
 * });
 */
export async function updatePreferences(updates: Partial<Record<keyof PreferencesSpec, any>>) {
  // merge the sidecar's current preferences with any updates passed in
  const preferences: Preferences = await fetchPreferences();
  const updatedSpec: PreferencesSpec = { ...preferences.spec };
  for (const [key, value] of Object.entries(updates)) {
    updatedSpec[key as keyof PreferencesSpec] = value;
  }

  const client: PreferencesResourceApi = (await getSidecar()).getPreferencesApi();
  try {
    const resp = await client.gatewayV1PreferencesPut({
      Preferences: {
        ...preferences, // api_version, kind, metadata
        spec: updatedSpec,
      },
    });
    logger.debug("Successfully updated preferences: ", { resp });
  } catch (error) {
    logError(
      error,
      "updating preferences",
      {
        updateKeys: Object.keys(updates).join(","), // log extension setting ID(s) updated
      },
      true,
    );
  }
}
