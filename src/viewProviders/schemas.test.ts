import * as assert from "assert";
import * as sinon from "sinon";
import {
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_CCLOUD_SUBJECT,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
} from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { schemaSearchSet } from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { Schema, SchemaTreeItem, Subject, SubjectTreeItem } from "../models/schema";
import { SchemasViewProvider } from "./schemas";
import { SEARCH_DECORATION_URI_SCHEME } from "./search";

describe("SchemasViewProvider methods", () => {
  let provider: SchemasViewProvider;

  before(async () => {
    await getTestExtensionContext();
    provider = SchemasViewProvider.getInstance();
  });

  it("getTreeItem() should return a SchemaTreeItem for a Schema instance", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_SCHEMA);
    assert.ok(treeItem instanceof SchemaTreeItem);
  });

  it("getTreeItem() should return a SubjectTreeItem for a Subject instance w/o schemas", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_SUBJECT);
    assert.ok(treeItem instanceof SubjectTreeItem);
  });

  it("getTreeItem() should return a SubjectTreeItem for a Subject instance with schemas", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_SUBJECT_WITH_SCHEMAS);
    assert.ok(treeItem instanceof SubjectTreeItem);
  });
});

describe("SchemasViewProvider search behavior", () => {
  let provider: SchemasViewProvider;
  let ccloudLoader: CCloudResourceLoader;

  let sandbox: sinon.SinonSandbox;

  const TEST_CCLOUD_SUBJECT2 = Schema.create({
    ...TEST_CCLOUD_SCHEMA,
    subject: "foo-value",
    id: "100123",
  }).subjectObject();

  const TEST_CCLOUD_SUBJECT3 = Schema.create({
    ...TEST_CCLOUD_SCHEMA,
    subject: "bar-key",
    id: "100456",
  }).subjectObject();

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    // stub loader method for fetching schemas
    ccloudLoader = CCloudResourceLoader.getInstance();
    sandbox
      .stub(ccloudLoader, "getSubjects")
      // three sample schema versions across three subjects
      .resolves([TEST_CCLOUD_SUBJECT, TEST_CCLOUD_SUBJECT2, TEST_CCLOUD_SUBJECT3]);

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
    assert.ok(rootElements[0] instanceof Subject);
    assert.strictEqual((rootElements[0] as Subject).name, TEST_CCLOUD_SCHEMA.subject);
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
});
