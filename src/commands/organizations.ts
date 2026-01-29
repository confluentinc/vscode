import * as vscode from "vscode";
import { registerCommandWithLogging } from ".";
import { ccloudOrganizationChanged } from "../emitters";
import { getCurrentOrganization, setCurrentOrganizationId } from "../fetchers/organizationFetcher";
import type { CCloudOrganization } from "../models/organization";
import { organizationQuickPick } from "../quickpicks/organizations";
import { clearCurrentCCloudResources, hasCCloudAuthSession } from "../authn/ccloudSession";

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
      // Update the current organization ID in the fetcher cache
      setCurrentOrganizationId(organization.id);

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
