import { ThemeIcon, window } from "vscode";
import { IconNames } from "../constants";
import { getOrganizations } from "../graphql/organizations";
import { CCloudOrganization } from "../models/organization";
import { QuickPickItemWithValue } from "./types";

/**
 * Displays a quickpick for selecting a CCloud organization.
 *
 * @returns The selected {@link CCloudOrganization} or `undefined` if no selection was made.
 */
export async function organizationQuickPick(): Promise<CCloudOrganization | undefined> {
  const ccloudOrganizations: CCloudOrganization[] = await getOrganizations();
  if (ccloudOrganizations.length === 0) {
    window.showInformationMessage("No organizations available.");
    return;
  }

  let organizationItems: QuickPickItemWithValue<CCloudOrganization>[] = [];
  ccloudOrganizations.sort((a, b) => a.name.localeCompare(b.name));
  ccloudOrganizations.forEach((organization: CCloudOrganization) => {
    organizationItems.push({
      label: organization.name,
      description: organization.id,
      iconPath: new ThemeIcon(
        organization.current ? IconNames.CURRENT_RESOURCE : IconNames.ORGANIZATION,
      ),
      value: organization,
    });
  });

  const chosenOrganizationItem: QuickPickItemWithValue<CCloudOrganization> | undefined =
    await window.showQuickPick(organizationItems, {
      placeHolder: "Select an organization",
      ignoreFocusOut: true,
    });

  return chosenOrganizationItem?.value;
}
