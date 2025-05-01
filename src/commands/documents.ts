import { commands, Disposable, Uri, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import { uriMetadataSet } from "../emitters";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { showInfoNotificationWithButtons } from "../notifications";
import {
  UPDATE_DEFAULT_DATABASE_FROM_LENS,
  UPDATE_DEFAULT_POOL_ID_FROM_LENS,
} from "../preferences/constants";
import { updateDefaultFlinkDatabaseId, updateDefaultFlinkPoolId } from "../preferences/updates";
import { flinkComputePoolQuickPick } from "../quickpicks/flinkComputePools";
import { flinkDatabaseQuickpick } from "../quickpicks/kafkaClusters";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { UriMetadataKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("commands.documents");

/** Possible values for user settings controlling whether or not to update the default Flink resource IDs. */
export type NeverAskAlways = "never" | "ask" | "always";

export async function setCCloudComputePoolForUriCommand(uri?: Uri) {
  if (!(uri instanceof Uri)) {
    return;
  }
  if (!hasCCloudAuthSession()) {
    // shouldn't happen since callers shouldn't be able to call this command without a valid CCloud
    // connection, but just in case
    logger.warn("not setting compute pool for URI: no CCloud auth session");
    return;
  }

  const pool: CCloudFlinkComputePool | undefined = await flinkComputePoolQuickPick();
  if (!pool) {
    return;
  }

  logger.debug(`setting metadata for URI`, {
    uri: uri.toString(),
    [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: pool.id,
  });
  await getResourceManager().setUriMetadataValue(
    uri,
    UriMetadataKeys.FLINK_COMPUTE_POOL_ID,
    pool.id,
  );
  uriMetadataSet.fire(uri);

  // check user settings to see if we should ask to update the default compute pool ID or
  // just do it automatically. (if set to "never" or any other value, we won't ask and won't do it)
  const shouldUpdateDefaultPoolId: NeverAskAlways = workspace
    .getConfiguration()
    .get(UPDATE_DEFAULT_POOL_ID_FROM_LENS, "ask");
  if (shouldUpdateDefaultPoolId === "ask") {
    await showInfoNotificationWithButtons(
      `Set default Flink compute pool to "${pool.id}" ("${pool.name}")?`,
      {
        Yes: async () => {
          await updateDefaultFlinkPoolId(pool);
        },
        "Change Notification Settings": () => {
          void commands.executeCommand(
            "workbench.action.openSettings",
            `@id:${UPDATE_DEFAULT_POOL_ID_FROM_LENS}`,
          );
        },
      },
    );
  } else if (shouldUpdateDefaultPoolId === "always") {
    await updateDefaultFlinkPoolId(pool);
  }
}

export async function setCCloudCatalogDatabaseForUriCommand(
  uri?: Uri,
  pool?: CCloudFlinkComputePool,
) {
  if (!(uri instanceof Uri)) {
    return;
  }
  if (!hasCCloudAuthSession()) {
    // shouldn't happen since callers shouldn't be able to call this command without a valid CCloud
    // connection, but just in case
    logger.warn("not setting compute pool for URI: no CCloud auth session");
    return;
  }

  const computePool: CCloudFlinkComputePool | undefined =
    pool instanceof CCloudFlinkComputePool ? pool : await flinkComputePoolQuickPick();
  if (!computePool) {
    return;
  }

  const database: KafkaCluster | undefined = await flinkDatabaseQuickpick(computePool);
  if (!database) {
    return;
  }

  logger.debug("setting metadata for URI", {
    uri: uri.toString(),
    [UriMetadataKeys.FLINK_DATABASE_ID]: database.id,
  });
  await getResourceManager().setUriMetadataValue(
    uri,
    UriMetadataKeys.FLINK_DATABASE_ID,
    database.id,
  );
  uriMetadataSet.fire(uri);

  // check user settings to see if we should ask to update the default compute pool ID or
  // just do it automatically. (if set to "never" or any other value, we won't ask and won't do it)
  const shouldUpdateDefaultDatabaseId: NeverAskAlways = workspace
    .getConfiguration()
    .get(UPDATE_DEFAULT_DATABASE_FROM_LENS, "ask");
  if (shouldUpdateDefaultDatabaseId === "ask") {
    await showInfoNotificationWithButtons(
      `Set default Flink database to "${database.id}" ("${database.name}")?`,
      {
        Yes: async () => {
          await updateDefaultFlinkDatabaseId(database as CCloudKafkaCluster);
        },
        "Change Notification Settings": () => {
          void commands.executeCommand(
            "workbench.action.openSettings",
            `@id:${UPDATE_DEFAULT_DATABASE_FROM_LENS}`,
          );
        },
      },
    );
  } else if (shouldUpdateDefaultDatabaseId === "always") {
    await updateDefaultFlinkDatabaseId(database as CCloudKafkaCluster);
  }
}

export function registerDocumentCommands(): Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.document.flinksql.setCCloudComputePool",
      setCCloudComputePoolForUriCommand,
    ),
    registerCommandWithLogging(
      "confluent.document.flinksql.setCCloudCatalogDatabase",
      setCCloudCatalogDatabaseForUriCommand,
    ),
  ];
}
