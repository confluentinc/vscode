import * as assert from "assert";
import sinon from "sinon";
import {
  TEST_CCLOUD_ENVIRONMENT_ID,
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_CCLOUD_SUBJECT,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
  TEST_LOCAL_ENVIRONMENT_ID,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { ContextValues, getContextValue } from "../context/values";
import {
  currentSchemaRegistryChanged,
  environmentChanged,
  schemaSearchSet,
  schemaSubjectChanged,
  SchemaVersionChangeEvent,
  schemaVersionsChanged,
  SubjectChangeEvent,
} from "../emitters";
import { Schema, SchemaTreeItem, Subject, SubjectTreeItem } from "../models/schema";
import { SchemasViewProvider } from "./schemas";
import { SEARCH_DECORATION_URI_SCHEME } from "./search";

describe("SchemasViewProvider getTreeItem()", () => {
  let provider: SchemasViewProvider;

  before(async () => {
    await getTestExtensionContext();
    provider = SchemasViewProvider.getInstance();
  });

  it("Should return a SchemaTreeItem for a Schema instance", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_SCHEMA);
    assert.ok(treeItem instanceof SchemaTreeItem);
  });

  it("Should return a SubjectTreeItem for a Subject instance w/o schemas", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_SUBJECT);
    assert.ok(treeItem instanceof SubjectTreeItem);
  });

  it("Should return a SubjectTreeItem for a Subject instance with schemas", () => {
    const treeItem = provider.getTreeItem(TEST_CCLOUD_SUBJECT_WITH_SCHEMAS);
    assert.ok(treeItem instanceof SubjectTreeItem);
  });
});

