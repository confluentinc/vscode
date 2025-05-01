import { commands, Disposable, TextDocument, Uri, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import { uriMetadataSet } from "../emitters";
import { getCurrentOrganization } from "../graphql/organizations";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudKafkaCluster, KafkaCluster } from "../models/kafkaCluster";
import { CCloudOrganization } from "../models/organization";
import {
  showErrorNotificationWithButtons,
  showInfoNotificationWithButtons,
} from "../notifications";
import {
  UPDATE_DEFAULT_DATABASE_FROM_LENS,
  UPDATE_DEFAULT_POOL_ID_FROM_LENS,
} from "../preferences/constants";
import { updateDefaultFlinkDatabaseId, updateDefaultFlinkPoolId } from "../preferences/updates";
import { flinkComputePoolQuickPick } from "../quickpicks/flinkComputePools";
import { flinkDatabaseQuickpick } from "../quickpicks/kafkaClusters";
import { UriMetadataKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";
import { UriMetadata } from "../storage/types";

const logger = new Logger("commands.documents");

/** Possible values for user settings controlling whether or not to update the default Flink resource IDs. */
export type NeverAskAlways = "never" | "ask" | "always";

export async function setCCloudOrgForUriCommand(uri?: Uri) {
  if (!(uri instanceof Uri)) {
    return;
  }

  // handle the actual org-switching which requires changing the CCloud connection
  await commands.executeCommand("confluent.organizations.use");
  // then look it up again since we don't get a return value from the command execution
  const org: CCloudOrganization | undefined = await getCurrentOrganization();
  if (!org) {
    return;
  }

  const doc: TextDocument = await workspace.openTextDocument(uri);
  if (!doc) {
    logger.error("Failed to open document to update ccloudOrg", { uri });
    return;
  }

  logger.debug("setting metadata for document", {
    uri: uri.toString(),
    orgId: org.id,
  });
  await getResourceManager().setUriMetadataValue(uri, UriMetadataKeys.CCLOUD_ORG_ID, org.id);
  uriMetadataSet.fire(uri);
}

export async function setCCloudComputePoolForUriCommand(uri?: Uri) {
  if (!(uri instanceof Uri)) {
    return;
  }

  const pool: CCloudFlinkComputePool | undefined = await flinkComputePoolQuickPick();
  if (!pool) {
    return;
  }

  let doc: TextDocument | undefined;
  try {
    doc = await workspace.openTextDocument(uri);
  } catch (error) {
    logger.error("Failed to open document to set compute pool metadata", {
      uri: uri.toString(),
      error,
    });
    showErrorNotificationWithButtons(`Failed to open document "${uri.toString()}": ${error}`);
  }
  if (!doc) {
    return;
  }

  logger.debug(`setting metadata for document`, {
    uri: uri.toString(),
    envId: pool.environmentId,
    provider: pool.provider,
    region: pool.region,
    computePoolId: pool.id,
  });

  const metadata: UriMetadata = {
    [UriMetadataKeys.CCLOUD_PROVIDER]: pool.provider,
    [UriMetadataKeys.CCLOUD_REGION]: pool.region,
    [UriMetadataKeys.ENVIRONMENT_ID]: pool.environmentId,
    [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: pool.id,
  };
  await getResourceManager().setUriMetadata(uri, metadata);
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

  const computePool: CCloudFlinkComputePool | undefined =
    pool instanceof CCloudFlinkComputePool ? pool : await flinkComputePoolQuickPick();
  if (!computePool) {
    return;
  }

  const doc: TextDocument = await workspace.openTextDocument(uri);
  if (!doc) {
    logger.error("Failed to open document to update ccloudOrg", { uri });
    return;
  }

  const database: KafkaCluster | undefined = await flinkDatabaseQuickpick(computePool);
  if (!database) {
    return;
  }

  logger.debug("setting metadata for document", {
    uri: uri.toString(),
    envId: computePool.environmentId,
    provider: computePool.provider,
    region: computePool.region,
    catalogId: database.environmentId,
    databaseId: database.id,
  });

  const metadata: UriMetadata = {
    [UriMetadataKeys.CCLOUD_PROVIDER]: computePool.provider,
    [UriMetadataKeys.CCLOUD_REGION]: computePool.region,
    [UriMetadataKeys.ENVIRONMENT_ID]: computePool.environmentId,
    [UriMetadataKeys.FLINK_CATALOG_ID]: database.environmentId,
    [UriMetadataKeys.FLINK_DATABASE_ID]: database.id,
  };
  await getResourceManager().setUriMetadata(uri, metadata);
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
    registerCommandWithLogging("confluent.document.setCCloudOrg", setCCloudOrgForUriCommand),
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
