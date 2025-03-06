import * as assert from "assert";
import sinon from "sinon";
import {
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_CCLOUD_SUBJECT,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { schemaSearchSet } from "../emitters";
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
    provider = SchemasViewProvider.getInstance();

    // wire up the initial test data subjects.
    const fakeSubjectMap: Map<string, Subject> = new Map();
    fakeSubjectMap.set(TEST_CCLOUD_SUBJECT.name, TEST_CCLOUD_SUBJECT);
    fakeSubjectMap.set(TEST_CCLOUD_SUBJECT2.name, TEST_CCLOUD_SUBJECT2);
    fakeSubjectMap.set(TEST_CCLOUD_SUBJECT3.name, TEST_CCLOUD_SUBJECT3);

    // rewrite private map with fixed value
    provider["subjectsInTreeView"] = fakeSubjectMap;

    provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;
  });

  afterEach(() => {
    SchemasViewProvider["instance"] = null;
  });

  it("getChildren() should filter root-level subjects based on search string", async () => {
    // First schema subject matches search
    provider.setSearch(TEST_CCLOUD_SCHEMA.subject);

    const rootElements = await provider.getChildren();

    assert.strictEqual(rootElements.length, 1, "should only return one subject");
    assert.ok(rootElements[0] instanceof Subject);
    assert.strictEqual((rootElements[0] as Subject).name, TEST_CCLOUD_SCHEMA.subject);

    assert.strictEqual(provider.totalItemCount, 3);
    assert.strictEqual(provider.searchMatches.size, 1);
    assert.strictEqual(
      provider["treeView"].message,
      `Showing ${provider.searchMatches.size} of ${provider.totalItemCount} results for "${TEST_CCLOUD_SCHEMA.subject}"`,
    );
  });

  it("getChildren() should show correct count in tree view message when items match search", async () => {
    // Search matching two subjects
    const searchStr = "-value";
    provider.setSearch("-value");

    await provider.getChildren();

    // three original subjects returned
    assert.strictEqual(provider.totalItemCount, 3);
    assert.strictEqual(provider.searchMatches.size, 2);
    assert.strictEqual(
      provider["treeView"].message,
      `Showing ${provider.searchMatches.size} of ${provider.totalItemCount} results for "${searchStr}"`,
    );
  });

  it("getChildren() should clear tree view message when search is cleared", async () => {
    // Search cleared
    provider.setSearch(null);

    await provider.getChildren();

    assert.strictEqual(provider.totalItemCount, 3);
    assert.strictEqual(provider.searchMatches.size, 0);
    assert.strictEqual(provider["treeView"].message, undefined);
  });

  it("getTreeItem() should set the resourceUri of subject containers that match the search string", async () => {
    // First schema subject matches search
    provider.setSearch(TEST_CCLOUD_SCHEMA.subject);

    const treeItem = provider.getTreeItem(TEST_CCLOUD_SUBJECT);

    assert.ok(treeItem.resourceUri);
    assert.strictEqual(treeItem.resourceUri?.scheme, SEARCH_DECORATION_URI_SCHEME);
  });

  it("Prove that schemaSearchSet.fire() calls setSearch() and then refresh()", () => {
    const setSearchSpy = sinon.spy(provider, "setSearch");
    const refreshSpy = sinon.spy(provider, "refresh");

    schemaSearchSet.fire("foo");

    assert.ok(setSearchSpy.calledOnce);
    assert.ok(setSearchSpy.calledWith("foo"));

    assert.ok(refreshSpy.calledOnce);
  });

  it("isFocusedOnCCloud() should return true when the current schema registry is a CCloud one", () => {
    const isFocused = provider.isFocusedOnCCloud();
    assert.strictEqual(isFocused, true);
  });

  it("isFocusedOnCCloud() should return false when the current schema registry is not ccloud", () => {
    provider.schemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;
    const isFocused = provider.isFocusedOnCCloud();
    assert.strictEqual(isFocused, false);
  });

  it("isFocusedOnCCloud() should return false when the current schema registry is null", () => {
    provider.schemaRegistry = null;
    const isFocused = provider.isFocusedOnCCloud();
    assert.strictEqual(isFocused, false);
  });
});
