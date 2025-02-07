import * as assert from "assert";
import * as sinon from "sinon";
import {
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_CCLOUD_SUBJECT,
} from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { schemaSearchSet } from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { ContainerTreeItem } from "../models/main";
import { Schema, SchemaTreeItem, SubjectTreeItem } from "../models/schema";
import { SchemasViewProvider } from "./schemas";
import { SEARCH_DECORATION_URI_SCHEME } from "./search";

describe("SchemasViewProvider methods", () => {
  let provider: SchemasViewProvider;

  before(() => {
    provider = SchemasViewProvider.getInstance();
  });

  it("getTreeItem() should return a SchemaTreeItem for a Schema instance", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_SCHEMA);
    assert.ok(treeItem instanceof SchemaTreeItem);
  });

  it("getTreeItem() should return a SubjectTreeItem for a Subject instance", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_SUBJECT);
    assert.ok(treeItem instanceof SubjectTreeItem);
  });
});

describe("SchemasViewProvider search behavior", () => {
  let provider: SchemasViewProvider;
  let ccloudLoader: CCloudResourceLoader;

  let sandbox: sinon.SinonSandbox;

  const TEST_CCLOUD_SCHEMA2 = Schema.create({
    ...TEST_CCLOUD_SCHEMA,
    subject: "foo-value",
    id: "100123",
  });
  const TEST_CCLOUD_SCHEMA3 = Schema.create({
    ...TEST_CCLOUD_SCHEMA,
    subject: "bar-key",
    id: "100456",
  });

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // stub loader method for fetching schemas
    ccloudLoader = CCloudResourceLoader.getInstance();
    sandbox
      .stub(ccloudLoader, "getSchemasForRegistry")
      // three sample schema versions across three subjects
      .resolves([TEST_CCLOUD_SCHEMA, TEST_CCLOUD_SCHEMA2, TEST_CCLOUD_SCHEMA3]);

    provider = SchemasViewProvider.getInstance();
    provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;
  });

  afterEach(() => {
    SchemasViewProvider["instance"] = null;
    sandbox.restore();
  });

  it("getChildren() should filter root-level subjects based on search string", async () => {
    // First schema subject matches search
    schemaSearchSet.fire(TEST_CCLOUD_SCHEMA.subject);

    const rootElements = await provider.getChildren();

    assert.strictEqual(rootElements.length, 1);
    assert.ok(rootElements[0] instanceof ContainerTreeItem);
    assert.strictEqual(
      (rootElements[0] as ContainerTreeItem<Schema>).label,
      TEST_CCLOUD_SCHEMA.subject,
    );
  });

  it("getChildren() should return all schemas if parent subject matches search", async () => {
    // Parent subject matches search
    schemaSearchSet.fire(TEST_CCLOUD_SCHEMA.subject);

    const rootElements = await provider.getChildren();

    assert.strictEqual(rootElements.length, 1);
    assert.ok(rootElements[0] instanceof ContainerTreeItem);
    assert.strictEqual(
      (rootElements[0] as ContainerTreeItem<Schema>).label,
      TEST_CCLOUD_SCHEMA.subject,
    );

    // expand subject container to get child schemas
    const children = await provider.getChildren(rootElements[0]);

    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof Schema);
    assert.strictEqual(children[0].subject, TEST_CCLOUD_SCHEMA.subject);
  });

  it("getChildren() should show correct count in tree view message when items match search", async () => {
    // Search matching two subjects
    const searchStr = "-value";
    schemaSearchSet.fire("-value");

    await provider.getChildren();

    assert.strictEqual(provider["treeView"].message, `Showing 2 results for "${searchStr}"`);
  });

  it("getChildren() should clear tree view message when search is cleared", async () => {
    // Search cleared
    schemaSearchSet.fire(null);

    await provider.getChildren();

    assert.strictEqual(provider["treeView"].message, undefined);
  });

  it("getTreeItem() should set the resourceUri of subject containers that match the search string", async () => {
    // First schema subject matches search
    schemaSearchSet.fire(TEST_CCLOUD_SCHEMA.subject);

    const treeItem = provider.getTreeItem(TEST_CCLOUD_SUBJECT);

    assert.ok(treeItem.resourceUri);
    assert.strictEqual(treeItem.resourceUri?.scheme, SEARCH_DECORATION_URI_SCHEME);
  });

  // it("getTreeItem() should collapse items when children exist but don't match search", async () => {
  //   // Search for non-matching string
  //   schemaSearchSet.fire("non-matching-search");

  //   const container = new ContainerTreeItem<Schema>(
  //     TEST_CCLOUD_SCHEMA.subject,
  //     TreeItemCollapsibleState.Expanded,
  //     [TEST_CCLOUD_SCHEMA],
  //   );
  //   const treeItem = provider.getTreeItem(container);

  //   assert.strictEqual(treeItem.collapsibleState, TreeItemCollapsibleState.Collapsed);
  // });
});
