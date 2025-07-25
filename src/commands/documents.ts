import { commands, Disposable, Uri } from "vscode";
import { registerCommandWithLogging } from ".";
import { uriMetadataSet } from "../emitters";
import {
  FLINK_CONFIG_COMPUTE_POOL,
  FLINK_CONFIG_DATABASE,
  NeverAskAlways,
  UPDATE_DEFAULT_DATABASE_FROM_LENS,
  UPDATE_DEFAULT_POOL_ID_FROM_LENS,
} from "../extensionSettings/constants";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { showInfoNotificationWithButtons } from "../notifications";
import { flinkComputePoolQuickPick } from "../quickpicks/flinkComputePools";
import { flinkDatabaseQuickpick } from "../quickpicks/kafkaClusters";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { UriMetadataKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("commands.documents");

export async function setCCloudComputePoolForUriCommand(uri?: Uri, database?: CCloudKafkaCluster) {
  if (!(uri instanceof Uri)) {
    return;
  }
  if (!hasCCloudAuthSession()) {
    // shouldn't happen since callers shouldn't be able to call this command without a valid CCloud
    // connection, but just in case
    logger.warn("not setting compute pool for URI: no CCloud auth session");
    return;
  }

  // if a database is provided, we need to match provider/region when showing the pool quickpick
  const filter = database
    ? (pool: CCloudFlinkComputePool) =>
        pool.provider === database.provider && pool.region === database.region
    : undefined;
  const pool: CCloudFlinkComputePool | undefined = await flinkComputePoolQuickPick(filter);
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

  const defaultPoolId: string = FLINK_CONFIG_COMPUTE_POOL.value;
  if (defaultPoolId === pool.id) {
    // don't ask if the default pool ID is already set to the selected pool ID
    return;
  }

  // check user settings to see if we should ask to update the default compute pool ID or
  // just do it automatically. (if set to "never" or any other value, we won't ask and won't do it)
  const shouldUpdateDefaultPoolId: NeverAskAlways = UPDATE_DEFAULT_POOL_ID_FROM_LENS.value;
  if (shouldUpdateDefaultPoolId === "ask") {
    await showInfoNotificationWithButtons(
      `Set default Flink compute pool to "${pool.id}" ("${pool.name}")?`,
      {
        Yes: async () => {
          await FLINK_CONFIG_COMPUTE_POOL.update(pool.id, true);
        },
        "Change Notification Settings": () => {
          void commands.executeCommand(
            "workbench.action.openSettings",
            `@id:${UPDATE_DEFAULT_POOL_ID_FROM_LENS.id}`,
          );
        },
      },
    );
  } else if (shouldUpdateDefaultPoolId === "always") {
    await FLINK_CONFIG_COMPUTE_POOL.update(pool.id, true);
  }
}

export async function setCCloudDatabaseForUriCommand(uri?: Uri, pool?: CCloudFlinkComputePool) {
  if (!(uri instanceof Uri)) {
    return;
  }
  if (!hasCCloudAuthSession()) {
    // shouldn't happen since callers shouldn't be able to call this command without a valid CCloud
    // connection, but just in case
    logger.warn("not setting database for URI: no CCloud auth session");
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

  const defaultDatabaseId: string = FLINK_CONFIG_DATABASE.value;
  if (defaultDatabaseId === database.id) {
    // don't ask if the default database ID is already set to the selected database ID
    return;
  }

  // check user settings to see if we should ask to update the default compute pool ID or
  // just do it automatically. (if set to "never" or any other value, we won't ask and won't do it)
  const shouldUpdateDefaultDatabaseId: NeverAskAlways = UPDATE_DEFAULT_DATABASE_FROM_LENS.value;
  if (shouldUpdateDefaultDatabaseId === "ask") {
    await showInfoNotificationWithButtons(
      `Set default Flink database to "${database.id}" ("${database.name}")?`,
      {
        Yes: async () => {
          await FLINK_CONFIG_DATABASE.update(database.id, true);
        },
        "Change Notification Settings": () => {
          void commands.executeCommand(
            "workbench.action.openSettings",
            `@id:${UPDATE_DEFAULT_DATABASE_FROM_LENS.id}`,
          );
        },
      },
    );
  } else if (shouldUpdateDefaultDatabaseId === "always") {
    await FLINK_CONFIG_DATABASE.update(database.id, true);
  }
}

export async function resetCCloudMetadataForUriCommand(uri?: Uri) {
  if (!(uri instanceof Uri)) {
    return;
  }
  if (!hasCCloudAuthSession()) {
    // shouldn't happen since callers shouldn't be able to call this command without a valid CCloud
    // connection, but just in case
    logger.warn("not resetting metadata for URI: no CCloud auth session");
    return;
  }

  logger.debug("nullifying metadata for URI", {
    uri: uri.toString(),
  });
  // explicitly set to `null` instead of `undefined` so defaults from settings aren't used
  await getResourceManager().setUriMetadata(uri, {
    [UriMetadataKeys.FLINK_DATABASE_ID]: null,
    [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: null,
  });
  uriMetadataSet.fire(uri);
}

export function registerDocumentCommands(): Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.document.flinksql.setCCloudComputePool",
      setCCloudComputePoolForUriCommand,
    ),
    registerCommandWithLogging(
      "confluent.document.flinksql.setCCloudDatabase",
      setCCloudDatabaseForUriCommand,
    ),
    registerCommandWithLogging(
      "confluent.document.flinksql.resetCCloudMetadata",
      resetCCloudMetadataForUriCommand,
    ),
  ];
}
