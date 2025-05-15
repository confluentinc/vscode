import {
  commands,
  ConfigurationChangeEvent,
  Disposable,
  workspace,
  WorkspaceConfiguration,
} from "vscode";
import { ContextValues, setContextValue } from "../context/values";
import { Logger } from "../logging";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import {
  ENABLE_CHAT_PARTICIPANT,
  ENABLE_FLINK,
  KRB5_CONFIG_PATH,
  LOCAL_DOCKER_SOCKET_PATH,
  SSL_PEM_PATHS,
  SSL_VERIFY_SERVER_CERT_DISABLED,
} from "./constants";
import { updatePreferences } from "./sidecarSync";

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
        await updatePreferences();
        return;
      }

      if (event.affectsConfiguration(SSL_VERIFY_SERVER_CERT_DISABLED)) {
        // inform the sidecar that the server cert verification has changed
        logger.debug(`"${SSL_VERIFY_SERVER_CERT_DISABLED}" config changed`);
        await updatePreferences();
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

      if (event.affectsConfiguration(KRB5_CONFIG_PATH)) {
        // inform the sidecar that the krb5 config path has changed
        logger.debug(`"${KRB5_CONFIG_PATH}" config changed`);
        await updatePreferences();
        return;
      }

      // --- EXPERIMENTAL/PREVIEW SETTINGS --
      // Remove the sections below once the behavior is enabled by default and a setting is no
      // longer needed to opt-in to the feature.
      if (event.affectsConfiguration(ENABLE_FLINK)) {
        // user toggled the "Enable Flink" preview setting
        const enabled = configs.get(ENABLE_FLINK, false);
        logger.debug(`"${ENABLE_FLINK}" config changed`, { enabled });
        setContextValue(ContextValues.flinkEnabled, enabled);
        // refresh the Resources view to toggle visibility of compute pools under environments
        if (hasCCloudAuthSession()) {
          commands.executeCommand("confluent.resources.refresh");
        }
        return;
      }

      if (event.affectsConfiguration(ENABLE_CHAT_PARTICIPANT)) {
        // user toggled the "Enable Chat Participant" experimental setting
        const enabled = configs.get(ENABLE_CHAT_PARTICIPANT, false);
        logger.debug(`"${ENABLE_CHAT_PARTICIPANT}" config changed`, { enabled });
        setContextValue(ContextValues.chatParticipantEnabled, enabled);
        return;
      }
    },
  );

  return disposable;
}
