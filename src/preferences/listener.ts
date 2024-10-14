import { ConfigurationChangeEvent, Disposable, WorkspaceConfiguration, workspace } from "vscode";
import { PreferencesResourceApi } from "../clients/sidecar";
import { Logger } from "../logging";
import { SSL_PEM_PATHS, SSL_VERIFY_SERVER_CERT_DISABLED } from "./constants";
import { updatePreferences } from "./updates";

const logger = new Logger("preferences.listener");

/**
 * Listen to changes to {@link WorkspaceConfiguration} and send requests to the sidecar's
 * {@link PreferencesResourceApi} according to any configurations that need to stay in sync between
 * the extension and the sidecar.
 */
export function createConfigChangeListener(): Disposable {
  // NOTE: this fires from any VS Code configuration, not just configs from our extension
  const disposable: Disposable = workspace.onDidChangeConfiguration(
    async (event: ConfigurationChangeEvent) => {
      // get the latest workspace configs after the event fired
      const configs: WorkspaceConfiguration = workspace.getConfiguration();

      if (event.affectsConfiguration(SSL_PEM_PATHS)) {
        logger.debug(`"${SSL_PEM_PATHS}" config changed`);
        const pemPaths: string[] = configs.get(SSL_PEM_PATHS, []);
        await updatePreferences({
          tls_pem_paths: pemPaths,
        });
      } else if (event.affectsConfiguration(SSL_VERIFY_SERVER_CERT_DISABLED)) {
        logger.debug(`"${SSL_VERIFY_SERVER_CERT_DISABLED}" config changed`);
        // if the user disables server cert verification, trust all certs
        const trustAllCerts: boolean = configs.get(SSL_VERIFY_SERVER_CERT_DISABLED, false);
        await updatePreferences({ trust_all_certificates: trustAllCerts });
      }
    },
  );

  return disposable;
}
