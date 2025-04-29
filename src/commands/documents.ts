import { commands, Disposable, TextDocument, Uri, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import { uriMetadataSet } from "../emitters";
import { getCurrentOrganization } from "../graphql/organizations";
import { Logger } from "../logging";
import { CCloudFlinkComputePool } from "../models/flinkComputePool";
import { CCloudOrganization } from "../models/organization";
import { flinkComputePoolQuickPick } from "../quickpicks/flinkComputePools";
import { UriMetadataKeys } from "../storage/constants";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("commands.documents");

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

  const doc: TextDocument = await workspace.openTextDocument(uri);
  if (!doc) {
    logger.error("Failed to open document for uri", { uri });
    return;
  }

  logger.debug(`setting metadata for document`, {
    uri: uri.toString(),
    envId: pool.environmentId,
    provider: pool.provider,
    region: pool.region,
    computePoolId: pool.id,
  });

  await getResourceManager().setUriMetadata(uri, {
    [UriMetadataKeys.CCLOUD_PROVIDER]: pool.provider,
    [UriMetadataKeys.CCLOUD_REGION]: pool.region,
    [UriMetadataKeys.ENVIRONMENT_ID]: pool.environmentId,
    [UriMetadataKeys.COMPUTE_POOL_ID]: pool.id,
  });
  uriMetadataSet.fire(uri);
}

export function registerDocumentCommands(): Disposable[] {
  return [
    registerCommandWithLogging("confluent.document.setCCloudOrg", setCCloudOrgForUriCommand),
    registerCommandWithLogging(
      "confluent.document.flinksql.setCCloudComputePool",
      setCCloudComputePoolForUriCommand,
    ),
  ];
}
