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
import { SchemaVersionChangeEvent, SubjectChangeEvent } from "../emitters";
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
      `Showing ${provider.searchMatches.size} of ${provider.totalItemCount} for "${TEST_CCLOUD_SCHEMA.subject}"`,
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
      `Showing ${provider.searchMatches.size} of ${provider.totalItemCount} for "${searchStr}"`,
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

describe("SchemasViewProvider event handlers", () => {
  let provider: SchemasViewProvider;
  let sandbox: sinon.SinonSandbox;
  let clock: sinon.SinonFakeTimers;
  let resetStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    clock = sandbox.useFakeTimers(Date.now());

    provider = new SchemasViewProvider();
    resetStub = sandbox.stub(provider, "reset");
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("environmentChangedHandler", () => {
    it("Firing environmentChanged + deleted should call reset()", async () => {
      const resetFake = sandbox.fake();
      sandbox.replace(provider, "reset", resetFake);

      // Be set to a SR within the environment being deleted
      provider.schemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;

      // simulate firing the event
      provider.environmentChangedHandler({ id: TEST_LOCAL_ENVIRONMENT_ID, wasDeleted: true });

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

      // simulate firing the event
      provider.environmentChangedHandler({ id: TEST_LOCAL_ENVIRONMENT_ID, wasDeleted: false });

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

        // Call the event handler against some other environment.
        provider.environmentChangedHandler({
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

  describe("ccloudConnectedHandler", () => {
    for (const connected of [true, false]) {
      it(`does nothing if no registry set, connected: ${connected}`, async () => {
        provider.schemaRegistry = null;

        // Call the handler with true or false, should not matter.
        await provider.ccloudConnectedHandler(connected);

        // Should not have called .reset()
        assert.ok(resetStub.notCalled);
      });

      it(`Should not reset if not viewing a CCloud schema registry, connected: ${connected}`, async () => {
        provider.schemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;

        // Call the handler with true or false, should not matter.
        await provider.ccloudConnectedHandler(true);

        // Should not have called .reset()
        assert.ok(resetStub.notCalled);
      });

      it(`Should reset if viewing a CCloud schema registry and connected state changes, connected: ${connected}`, async () => {
        provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

        // Call the handler with true or false, should not matter.
        await provider.ccloudConnectedHandler(connected);

        // Should have called .reset()
        assert.ok(resetStub.calledOnce);
      });
    }
  });

  describe("localSchemaRegistryConnectedHandler", () => {
    for (const connected of [true, false]) {
      it(`does nothing if no registry set, connected: ${connected}`, async () => {
        provider.schemaRegistry = null;

        // Call the handler with true or false, should not matter.
        await provider.localSchemaRegistryConnectedHandler(connected);

        // Should not have called .reset()
        assert.ok(resetStub.notCalled);
      });

      it(`Should not reset if not viewing a local schema registry, connected: ${connected}`, async () => {
        provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

        // Call the handler with true or false, should not matter.
        await provider.localSchemaRegistryConnectedHandler(true);

        // Should not have called .reset()
        assert.ok(resetStub.notCalled);
      });

      it(`Should reset if viewing a local schema registry and connected state changes, connected: ${connected}`, async () => {
        provider.schemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;

        // Call the handler with true or false, should not matter.
        await provider.localSchemaRegistryConnectedHandler(connected);

        // Should have called .reset()
        assert.ok(resetStub.calledOnce);
      });
    }
  });

  describe("currentSchemaRegistryChangedHandler", () => {
    for (const newRegistry of [null, TEST_LOCAL_SCHEMA_REGISTRY]) {
      it(`should call setSchemaRegistry() with new registry: ${newRegistry?.id}`, async () => {
        const setSchemaRegistryStub = sandbox.stub(provider, "setSchemaRegistry");

        // Call the handler with the new registry
        await provider.currentSchemaRegistryChangedHandler(newRegistry);

        // Should have called .setSchemaRegistry() with the new registry
        assert.ok(setSchemaRegistryStub.calledOnce);
        assert.ok(setSchemaRegistryStub.calledWith(newRegistry));
      });
    }
  });

  describe("schemaSearchSetHandler", () => {
    let setSearchStub: sinon.SinonStub;
    let refreshStub: sinon.SinonStub;

    beforeEach(() => {
      setSearchStub = sandbox.stub(provider, "setSearch");
      refreshStub = sandbox.stub(provider, "refresh");
    });

    for (const maybeSearchString of ["foo", null]) {
      it(`should call setSearch() with search string: ${maybeSearchString}`, async () => {
        // Call the handler with the search string
        await provider.schemaSearchSetHandler(maybeSearchString);

        assert.strictEqual(
          provider.searchStringSetCount,
          maybeSearchString === null ? 0 : 1,
          "setSearchStringCount should have been incremented if search string is not null",
        );

        // Should have called .setSearch() with the search string
        sinon.assert.calledOnce(setSearchStub);
        sinon.assert.calledWith(setSearchStub, maybeSearchString);
        // ... and refresh()
        sinon.assert.calledOnce(refreshStub);
      });
    }
  });

  describe("schemaSubjectChangedHandler", () => {
    let refreshStub: sinon.SinonStub;
    let subjectsInTreeView: Map<string, Subject>;

    beforeEach(() => {
      refreshStub = sandbox.stub(provider, "refresh");
      subjectsInTreeView = provider["subjectsInTreeView"];
      subjectsInTreeView.clear();
    });

    it("should call refresh() when subject is deleted", async () => {
      // set to be viewing a schema registry
      provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

      // and this subject is in the map
      subjectsInTreeView.set(TEST_CCLOUD_SUBJECT.name, TEST_CCLOUD_SUBJECT);

      const event: SubjectChangeEvent = {
        subject: TEST_CCLOUD_SUBJECT,
        change: "deleted",
      };
      await provider.schemaSubjectChangedHandler(event);

      // Should have removed from the map
      assert.strictEqual(subjectsInTreeView.size, 0);

      // Should have called .refresh()
      assert.ok(refreshStub.calledOnce);
    });

    it("should call refresh() when subject is added", async () => {
      // set to be viewing a schema registry
      provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

      // and this subject is in the map
      subjectsInTreeView.set(TEST_CCLOUD_SUBJECT.name, TEST_CCLOUD_SUBJECT);

      const event: SubjectChangeEvent = {
        subject: TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
        change: "added",
      };
      await provider.schemaSubjectChangedHandler(event);

      // Should have added to the map
      assert.strictEqual(subjectsInTreeView.size, 1);
      assert.deepStrictEqual(
        subjectsInTreeView.get(TEST_CCLOUD_SUBJECT.name),
        TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
      );

      // Should have called .refresh()
      assert.ok(refreshStub.calledOnce);
    });

    it("Does nothing if not viewing a schema registry", async () => {
      // set to be viewing no schema registry
      provider.schemaRegistry = null;

      const event: SubjectChangeEvent = {
        subject: TEST_CCLOUD_SUBJECT,
        change: "deleted",
      };
      await provider.schemaSubjectChangedHandler(event);

      // Should not have called .refresh()
      assert.ok(refreshStub.notCalled);
    });

    it("Does nothing if viewing a different schema registry", async () => {
      // set to be viewing a different schema registry
      provider.schemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;

      const event: SubjectChangeEvent = {
        subject: TEST_CCLOUD_SUBJECT,
        change: "deleted",
      };
      await provider.schemaSubjectChangedHandler(event);

      // Should not have called .refresh()
      assert.ok(refreshStub.notCalled);
    });
  });

  describe("schemaVersionsChangedHandler", () => {
    let onDidChangeTreeDataFireStub: sinon.SinonStub;
    let subjectsInTreeView: Map<string, Subject>;

    beforeEach(() => {
      onDidChangeTreeDataFireStub = sandbox.stub(provider["_onDidChangeTreeData"], "fire");
      subjectsInTreeView = provider["subjectsInTreeView"];
    });

    it("should update subject in map and fire event when schema version added", async () => {
      // set to be viewing a schema registry
      provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

      const scratchSubject = TEST_CCLOUD_SCHEMA.subjectObject();
      scratchSubject.schemas = null;

      // and this subject is in the map and has no loaded schemas
      subjectsInTreeView.set(scratchSubject.name, scratchSubject);

      const updatedSubject = TEST_CCLOUD_SUBJECT_WITH_SCHEMAS;

      const event: SchemaVersionChangeEvent = {
        subject: updatedSubject,
        change: "added",
      };
      await provider.schemaVersionsChangedHandler(event);

      // Should have reset the schemas in the subject in the map
      assert.strictEqual(subjectsInTreeView.size, 1);
      const subjectFromMap = subjectsInTreeView.get(scratchSubject.name);
      assert.strictEqual(subjectFromMap, scratchSubject);
      assert.deepEqual(subjectFromMap.schemas, updatedSubject.schemas);

      // Should have fired with the subject
      assert.ok(onDidChangeTreeDataFireStub.calledOnce);
      assert.ok(onDidChangeTreeDataFireStub.calledWith(scratchSubject));
    });

    it("Does nothing if not viewing a schema registry", async () => {
      // set to be viewing no schema registry
      provider.schemaRegistry = null;

      const event: SchemaVersionChangeEvent = {
        subject: TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
        change: "deleted",
      };
      await provider.schemaVersionsChangedHandler(event);

      // Should not have called .refresh()
      assert.ok(onDidChangeTreeDataFireStub.notCalled);
    });

    it("Does nothing if viewing a different schema registry", async () => {
      // set to be viewing a different schema registry
      provider.schemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;

      const event: SchemaVersionChangeEvent = {
        subject: TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
        change: "deleted",
      };
      await provider.schemaVersionsChangedHandler(event);

      // Should not have called .refresh()
      assert.ok(onDidChangeTreeDataFireStub.notCalled);
    });

    it("Does nothing if subject not in map", async () => {
      // set to be viewing a schema registry
      provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

      const event: SchemaVersionChangeEvent = {
        subject: TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
        change: "deleted",
      };
      await provider.schemaVersionsChangedHandler(event);

      // Should not have called .refresh() or changed the map
      assert.ok(onDidChangeTreeDataFireStub.notCalled);
      assert.strictEqual(subjectsInTreeView.size, 0);
    });
  });
});
