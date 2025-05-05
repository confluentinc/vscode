import { Disposable, Uri } from "vscode";
import { registerCommandWithLogging } from ".";
import { uriMetadataSet } from "../emitters";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
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

  logger.debug("resetting metadata for URI", {
    uri: uri.toString(),
  });
  await getResourceManager().deleteUriMetadata(uri);
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
