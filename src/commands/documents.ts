import { commands, Disposable, TextDocument, Uri, workspace } from "vscode";
import { registerCommandWithLogging } from ".";
import { DocumentMetadataManager } from "../documentMetadataManager";
import { uriCCloudEnvSet, uriCCloudOrgSet, uriCCloudRegionProviderSet } from "../emitters";
import { getCurrentOrganization } from "../graphql/organizations";
import { Logger } from "../logging";
import { CCloudEnvironment } from "../models/environment";
import { CCloudOrganization } from "../models/organization";
import {
  ccloudEnvironmentQuickPick,
  flinkCcloudEnvironmentQuickPick,
} from "../quickpicks/environments";
import { providerRegionQuickPick } from "../quickpicks/providerRegion";
import { ProviderRegion } from "../types";

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

  logger.debug("setting 'ccloudOrgId' for document", { uri, orgId: org.id });
  await DocumentMetadataManager.getInstance().set(doc, "ccloudOrgId", org.id);

  uriCCloudOrgSet.fire({
    uri,
    orgId: org.id,
  });
}

export async function setCCloudEnvForUriCommand(uri?: Uri, onlyFlinkEnvs: boolean = false) {
  if (!(uri instanceof Uri)) {
    return;
  }

  const environment: CCloudEnvironment | undefined = onlyFlinkEnvs
    ? await flinkCcloudEnvironmentQuickPick()
    : await ccloudEnvironmentQuickPick();
  if (!environment) {
    return;
  }

  const doc: TextDocument = await workspace.openTextDocument(uri);
  if (!doc) {
    logger.error("Failed to open document for uri", { uri });
    return;
  }

  logger.debug("setting 'ccloudEnvId' for document", { uri, envId: environment.id });
  await DocumentMetadataManager.getInstance().set(doc, "ccloudEnvId", environment.id);

  uriCCloudEnvSet.fire({
    uri,
    envId: environment.id,
  });
}

export async function setCCloudRegionProviderForUriCommand(uri?: Uri) {
  if (!(uri instanceof Uri)) {
    return;
  }

  const providerRegion: ProviderRegion | undefined = await providerRegionQuickPick(
    (env) => env.flinkComputePools.length > 0,
  );
  if (!providerRegion) {
    return;
  }

  const doc: TextDocument = await workspace.openTextDocument(uri);
  if (!doc) {
    logger.error("Failed to open document for uri", { uri });
    return;
  }

  logger.debug("setting 'ccloudProviderRegion' for document", {
    uri,
    provider: providerRegion.provider,
    region: providerRegion.region,
  });
  await DocumentMetadataManager.getInstance().set(
    doc,
    "ccloudProviderRegion",
    JSON.stringify(providerRegion),
  );

  uriCCloudRegionProviderSet.fire({
    uri,
    region: providerRegion,
  });
}

export function registerDocumentCommands(): Disposable[] {
  return [
    registerCommandWithLogging("confluent.document.setCCloudOrg", setCCloudOrgForUriCommand),
    registerCommandWithLogging(
      "confluent.document.flinksql.setCCloudEnv",
      setCCloudEnvForUriCommand,
    ),
    registerCommandWithLogging(
      "confluent.document.flinksql.setCCloudRegionProvider",
      setCCloudRegionProviderForUriCommand,
    ),
  ];
}