describe("SchemasViewProvider setSchemaRegistry()", () => {
  let provider: SchemasViewProvider;
  let sandbox: sinon.SinonSandbox;

  before(async () => {
    await getTestExtensionContext();
    provider = SchemasViewProvider.getInstance();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("Should do nothing if already set to the same registry", async () => {
    const setSearchSpy = sandbox.spy(provider, "setSearch");
    const refreshSpy = sandbox.spy(provider, "refresh");
    const updateTreeViewDescriptionSpy = sandbox.spy(provider, "updateTreeViewDescription");

    for (const registry of [null, TEST_LOCAL_SCHEMA_REGISTRY]) {
      provider.schemaRegistry = registry;

      await provider.setSchemaRegistry(registry);
      assert.strictEqual(provider.schemaRegistry, registry);

      // Should have short circuited and not called .setSearch() or .refresh()
      assert.ok(setSearchSpy.notCalled);
      assert.ok(refreshSpy.notCalled);
      assert.ok(updateTreeViewDescriptionSpy.notCalled);
    }
  });

  it("Should set the schema registry and other effects when setting to new SR or null", async () => {
    const setSearchFake = sandbox.fake();
    const refreshFake = sandbox.fake();
    const updateTreeViewDescriptionFake = sandbox.fake();

    sandbox.replace(provider, "setSearch", setSearchFake);
    sandbox.replace(provider, "refresh", refreshFake);
    sandbox.replace(provider, "updateTreeViewDescription", updateTreeViewDescriptionFake);

    for (const newRegistry of [null, TEST_LOCAL_SCHEMA_REGISTRY]) {
      console.log("setSchemaRegistry subtest start");
      // initially have a different registry / different env.
      provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

      await provider.setSchemaRegistry(newRegistry);

      assert.strictEqual(provider.schemaRegistry, newRegistry);

      assert.ok(setSearchFake.calledWith(null));
      assert.ok(refreshFake.calledOnce);
      assert.ok(updateTreeViewDescriptionFake.calledOnce);
      assert.equal(
        await getContextValue(ContextValues.schemaRegistrySelected),
        newRegistry !== null,
      );

      // reset fakes for next iteration (if any)
      setSearchFake.resetHistory();
      refreshFake.resetHistory();
      updateTreeViewDescriptionFake.resetHistory();
    }
  });

  it("Firing currentSchemaRegistryChanged should call setSchemaRegistry()", () => {
    const setSchemaRegistryFake = sandbox.fake();
    sandbox.replace(provider, "setSchemaRegistry", setSchemaRegistryFake);
    for (const newRegistry of [null, TEST_LOCAL_SCHEMA_REGISTRY]) {
      setSchemaRegistryFake.resetHistory();

      // fire the event
      currentSchemaRegistryChanged.fire(newRegistry);

      // Should have called .setSchemaRegistry() with the new registry
      assert.ok(setSchemaRegistryFake.calledOnce);
      assert.ok(setSchemaRegistryFake.calledWith(newRegistry));
    }
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

describe("SchemasViewProvider schemaSubjectChanged event", () => {
  let provider: SchemasViewProvider;
  let sandbox: sinon.SinonSandbox;
  let refreshStub: sinon.SinonSpy<any[], any>;
  let subjectsInTreeView: Map<string, Subject>;

  before(async () => {
    await getTestExtensionContext();
    provider = SchemasViewProvider.getInstance();
  });
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    refreshStub = sandbox.stub().returns(undefined);
    sandbox.replace(provider, "refresh", refreshStub);

    subjectsInTreeView = provider["subjectsInTreeView"];
    subjectsInTreeView.clear();
  });
  afterEach(() => {
    sandbox.restore();
  });

  it("Not viewing same schema registry, should not call anything", () => {
    // set to be viewing no schema registry
    provider.schemaRegistry = null;

    const event: SubjectChangeEvent = {
      subject: TEST_CCLOUD_SUBJECT,
      change: "deleted",
    };
    schemaSubjectChanged.fire(event);

    // Should not have called .refresh()
    assert.ok(refreshStub.notCalled);
  });

  it("Viewing same schema registry, when schema deleted, should remove from map + call reset()", () => {
    // set to be viewing a schema registry
    provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

    // and this subject is in the map
    subjectsInTreeView.set(TEST_CCLOUD_SUBJECT.name, TEST_CCLOUD_SUBJECT);

    const event: SubjectChangeEvent = {
      subject: TEST_CCLOUD_SUBJECT,
      change: "deleted",
    };
    schemaSubjectChanged.fire(event);

    // Should have removed from the map
    assert.strictEqual(subjectsInTreeView.size, 0);

    // Should have called .refresh()
    assert.ok(refreshStub.calledOnce);
  });

  it("Viewing same schema registry, when schema added, should add to map + call refresh()", () => {
    // set to be viewing a schema registry
    provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

    // and this subject is in the map
    subjectsInTreeView.set(TEST_CCLOUD_SUBJECT.name, TEST_CCLOUD_SUBJECT);

    const event: SubjectChangeEvent = {
      subject: TEST_CCLOUD_SUBJECT,
      change: "added",
    };
    schemaSubjectChanged.fire(event);

    // Should have added to the map
    assert.strictEqual(subjectsInTreeView.size, 1);
    assert.strictEqual(subjectsInTreeView.get(TEST_CCLOUD_SUBJECT.name), TEST_CCLOUD_SUBJECT);

    // Should have called .refresh()
    assert.ok(refreshStub.calledOnce);
  });
});

describe("SchemasViewProvider schemaVersionsChanged event", () => {
  let provider: SchemasViewProvider;
  let sandbox: sinon.SinonSandbox;
  let onDidChangeTreeDataFireStub: sinon.SinonSpy<any[], any>;
  let subjectsInTreeView: Map<string, Subject>;

  before(async () => {
    await getTestExtensionContext();
    provider = SchemasViewProvider.getInstance();
  });
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    onDidChangeTreeDataFireStub = sandbox.stub(provider["_onDidChangeTreeData"], "fire");

    subjectsInTreeView = provider["subjectsInTreeView"];
    subjectsInTreeView.clear();
  });
  afterEach(() => {
    sandbox.restore();
  });

  it("Not viewing same schema registry, should not call anything", () => {
    // set to be viewing no schema registry
    provider.schemaRegistry = null;

    const event: SchemaVersionChangeEvent = {
      schema: TEST_CCLOUD_SCHEMA,
      change: "deleted",
    };
    schemaVersionsChanged.fire(event);

    // Should not have called .refresh()
    assert.ok(onDidChangeTreeDataFireStub.notCalled);
  });

  for (const changeType of ["added", "deleted"] as ("added" | "deleted")[]) {
    it(`Viewing same schema registry, when schema ${changeType}, should remove from map + call refresh()`, () => {
      // set to be viewing a schema registry
      provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

      const scratchSubject = TEST_CCLOUD_SCHEMA.subjectObject();
      scratchSubject.schemas = [TEST_CCLOUD_SCHEMA];

      // and this subject is in the map and has loaded schemas
      subjectsInTreeView.set(scratchSubject.name, scratchSubject);

      const event: SchemaVersionChangeEvent = {
        schema: TEST_CCLOUD_SCHEMA,
        change: changeType,
      };
      schemaVersionsChanged.fire(event);

      // Should have reset the schemas in the subject in the map
      // to null
      assert.strictEqual(subjectsInTreeView.size, 1);
      const subjectFromMap = subjectsInTreeView.get(scratchSubject.name);
      assert.strictEqual(subjectFromMap, scratchSubject);
      assert.strictEqual(subjectFromMap.schemas, null);

      // Should have fired with the subject
      assert.ok(onDidChangeTreeDataFireStub.calledOnce);
      assert.ok(onDidChangeTreeDataFireStub.calledWith(scratchSubject));
    });

    it(`Viewing same schema registry, subject in map but no loaded schemas, when schema ${changeType} then no change`, () => {
      // set to be viewing a schema registry
      provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

      const scratchSubject = TEST_CCLOUD_SCHEMA.subjectObject();
      scratchSubject.schemas = null;

      // and this subject is in the map and has no loaded schemas
      subjectsInTreeView.set(scratchSubject.name, scratchSubject);

      const event: SchemaVersionChangeEvent = {
        schema: TEST_CCLOUD_SCHEMA,
        change: changeType,
      };
      schemaVersionsChanged.fire(event);

      // Should not have changed the subject in the map or fired event.
      assert.strictEqual(subjectsInTreeView.size, 1);
      const subjectFromMap = subjectsInTreeView.get(scratchSubject.name);
      assert.strictEqual(subjectFromMap, scratchSubject);
      assert.strictEqual(subjectFromMap.schemas, null);

      // Should not have fired anything
      assert.ok(onDidChangeTreeDataFireStub.notCalled);
    });
  }
});

describe("SchemasViewProvider environmentChanged handler", () => {
  let provider: SchemasViewProvider;
  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;

  before(async () => {
    await getTestExtensionContext();
    provider = SchemasViewProvider.getInstance();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers(Date.now());
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("Firing environmentChanged + deleted should call reset()", async () => {
    const resetFake = sandbox.fake();
    sandbox.replace(provider, "reset", resetFake);

    // Be set to a SR within the environment being deleted
    provider.schemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;
    // fire the event
    environmentChanged.fire({ id: TEST_LOCAL_ENVIRONMENT_ID, wasDeleted: true });

    // Should have called .reset()
    assert.ok(resetFake.calledOnce);
  });

  it("Firing environmentChanged + misc change should not call reset(), should call updateTreeViewDescription + refresh", async () => {
    const resetFake = sandbox.fake();
    const updateTreeViewDescriptionFake = sandbox.fake();
    const refreshFake = sandbox.fake();

    sandbox.replace(provider, "reset", resetFake);
    sandbox.replace(provider, "updateTreeViewDescription", updateTreeViewDescriptionFake);
    sandbox.replace(provider, "refresh", refreshFake);

    // Be set to a SR within the environment being deleted
    provider.schemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;
    // fire the event
    environmentChanged.fire({ id: TEST_LOCAL_ENVIRONMENT_ID, wasDeleted: false });

    // Need to pause an iota to get the refresh to be called, is after first await in the block.
    await clock.tickAsync(100);

    assert.ok(resetFake.notCalled);
    assert.ok(updateTreeViewDescriptionFake.calledOnce);
    assert.ok(refreshFake.calledOnce);
  });

  for (const currentRegistry of [TEST_LOCAL_SCHEMA_REGISTRY, null]) {
    it(`Firing environmentChanged when SR set a ${currentRegistry?.environmentId} environment SR and event is for other env should do nothing`, () => {
      const resetFake = sandbox.fake();
      const updateTreeViewDescriptionFake = sandbox.fake();
      const refreshFake = sandbox.fake();

      sandbox.replace(provider, "reset", resetFake);
      sandbox.replace(provider, "updateTreeViewDescription", updateTreeViewDescriptionFake);
      sandbox.replace(provider, "refresh", refreshFake);

      // Be set to a SR NOT within the environment being updated, or null.
      provider.schemaRegistry = currentRegistry;

      // fire the event against some other environment.
      environmentChanged.fire({
        id: TEST_CCLOUD_ENVIRONMENT_ID,
        wasDeleted: false,
      });

      // Should not have called any of these
      assert.ok(resetFake.notCalled);
      assert.ok(updateTreeViewDescriptionFake.notCalled);
      assert.ok(refreshFake.notCalled);
    });
  }
});
