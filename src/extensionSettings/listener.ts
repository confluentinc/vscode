import { ConfigurationChangeEvent, Disposable, workspace } from "vscode";
import { ContextValues, setContextValue } from "../context/values";
import { FlinkLanguageClientManager } from "../flinkSql/flinkLanguageClientManager";
import { Logger } from "../logging";
import { logUsage, UserEvent } from "../telemetry/events";
import {
  CCLOUD_PRIVATE_NETWORK_ENDPOINTS,
  ENABLE_CHAT_PARTICIPANT,
  ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER,
  KRB5_CONFIG_PATH,
  LOCAL_DOCKER_SOCKET_PATH,
  SSL_PEM_PATHS,
  SSL_VERIFY_SERVER_CERT_DISABLED,
} from "./constants";
import { updatePreferences } from "./sidecarSync";

const logger = new Logger("preferences.listener");

/** Any settings that require syncing with the sidecar's preferences API. */
export const PREFERENCES_SYNC_SETTINGS = [
  SSL_PEM_PATHS,
  SSL_VERIFY_SERVER_CERT_DISABLED,
  KRB5_CONFIG_PATH,
  CCLOUD_PRIVATE_NETWORK_ENDPOINTS,
];

/** Main listener for any changes to workspace settings. */
export function createConfigChangeListener(): Disposable {
  // NOTE: this fires from any VS Code configuration, not just configs from our extension
  const disposable: Disposable = workspace.onDidChangeConfiguration(
    async (event: ConfigurationChangeEvent) => {
      const changedId = PREFERENCES_SYNC_SETTINGS.find((setting) =>
        event.affectsConfiguration(setting.id),
      );
      if (changedId) {
        logger.debug(`"${changedId.id}" setting changed`);
        await updatePreferences();
        return;
      }

      if (event.affectsConfiguration(LOCAL_DOCKER_SOCKET_PATH.id)) {
        // just log it so we don't have to log every time we use it
        logger.debug(
          `"${LOCAL_DOCKER_SOCKET_PATH.id}" setting changed:`,
          LOCAL_DOCKER_SOCKET_PATH.value,
        );
        return;
      }

      // --- EXPERIMENTAL/PREVIEW SETTINGS --
      // Remove the sections below once the behavior is enabled by default and a setting is no
      // longer needed to opt-in to the feature.
      if (event.affectsConfiguration(ENABLE_CHAT_PARTICIPANT.id)) {
        // user toggled the "Enable Chat Participant" experimental setting
        const enabled: boolean = ENABLE_CHAT_PARTICIPANT.value;
        logger.debug(`"${ENABLE_CHAT_PARTICIPANT.id}" setting changed`, { enabled });
        setContextValue(ContextValues.chatParticipantEnabled, enabled);
        // telemetry for how often users opt in or out of the chat participant feature
        logUsage(UserEvent.ExtensionSettingsChange, {
          settingId: ENABLE_CHAT_PARTICIPANT.id,
          enabled,
        });
        return;
      }

      if (event.affectsConfiguration(ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id)) {
        // user toggled the "Enable Flink CCloud Language Server" preview setting
        // TODO when we remove this flag and settings listener, remove the undefined uri option in `maybeStartLanguageClient`
        const enabled: boolean = ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.value;
        logger.debug(`"${ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id}" setting changed`, { enabled });

        const manager = FlinkLanguageClientManager.getInstance();
        if (enabled) {
          // start the Flink Language Client Manager up if it isn't already running
          // (this is typically done internally based on various events, but we want to ensure
          // it starts up when the user opts in to the feature)
          manager.maybeStartLanguageClient();
        } else {
          // stop the Flink Language Client Manager if it's running
          manager.dispose();
        }

        // telemetry for how often users opt in or out of the Flink CCloud Language Server feature
        logUsage(UserEvent.ExtensionSettingsChange, {
          settingId: ENABLE_FLINK_CCLOUD_LANGUAGE_SERVER.id,
          enabled,
        });
        return;
      }
    },
  );

  return disposable;
}
