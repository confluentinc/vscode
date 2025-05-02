import { Disposable, Uri } from "vscode";
import { registerCommandWithLogging } from ".";
import { uriMetadataSet } from "../emitters";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { flinkComputePoolQuickPick } from "../quickpicks/flinkComputePools";
import { hasCCloudAuthSession } from "../sidecar/connections/ccloud";
import { UriMetadataKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("commands.documents");

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
}

export function registerDocumentCommands(): Disposable[] {
  return [
    registerCommandWithLogging(
      "confluent.document.flinksql.setCCloudComputePool",
      setCCloudComputePoolForUriCommand,
    ),
  ];
}
