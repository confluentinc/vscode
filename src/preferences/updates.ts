import {
  Preferences,
  PreferencesResourceApi,
  PreferencesSpec,
  ResponseError,
} from "../clients/sidecar";
import { Logger } from "../logging";
import { getSidecar } from "../sidecar";

const logger = new Logger("preferences.updates");

/** Fetch the current {@link Preferences} from the sidecar. */
export async function fetchPreferences(): Promise<Preferences> {
  const client: PreferencesResourceApi = (await getSidecar()).getPreferencesApi();
  try {
    return await client.gatewayV1PreferencesGet();
  } catch (error) {
    if (error instanceof ResponseError) {
      let body;
      try {
        body = await error.response.json();
      } catch {
        body = await error.response.text();
      }

      logger.error("Error response getting preferences from sidecar: ", {
        error: body,
        status: error.response.status,
        statusText: error.response.statusText,
      });
    } else {
      logger.error("Error getting preferences: ", { error });
    }
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
    if (error instanceof ResponseError) {
      const data = await error.response.json();
      logger.error("Error response setting preferences: ", {
        error: data,
        status: error.response.status,
        statusText: error.response.statusText,
      });
    } else {
      logger.error("Error updating preference: ", { error });
    }
    // TODO: notification?
  }
}
