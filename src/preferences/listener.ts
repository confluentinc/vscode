import { ConfigurationChangeEvent, Disposable, WorkspaceConfiguration, workspace } from "vscode";
import { ContextValues, setContextValue } from "../context/values";
import { Logger } from "../logging";
import { isDirect } from "../models/resource";
import { getResourceViewProvider } from "../viewProviders/resources";
import { getSchemasViewProvider } from "../viewProviders/schemas";
import { getTopicViewProvider } from "../viewProviders/topics";
import {
  ENABLE_DIRECT_CONNECTIONS,
  ENABLE_PRODUCE_MESSAGES,
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

      // --- PREVIEW SETTINGS --
      // Remove the sections below once the behavior is enabled by default and a setting is no
      // longer needed to opt-in to the feature.

      if (event.affectsConfiguration(ENABLE_DIRECT_CONNECTIONS)) {
        // user toggled the "Enable Direct Connections" preview setting
        const enabled = configs.get(ENABLE_DIRECT_CONNECTIONS, false);
        logger.debug(`"${ENABLE_DIRECT_CONNECTIONS}" config changed`, { enabled });
        setContextValue(ContextValues.directConnectionsEnabled, enabled);
        // "Other" container item will be toggled
        getResourceViewProvider().refresh();
        // if the Topics/Schemas views are focused on a direct connection based resource, wipe them
        if (!enabled) {
          const topicsView = getTopicViewProvider();
          if (topicsView.kafkaCluster && isDirect(topicsView.kafkaCluster)) {
            topicsView.reset();
          }
          const schemasView = getSchemasViewProvider();
          if (schemasView.schemaRegistry && isDirect(schemasView.schemaRegistry)) {
            schemasView.reset();
          }
        }
        return;
      }

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
