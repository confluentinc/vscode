import * as vscode from "vscode";
import { IconNames } from "../constants";
import { getOrganizations } from "../graphql/organizations";
import { CCloudOrganization } from "../models/organization";

export async function organizationQuickPick(): Promise<CCloudOrganization | undefined> {
  const ccloudOrganizations: CCloudOrganization[] = await getOrganizations();
  if (ccloudOrganizations.length === 0) {
    vscode.window.showInformationMessage("No organizations available.");
    return undefined;
  }

  let organizationItems: vscode.QuickPickItem[] = [];
  ccloudOrganizations.sort((a, b) => a.name.localeCompare(b.name));
  ccloudOrganizations.forEach((organization: CCloudOrganization) => {
    organizationItems.push({
      label: organization.name,
      description: organization.id,
      iconPath: new vscode.ThemeIcon(
        organization.current ? IconNames.CURRENT_RESOURCE : IconNames.ORGANIZATION,
      ),
    });
  });

  const chosenOrganizationItem: vscode.QuickPickItem | undefined =
    await vscode.window.showQuickPick(organizationItems, {
      placeHolder: "Select an organization",
      ignoreFocusOut: true,
    });

  return chosenOrganizationItem
    ? ccloudOrganizations.find((org) => org.id === chosenOrganizationItem.description)
    : undefined;
}
