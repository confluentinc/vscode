import { ConfigurationChangeEvent, Disposable, workspace, WorkspaceConfiguration } from "vscode";
import { ContextValues, setContextValue } from "../context/values";
import { Logger } from "../logging";
import {
  ENABLE_PRODUCE_MESSAGES,
  LOCAL_DOCKER_SOCKET_PATH,
  SSL_PEM_PATHS,
  SSL_VERIFY_SERVER_CERT_DISABLED,
} from "./constants";
import { updatePreferences } from "./updates";

const logger = new Logger("preferences.listener");

/** Main listener for any changes to {@link WorkspaceConfiguration} that affect this extension. */
export function createConfigChangeListener(): Disposable {
  // NOTE: this fires from any VS Code configuration, not just configs from our extension
  const disposable: Disposable = workspace.onDidChangeConfiguration(
    async (event: ConfigurationChangeEvent) => {
      // get the latest workspace configs after the event fired
      const configs: WorkspaceConfiguration = workspace.getConfiguration();

      if (event.affectsConfiguration(SSL_PEM_PATHS)) {
        // inform the sidecar that the SSL/TLS .pem paths have changed
        logger.debug(`"${SSL_PEM_PATHS}" config changed`);
        const pemPaths: string[] = configs.get(SSL_PEM_PATHS, []);
        await updatePreferences({
          tls_pem_paths: pemPaths,
        });
        return;
      }

      if (event.affectsConfiguration(SSL_VERIFY_SERVER_CERT_DISABLED)) {
        // inform the sidecar that the server cert verification has changed
        logger.debug(`"${SSL_VERIFY_SERVER_CERT_DISABLED}" config changed`);
        // if the user disables server cert verification, trust all certs
        const trustAllCerts: boolean = configs.get(SSL_VERIFY_SERVER_CERT_DISABLED, false);
        await updatePreferences({ trust_all_certificates: trustAllCerts });
        return;
      }

      if (event.affectsConfiguration(LOCAL_DOCKER_SOCKET_PATH)) {
        // just log it so we don't have to log every time we use it
        logger.debug(
          `"${LOCAL_DOCKER_SOCKET_PATH}" changed:`,
          configs.get(LOCAL_DOCKER_SOCKET_PATH),
        );
        return;
      }

      // --- PREVIEW SETTINGS --
      // Remove the sections below once the behavior is enabled by default and a setting is no
      // longer needed to opt-in to the feature.

      if (event.affectsConfiguration(ENABLE_PRODUCE_MESSAGES)) {
        // user toggled the "Enable Produce Messages" preview setting
        const enabled = configs.get(ENABLE_PRODUCE_MESSAGES, false);
        logger.debug(`"${ENABLE_PRODUCE_MESSAGES}" config changed`, { enabled });
        setContextValue(ContextValues.produceMessagesEnabled, enabled);
        // no need to refresh the Topics view here since no items are being changed; VS Code will
        // handle updating the UI to toggle any actions' visibility/enablement
      }
    },
  );

  return disposable;
}
