import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { CCLOUD_CONNECTION_SPEC } from "../constants";
import { ccloudOrganizationChanged } from "../emitters";
import { getCurrentOrganization } from "../graphql/organizations";
import { CCloudOrganization } from "../models/organization";
import { organizationQuickPick } from "../quickpicks/organizations";
import {
  clearCurrentCCloudResources,
  hasCCloudAuthSession,
  tryToUpdateConnection,
} from "../sidecar/connections";

async function useOrganizationCommand() {
  if (!hasCCloudAuthSession()) {
    return;
  }
  const organization: CCloudOrganization | undefined = await organizationQuickPick();
  if (!organization) {
    return;
  }
  const currentOrg = await getCurrentOrganization();
  if (currentOrg && currentOrg.id === organization.id) {
    // no change needed
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Setting "${organization.name}" as the current organization...`,
      cancellable: true,
    },
    async () => {
      await tryToUpdateConnection({
        ...CCLOUD_CONNECTION_SPEC,
        ccloud_config: {
          organization_id: organization.id,
          uri_scheme: vscode.env.uriScheme,
        },
      });

      await clearCurrentCCloudResources();

      ccloudOrganizationChanged.fire();
    },
  );
}

async function copyOrganizationId() {
  const currentOrg = await getCurrentOrganization();
  if (!currentOrg) {
    return;
  }

  await vscode.env.clipboard.writeText(currentOrg.id);
  vscode.window.showInformationMessage(`Copied "${currentOrg.id}" to clipboard.`);
}

export function registerOrganizationCommands(): vscode.Disposable[] {
  return [
    registerCommandWithLogging("confluent.organizations.use", useOrganizationCommand),
    registerCommandWithLogging("confluent.copyOrganizationId", copyOrganizationId),
  ];
}
