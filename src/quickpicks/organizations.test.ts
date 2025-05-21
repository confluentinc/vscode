import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { TEST_CCLOUD_ORGANIZATION } from "../../tests/unit/testResources/organization";
import { IconNames } from "../constants";
import * as organizationsGraphQL from "../graphql/organizations";
import { CCloudOrganization } from "../models/organization";
import { OrganizationId } from "../models/resource";
import { organizationQuickPick } from "./organizations";
import { QuickPickItemWithValue } from "./types";

describe("quickpicks/organizations.ts organizationQuickPick()", function () {
  let sandbox: sinon.SinonSandbox;

  let showQuickPickStub: sinon.SinonStub;
  let showInfoStub: sinon.SinonStub;
  let getOrganizationsStub: sinon.SinonStub;

  const nonCurrentOrg = CCloudOrganization.create({
    id: "other-org-id" as OrganizationId,
    current: false,
    name: "other org",
    jit_enabled: false,
  });
  const testOrganizations: CCloudOrganization[] = [TEST_CCLOUD_ORGANIZATION, nonCurrentOrg];

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // vscode stubs
    showQuickPickStub = sandbox.stub(vscode.window, "showQuickPick");
    showInfoStub = sandbox.stub(vscode.window, "showInformationMessage").resolves();

    // graphql stubs
    getOrganizationsStub = sandbox.stub(organizationsGraphQL, "getOrganizations");
    // return the two test organizations for most tests
    getOrganizationsStub.resolves(testOrganizations);
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should correctly set quickpick options", async function () {
    await organizationQuickPick();

    sinon.assert.calledOnce(showQuickPickStub);
    const options = showQuickPickStub.firstCall.args[1];
    assert.strictEqual(options.placeHolder, "Select an organization");
    assert.strictEqual(options.ignoreFocusOut, true);
  });

  it("should show quickpick with organizations and appropriate icons", async function () {
    await organizationQuickPick();

    sinon.assert.calledOnce(getOrganizationsStub);
    sinon.assert.calledOnce(showQuickPickStub);

    const quickPickItems: QuickPickItemWithValue<CCloudOrganization>[] =
      showQuickPickStub.firstCall.args[0];
    assert.strictEqual(quickPickItems.length, 2);

    // make sure the first item is the "current" organization and check its properties
    const currentOrgItem = quickPickItems.find((item) => item.value!.current === true);
    assert.ok(currentOrgItem, "Should find the current organization item");
    assert.strictEqual(currentOrgItem.value, TEST_CCLOUD_ORGANIZATION);
    assert.strictEqual(currentOrgItem.label, TEST_CCLOUD_ORGANIZATION.name);
    assert.strictEqual(currentOrgItem.description, TEST_CCLOUD_ORGANIZATION.id);
    assert.strictEqual(
      (currentOrgItem.iconPath as vscode.ThemeIcon).id,
      IconNames.CURRENT_RESOURCE,
    );

    // check the non-current org's properties
    const nonCurrentOrgItem = quickPickItems.find((item) => item.value!.current === false);
    assert.ok(nonCurrentOrgItem, "Should find the non-current organization item");
    assert.strictEqual(nonCurrentOrgItem.value, nonCurrentOrg);
    assert.strictEqual(nonCurrentOrgItem.label, nonCurrentOrg.name);
    assert.strictEqual(nonCurrentOrgItem.description, nonCurrentOrg.id);
    assert.strictEqual((nonCurrentOrgItem.iconPath as vscode.ThemeIcon).id, IconNames.ORGANIZATION);

    // verify sort order
    const alphabeticallySortedOrgs = [...testOrganizations].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    assert.strictEqual(quickPickItems[0].value, alphabeticallySortedOrgs[0]);
    assert.strictEqual(quickPickItems[1].value, alphabeticallySortedOrgs[1]);
  });

  it("should return the selected organization", async function () {
    // simulate user selecting the first organization
    showQuickPickStub.resolves({
      label: testOrganizations[0].name,
      value: testOrganizations[0],
    });

    const result: CCloudOrganization | undefined = await organizationQuickPick();

    assert.strictEqual(result, testOrganizations[0]);
  });

  it("should return undefined if no organization is selected", async function () {
    // user cancels the quickpick
    showQuickPickStub.resolves(undefined);

    const result: CCloudOrganization | undefined = await organizationQuickPick();

    assert.strictEqual(result, undefined);
  });

  it("should skip the quickpick and show an info notification when no organizations are found", async function () {
    // simulate getting no organizations back from GraphQL
    getOrganizationsStub.resolves([]);

    const result: CCloudOrganization | undefined = await organizationQuickPick();

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnce(showInfoStub);
    sinon.assert.calledWithExactly(showInfoStub, "No organizations available.");
    sinon.assert.notCalled(showQuickPickStub);
  });
});
