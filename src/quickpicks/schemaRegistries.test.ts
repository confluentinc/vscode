import * as assert from "assert";
import * as sinon from "sinon";
import { commands, QuickPickItemKind, ThemeIcon, window } from "vscode";
import {
  getStubbedCCloudResourceLoader,
  getStubbedDirectResourceLoader,
  getStubbedLocalResourceLoader,
} from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_ENVIRONMENT,
  TEST_DIRECT_ENVIRONMENT,
  TEST_LOCAL_ENVIRONMENT,
} from "../../tests/unit/testResources/environments";
import {
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_DIRECT_SCHEMA_REGISTRY,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources/schemaRegistry";
import { CCLOUD_SIGN_IN_BUTTON_LABEL } from "../authn/constants";
import { ConnectionType } from "../clients/sidecar";
import { IconNames } from "../constants";
import * as contextValues from "../context/values";
import { CCloudResourceLoader, DirectResourceLoader, LocalResourceLoader } from "../loaders";
import { ConnectionLabel } from "../models/resource";
import { SchemaRegistry } from "../models/schemaRegistry";
import { SchemasViewProvider } from "../viewProviders/schemas";
import { schemaRegistryQuickPick } from "./schemaRegistries";
import { QuickPickItemWithValue } from "./types";

describe("quickpicks/schemaRegistries.ts schemaRegistryQuickPick()", function () {
  let sandbox: sinon.SinonSandbox;

  let showQuickPickStub: sinon.SinonStub;
  let showInfoStub: sinon.SinonStub;
  let executeCommandStub: sinon.SinonStub;
  let getContextValueStub: sinon.SinonStub;

  let schemasViewProvider: SchemasViewProvider;

  let ccloudLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
  let localLoader: sinon.SinonStubbedInstance<LocalResourceLoader>;
  let directLoader: sinon.SinonStubbedInstance<DirectResourceLoader>;

  beforeEach(function () {
    sandbox = sinon.createSandbox();

    // vscode stubs
    showQuickPickStub = sandbox.stub(window, "showQuickPick").resolves();
    executeCommandStub = sandbox.stub(commands, "executeCommand").resolves();
    // assume user dismisses the notification for most tests
    showInfoStub = sandbox.stub(window, "showInformationMessage").resolves();

    // helper function stubs
    getContextValueStub = sandbox.stub(contextValues, "getContextValue").returns(true);

    // ResourceLoader stubbed instances
    ccloudLoader = getStubbedCCloudResourceLoader(sandbox);
    ccloudLoader.getEnvironments.resolves([TEST_CCLOUD_ENVIRONMENT]);
    ccloudLoader.getSchemaRegistries.resolves([TEST_CCLOUD_SCHEMA_REGISTRY]);
    localLoader = getStubbedLocalResourceLoader(sandbox);
    localLoader.getEnvironments.resolves([TEST_LOCAL_ENVIRONMENT]);
    localLoader.getSchemaRegistries.resolves([TEST_LOCAL_SCHEMA_REGISTRY]);
    directLoader = getStubbedDirectResourceLoader(sandbox);
    directLoader.getEnvironments.resolves([TEST_DIRECT_ENVIRONMENT]);
    directLoader.getSchemaRegistries.resolves([TEST_DIRECT_SCHEMA_REGISTRY]);

    schemasViewProvider = SchemasViewProvider.getInstance();
  });

  afterEach(function () {
    SchemasViewProvider["instance"] = null;
    sandbox.restore();
  });

  it("should correctly set quickpick options", async function () {
    await schemaRegistryQuickPick();

    sinon.assert.calledOnce(showQuickPickStub);
    const options = showQuickPickStub.firstCall.args[1];
    assert.strictEqual(options.placeHolder, "Select a Schema Registry");
    assert.strictEqual(options.ignoreFocusOut, true);
  });

  it("should get schema registries and environments from the ResourceLoaders", async function () {
    await schemaRegistryQuickPick();

    sinon.assert.calledOnce(ccloudLoader.getEnvironments);
    sinon.assert.calledOnce(ccloudLoader.getSchemaRegistries);
    sinon.assert.calledOnce(localLoader.getEnvironments);
    sinon.assert.calledOnce(localLoader.getSchemaRegistries);
    sinon.assert.calledOnce(directLoader.getEnvironments);
    sinon.assert.calledOnce(directLoader.getSchemaRegistries);
  });

  it("should show quickpick with schema registries grouped by connection type and appropriate icons", async function () {
    await schemaRegistryQuickPick();

    sinon.assert.calledOnce(showQuickPickStub);

    const quickPickItems: QuickPickItemWithValue<SchemaRegistry>[] =
      showQuickPickStub.firstCall.args[0];

    // three Schema Registries and three separators (one for each connection type)
    assert.strictEqual(quickPickItems.length, 6);

    const separators = quickPickItems.filter((item) => item.kind === QuickPickItemKind.Separator);
    assert.strictEqual(separators.length, 3);
    assert.strictEqual(separators[0].label, ConnectionLabel.CCLOUD);
    assert.strictEqual(separators[1].label, ConnectionLabel.LOCAL);
    assert.strictEqual(separators[2].label, ConnectionLabel.DIRECT);

    // check the local SR quickpick item
    const localRegistryItem: QuickPickItemWithValue<SchemaRegistry> | undefined =
      quickPickItems.find(
        (item) =>
          item.kind !== QuickPickItemKind.Separator &&
          item.value?.connectionType === ConnectionType.Local,
      );
    assert.ok(localRegistryItem);
    assert.strictEqual(localRegistryItem.value, TEST_LOCAL_SCHEMA_REGISTRY);
    assert.strictEqual(localRegistryItem.label, TEST_LOCAL_ENVIRONMENT.name);
    assert.strictEqual(localRegistryItem.description, TEST_LOCAL_SCHEMA_REGISTRY.id);
    assert.strictEqual((localRegistryItem.iconPath as ThemeIcon).id, IconNames.SCHEMA_REGISTRY);

    // check the CCloud SR quickpick item
    const ccloudRegistryItem: QuickPickItemWithValue<SchemaRegistry> | undefined =
      quickPickItems.find(
        (item) =>
          item.kind !== QuickPickItemKind.Separator &&
          item.value?.connectionType === ConnectionType.Ccloud,
      );
    assert.ok(ccloudRegistryItem);
    assert.strictEqual(ccloudRegistryItem.value, TEST_CCLOUD_SCHEMA_REGISTRY);
    assert.strictEqual(ccloudRegistryItem.label, TEST_CCLOUD_ENVIRONMENT.name);
    assert.strictEqual(ccloudRegistryItem.description, TEST_CCLOUD_SCHEMA_REGISTRY.id);
    assert.strictEqual((ccloudRegistryItem.iconPath as ThemeIcon).id, IconNames.SCHEMA_REGISTRY);

    // check the Direct SR quickpick item
    const directRegistryItem: QuickPickItemWithValue<SchemaRegistry> | undefined =
      quickPickItems.find(
        (item) =>
          item.kind !== QuickPickItemKind.Separator &&
          item.value?.connectionType === ConnectionType.Direct,
      );
    assert.ok(directRegistryItem);
    assert.strictEqual(directRegistryItem.value, TEST_DIRECT_SCHEMA_REGISTRY);
    assert.strictEqual(directRegistryItem.label, TEST_DIRECT_ENVIRONMENT.name);
    assert.strictEqual(directRegistryItem.description, TEST_DIRECT_SCHEMA_REGISTRY.id);
    assert.strictEqual((directRegistryItem.iconPath as ThemeIcon).id, IconNames.SCHEMA_REGISTRY);
  });

  it(`should mark the focused schema registry with "${IconNames.CURRENT_RESOURCE} icon`, async function () {
    // simulate the CCloud SR being focused in the Schemas view
    schemasViewProvider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

    await schemaRegistryQuickPick();

    const quickPickItems: QuickPickItemWithValue<SchemaRegistry>[] =
      showQuickPickStub.firstCall.args[0];
    const focusedRegistryItem: QuickPickItemWithValue<SchemaRegistry> | undefined =
      quickPickItems.find(
        (item) =>
          item.kind !== QuickPickItemKind.Separator &&
          item.value?.id === TEST_CCLOUD_SCHEMA_REGISTRY.id,
      );

    assert.ok(focusedRegistryItem);
    assert.strictEqual((focusedRegistryItem.iconPath as ThemeIcon).id, IconNames.CURRENT_RESOURCE);
  });

  it("should order the focused schema registry first", async function () {
    // simulate the CCloud SR being focused in the Schemas view
    schemasViewProvider.schemaRegistry = TEST_DIRECT_SCHEMA_REGISTRY;

    await schemaRegistryQuickPick();

    const quickPickItems: QuickPickItemWithValue<SchemaRegistry>[] =
      showQuickPickStub.firstCall.args[0];
    // filter out the separators from the quickpick items
    const nonSeparatorItems = quickPickItems.filter(
      (item) => item.kind !== QuickPickItemKind.Separator,
    );
    // first item should be the default registry
    assert.strictEqual(nonSeparatorItems[0].value?.id, TEST_DIRECT_SCHEMA_REGISTRY.id);
  });

  it("should return the selected schema registry", async function () {
    showQuickPickStub.resolves({
      label: TEST_LOCAL_SCHEMA_REGISTRY.name,
      value: TEST_LOCAL_SCHEMA_REGISTRY,
    });

    const result = await schemaRegistryQuickPick();

    assert.strictEqual(result, TEST_LOCAL_SCHEMA_REGISTRY);
  });

  it("should return undefined if no schema registry is selected", async function () {
    // user cancels the quickpick
    showQuickPickStub.resolves(undefined);

    const result = await schemaRegistryQuickPick();

    assert.strictEqual(result, undefined);
  });

  it("should mark the defaultRegistryId with 'Default' detail when provided", async function () {
    await schemaRegistryQuickPick(TEST_CCLOUD_SCHEMA_REGISTRY.id);

    const quickPickItems: QuickPickItemWithValue<SchemaRegistry>[] =
      showQuickPickStub.firstCall.args[0];
    const defaultRegistryItem = quickPickItems.find(
      (item) =>
        item.kind !== QuickPickItemKind.Separator &&
        item.value?.id === TEST_CCLOUD_SCHEMA_REGISTRY.id,
    );

    assert.ok(defaultRegistryItem, "Should find the default schema registry item");
    assert.strictEqual(defaultRegistryItem.detail, "Default");
  });

  it("should include title in quickpick options when provided", async function () {
    const testTitle = "Select a Schema Registry for this action";
    await schemaRegistryQuickPick(undefined, testTitle);

    sinon.assert.calledOnce(showQuickPickStub);
    const options = showQuickPickStub.firstCall.args[1];
    assert.strictEqual(options.title, testTitle);
  });

  it("should skip the quickpick and show an info notification when no schema registries are found", async function () {
    // no schema registries available
    ccloudLoader.getSchemaRegistries.resolves([]);
    localLoader.getSchemaRegistries.resolves([]);
    directLoader.getSchemaRegistries.resolves([]);

    const result = await schemaRegistryQuickPick();

    assert.strictEqual(result, undefined);
    sinon.assert.calledOnce(showInfoStub);
    sinon.assert.calledWithMatch(showInfoStub, "No Schema Registries available.");
    sinon.assert.notCalled(showQuickPickStub);
  });

  it("should provide the correct buttons when no schema registries are found", async function () {
    // no schema registries available
    ccloudLoader.getSchemaRegistries.resolves([]);
    localLoader.getSchemaRegistries.resolves([]);
    directLoader.getSchemaRegistries.resolves([]);
    // and CCloud/local resources are not available in general
    getContextValueStub
      .withArgs(contextValues.ContextValues.ccloudConnectionAvailable)
      .returns(false);
    getContextValueStub
      .withArgs(contextValues.ContextValues.localSchemaRegistryAvailable)
      .returns(false);

    await schemaRegistryQuickPick();

    sinon.assert.calledWithMatch(
      showInfoStub,
      "No Schema Registries available.",
      CCLOUD_SIGN_IN_BUTTON_LABEL,
      "Start Local Resources",
    );
  });

  it(`should execute the command when the '${CCLOUD_SIGN_IN_BUTTON_LABEL}' button is clicked`, async function () {
    // no schema registries available
    ccloudLoader.getSchemaRegistries.resolves([]);
    localLoader.getSchemaRegistries.resolves([]);
    directLoader.getSchemaRegistries.resolves([]);
    // and there isn't any CCloud connection available
    getContextValueStub
      .withArgs(contextValues.ContextValues.ccloudConnectionAvailable)
      .returns(false);
    // simulate user clicking the "Sign In" button
    showInfoStub.resolves(CCLOUD_SIGN_IN_BUTTON_LABEL);

    await schemaRegistryQuickPick();

    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledWithExactly(executeCommandStub, "confluent.connections.ccloud.signIn");
  });

  it("should execute the startLocalResources command when the 'Start Local Resources' button is clicked", async function () {
    // no schema registries available
    ccloudLoader.getSchemaRegistries.resolves([]);
    localLoader.getSchemaRegistries.resolves([]);
    directLoader.getSchemaRegistries.resolves([]);
    // and there isn't any local resources available
    getContextValueStub
      .withArgs(contextValues.ContextValues.localSchemaRegistryAvailable)
      .returns(false);
    // simulate user clicking the "Start Local Resources" button
    showInfoStub.resolves("Start Local Resources");

    await schemaRegistryQuickPick();

    sinon.assert.calledOnce(executeCommandStub);
    sinon.assert.calledWithExactly(executeCommandStub, "confluent.docker.startLocalResources");
  });
});
