import * as assert from "assert";
import sinon from "sinon";
import { eventEmitterStubs, StubbedEventEmitters } from "../../tests/stubs/emitters";
import { getStubbedCCloudResourceLoader } from "../../tests/stubs/resourceLoaders";
import {
  TEST_CCLOUD_SCHEMA,
  TEST_CCLOUD_SCHEMA_REGISTRY,
  TEST_CCLOUD_SUBJECT,
  TEST_CCLOUD_SUBJECT_WITH_SCHEMAS,
  TEST_LOCAL_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { EnvironmentChangeEvent, SchemaVersionChangeEvent, SubjectChangeEvent } from "../emitters";
import { CCloudResourceLoader } from "../loaders";
import { EnvironmentId } from "../models/resource";
import { Schema, SchemaTreeItem, SchemaType, Subject, SubjectTreeItem } from "../models/schema";
import { SchemasViewProvider } from "./schemas";

describe("SchemasViewProvider", () => {
  let provider: SchemasViewProvider;
  let sandbox: sinon.SinonSandbox;
  let stubbedCCloudResourceLoader: sinon.SinonStubbedInstance<CCloudResourceLoader>;
  let onDidChangeTreeDataFireStub: sinon.SinonStub;
  let subjectsInTreeView: Map<string, Subject>;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    stubbedCCloudResourceLoader = getStubbedCCloudResourceLoader(sandbox);

    // Test using a detached instance.
    // want to have a fresh instance for each test.
    provider = new SchemasViewProvider();
    // Would be done if fetched through getInstance().
    provider["initialize"]();

    subjectsInTreeView = provider["subjectsInTreeView"];

    onDidChangeTreeDataFireStub = sandbox.stub(provider["_onDidChangeTreeData"], "fire");
  });

  afterEach(() => {
    provider.dispose();
    sandbox.restore();
  });

  describe("schemaRegistry property", () => {
    it("Should get / set the same value as the parent resource", () => {
      assert.strictEqual(provider.resource, null);

      provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;
      assert.strictEqual(provider.resource, TEST_CCLOUD_SCHEMA_REGISTRY);
      assert.strictEqual(provider.schemaRegistry, TEST_CCLOUD_SCHEMA_REGISTRY);
    });
  });

  describe("setSchemaRegistry()", () => {
    it("Should set the parent resource to the given schema registry", () => {
      assert.strictEqual(provider.resource, null);

      provider.setSchemaRegistry(TEST_CCLOUD_SCHEMA_REGISTRY);
      assert.strictEqual(provider.resource, TEST_CCLOUD_SCHEMA_REGISTRY);

      provider.setSchemaRegistry(null);
      assert.strictEqual(provider.resource, null);
    });
  });

  describe("refresh()", () => {
    beforeEach(() => {
      provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;
      // wire up the initial test data subjects.
      const fakeSubjectMap: Map<string, Subject> = new Map();
      fakeSubjectMap.set(TEST_CCLOUD_SUBJECT.name, TEST_CCLOUD_SUBJECT);
      // rewrite private map with fixed value
      provider["subjectsInTreeView"] = fakeSubjectMap;

      // And by default, returns no subjects.
      stubbedCCloudResourceLoader.getSubjects.resolves([]);
    });

    for (const deepRefresh of [true, false]) {
      it(`Should clear existing subjects in the tree view + honor deepRefresh: ${deepRefresh}`, async () => {
        await provider.refresh(deepRefresh);

        assert.strictEqual(provider["subjectsInTreeView"].size, 0);
        sinon.assert.calledOnce(stubbedCCloudResourceLoader.getSubjects);
        sinon.assert.calledWithExactly(
          stubbedCCloudResourceLoader.getSubjects,
          provider.schemaRegistry!,
          deepRefresh,
        );
      });
    }

    it("Should do nothing if no schema registry is set", async () => {
      provider.schemaRegistry = null;

      await provider.refresh();

      // Should not have called getSubjects()
      sinon.assert.notCalled(stubbedCCloudResourceLoader.getSubjects);
    });

    it("Should populate the tree view with fetched subjects", async () => {
      // Make the stub return a fixed list of subjects.
      stubbedCCloudResourceLoader.getSubjects.resolves([TEST_CCLOUD_SUBJECT]);

      await provider.refresh();

      // Should have called getSubjects()
      sinon.assert.calledOnce(stubbedCCloudResourceLoader.getSubjects);

      // Should have populated the map with the returned subject
      assert.strictEqual(provider["subjectsInTreeView"].size, 1);
      assert.deepStrictEqual(
        provider["subjectsInTreeView"].get(TEST_CCLOUD_SUBJECT.name),
        TEST_CCLOUD_SUBJECT,
      );
    });
  });

  describe("updateSubjectSchemas()", () => {
    it("Should update the schemas for the given subject in the tree view", async () => {
      // Add a subject to the map with no schemas
      const scratchSubject = TEST_CCLOUD_SCHEMA.subjectObject();
      scratchSubject.schemas = null;
      subjectsInTreeView.set(scratchSubject.name, scratchSubject);

      // Call updateSubjectSchemas() with a new schemas array
      await provider.updateSubjectSchemas(
        scratchSubject.name,
        TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.schemas,
      );

      // Should have updated the schemas in the subject in the map
      const updatedSubject = subjectsInTreeView.get(scratchSubject.name)!;
      assert.deepStrictEqual(updatedSubject.schemas, TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.schemas);

      // should have fired to repaint
      sinon.assert.calledOnce(onDidChangeTreeDataFireStub);
      sinon.assert.calledWithExactly(onDidChangeTreeDataFireStub, scratchSubject);
    });

    it("if provided with null for schemas, should deep fetch the schemas for the subject", async () => {
      // Add a subject to the map with no schemas
      const scratchSubject = TEST_CCLOUD_SCHEMA.subjectObject();
      subjectsInTreeView.set(scratchSubject.name, scratchSubject);

      provider.resource = TEST_CCLOUD_SCHEMA_REGISTRY;

      stubbedCCloudResourceLoader.getSchemasForSubject.resolves(
        TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.schemas,
      );

      await provider.updateSubjectSchemas(scratchSubject.name, null);

      // should have called the resource loader to fetch schemas for the subject
      sinon.assert.calledOnce(stubbedCCloudResourceLoader.getSchemasForSubject);

      // Should have updated the schemas in the subject in the map
      const updatedSubject = subjectsInTreeView.get(scratchSubject.name)!;
      assert.deepStrictEqual(updatedSubject.schemas, TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.schemas);
      // should have fired to repaint
      sinon.assert.calledOnce(onDidChangeTreeDataFireStub);
    });

    it("should do nothing if the subject is not in the tree view", async () => {
      // Call updateSubjectSchemas() with a new schemas array
      await provider.updateSubjectSchemas(
        TEST_CCLOUD_SUBJECT.name,
        TEST_CCLOUD_SUBJECT_WITH_SCHEMAS.schemas,
      );

      // Should not have called the resource loader
      sinon.assert.notCalled(stubbedCCloudResourceLoader.getSchemasForSubject);

      // Should not have fired to repaint
      sinon.assert.notCalled(onDidChangeTreeDataFireStub);
    });

    it("should raise error if asked to deep fetch schemas but no schema registry is set", async () => {
      provider.resource = null;

      // Call updateSubjectSchemas() with null schemas to force a deep fetch
      await assert.rejects(
        async () => {
          await provider.updateSubjectSchemas(TEST_CCLOUD_SUBJECT.name, null);
        },
        {
          name: "Error",
          message: "No schema registry",
        },
      );

      // Should not have called the resource loader
      sinon.assert.notCalled(stubbedCCloudResourceLoader.getSchemasForSubject);

      // Should not have fired to repaint
      sinon.assert.notCalled(onDidChangeTreeDataFireStub);
    });
  });

  describe("getTreeItem()", () => {
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

  describe("getParent()", () => {
    it("parent of a Subject should be null (they are root-level)", () => {
      const parent = provider.getParent(TEST_CCLOUD_SUBJECT);
      assert.strictEqual(parent, null);
    });

    it("should return null if given a subject not in the tree view", () => {
      const unknownSubject = Schema.create({
        ...TEST_CCLOUD_SCHEMA,
        subject: "unknown-subject",
        id: "99999",
      }).subjectObject();
      const parent = provider.getParent(unknownSubject);
      assert.strictEqual(parent, null);
    });

    it("parent of a Schema in the view should be its Subject", () => {
      // wire up the initial test data subjects.
      subjectsInTreeView.set(TEST_CCLOUD_SUBJECT.name, TEST_CCLOUD_SUBJECT);
      const parent = provider.getParent(TEST_CCLOUD_SCHEMA);
      assert.ok(parent instanceof Subject);
      assert.strictEqual(parent!.name, TEST_CCLOUD_SCHEMA.subject);
    });
  });

  describe("getChildren()", () => {
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

    // Give TEST_CCLOUD_SUBJECT3 a schemas
    TEST_CCLOUD_SUBJECT3.schemas = [
      Schema.create({
        id: "100457",
        subject: TEST_CCLOUD_SUBJECT3.name,
        version: 1,
        type: SchemaType.Avro,
        schemaRegistryId: TEST_CCLOUD_SCHEMA_REGISTRY.id,
        environmentId: TEST_CCLOUD_SCHEMA_REGISTRY.environmentId,
        connectionId: TEST_CCLOUD_SCHEMA_REGISTRY.connectionId,
        connectionType: TEST_CCLOUD_SCHEMA_REGISTRY.connectionType,
        isHighestVersion: true,
      }),
    ];

    beforeEach(() => {
      // wire up the initial test data subjects.
      const fakeSubjectMap: Map<string, Subject> = new Map();
      fakeSubjectMap.set(TEST_CCLOUD_SUBJECT.name, TEST_CCLOUD_SUBJECT);
      fakeSubjectMap.set(TEST_CCLOUD_SUBJECT2.name, TEST_CCLOUD_SUBJECT2);
      fakeSubjectMap.set(TEST_CCLOUD_SUBJECT3.name, TEST_CCLOUD_SUBJECT3);

      // Populate the instance's private map directly
      for (const [key, value] of fakeSubjectMap.entries()) {
        subjectsInTreeView.set(key, value);
      }

      provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;
    });

    it("should filter root-level subjects based on search string", () => {
      // First schema subject matches search
      provider.setSearch(TEST_CCLOUD_SCHEMA.subject);

      const rootElements = provider.getChildren();

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

    it("should return all root-level subjects if no search string", () => {
      const rootElements = provider.getChildren();

      assert.strictEqual(rootElements.length, 3, "should return all three subjects");

      assert.strictEqual(provider.totalItemCount, 3);
      assert.strictEqual(provider.searchMatches.size, 0);
      assert.strictEqual(provider["treeView"].message, undefined);
    });

    it("should return schemas for a subject", () => {
      const schemaElements = provider.getChildren(TEST_CCLOUD_SUBJECT3);

      assert.strictEqual(schemaElements.length, 1, "should return one schema");
      assert.ok(schemaElements[0] instanceof Schema);
      assert.strictEqual((schemaElements[0] as Schema).subject, TEST_CCLOUD_SUBJECT3.name);
    });

    it("should call updateSubjectSchemas() if subject has no schemas loaded", () => {
      const updateSubjectSchemasStub = sandbox.stub(provider, "updateSubjectSchemas");

      const schemaElements = provider.getChildren(TEST_CCLOUD_SUBJECT);

      // Should have called updateSubjectSchemas() to load schemas for the subject
      sinon.assert.calledOnce(updateSubjectSchemasStub);
      sinon.assert.calledWithExactly(updateSubjectSchemasStub, TEST_CCLOUD_SUBJECT.name, null);

      // Should return no schemas since none were loaded yet
      assert.strictEqual(schemaElements.length, 0);
    });

    it("should return empty array if asked for children of unknown element", () => {
      const unknownSubject = Schema.create({
        ...TEST_CCLOUD_SCHEMA,
        subject: "unknown-subject",
        id: "99999",
      }).subjectObject();
      const elements = provider.getChildren(unknownSubject);
      assert.ok(Array.isArray(elements));
      assert.strictEqual(elements.length, 0);
    });

    it("should return empty array if no schema registry is set", () => {
      provider.schemaRegistry = null;
      const elements = provider.getChildren();
      assert.ok(Array.isArray(elements));
      assert.strictEqual(elements.length, 0);
    });

    it("should return empty array if asked for children of a Schema", () => {
      const elements = provider.getChildren(TEST_CCLOUD_SCHEMA);
      assert.ok(Array.isArray(elements));
      assert.strictEqual(elements.length, 0);
    });
  });

  describe("isFocusedOnCCloud()", () => {
    it("should return true when the current schema registry is a CCloud one", () => {
      provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;
      const isFocused = provider.isFocusedOnCCloud();
      assert.strictEqual(isFocused, true);
    });

    it("should return false when the current schema registry is not ccloud", () => {
      provider.schemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;
      const isFocused = provider.isFocusedOnCCloud();
      assert.strictEqual(isFocused, false);
    });

    it("should return false when the current schema registry is null", () => {
      provider.schemaRegistry = null;
      const isFocused = provider.isFocusedOnCCloud();
      assert.strictEqual(isFocused, false);
    });
  });

  describe("SchemasViewProvider event handlers", () => {
    let resetStub: sinon.SinonStub;
    let refreshStub: sinon.SinonStub;
    let updateTreeViewDescriptionStub: sinon.SinonStub;

    beforeEach(() => {
      resetStub = sandbox.stub(provider, "reset");
      refreshStub = sandbox.stub(provider, "refresh");
      updateTreeViewDescriptionStub = sandbox.stub(provider, "updateTreeViewDescription");
    });

    describe("environmentChangedHandler", () => {
      let fakeEvent: EnvironmentChangeEvent;

      beforeEach(() => {
        fakeEvent = {
          id: "env-123" as EnvironmentId,
          wasDeleted: false,
        };
      });

      it("does nothing if not viewing a schema registry", async () => {
        provider.schemaRegistry = null;

        await provider.environmentChangedHandler(fakeEvent);

        // Should not have done anything
        sinon.assert.notCalled(resetStub);
        sinon.assert.notCalled(updateTreeViewDescriptionStub);
        sinon.assert.notCalled(refreshStub);
      });

      it("does nothing if viewing a schema registry in a different environment", async () => {
        provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

        await provider.environmentChangedHandler(fakeEvent);

        // Should not have done anything
        sinon.assert.notCalled(resetStub);
        sinon.assert.notCalled(updateTreeViewDescriptionStub);
        sinon.assert.notCalled(refreshStub);
      });

      it("should update the view description + refresh if viewing a schema registry in the changed environment", async () => {
        provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

        fakeEvent.id = TEST_CCLOUD_SCHEMA_REGISTRY.environmentId;

        await provider.environmentChangedHandler(fakeEvent);
        // Should have called .updateTreeViewDescription() + .refresh()
        sinon.assert.calledOnce(refreshStub);
        sinon.assert.calledOnce(updateTreeViewDescriptionStub);
        sinon.assert.notCalled(resetStub);
      });

      it("should reset if viewing a schema registry in the deleted environment", async () => {
        provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

        fakeEvent.id = TEST_CCLOUD_SCHEMA_REGISTRY.environmentId;
        fakeEvent.wasDeleted = true;

        await provider.environmentChangedHandler(fakeEvent);

        sinon.assert.calledOnce(resetStub);
        sinon.assert.notCalled(updateTreeViewDescriptionStub);
        sinon.assert.notCalled(refreshStub);
      });
    });

    describe("localSchemaRegistryConnectedHandler", () => {
      for (const connected of [true, false]) {
        it(`does nothing if no registry set, connected: ${connected}`, async () => {
          provider.schemaRegistry = null;

          // Call the handler with true or false, should not matter.
          await provider.localSchemaRegistryConnectedHandler(connected);

          // Should not have called .reset()
          sinon.assert.notCalled(resetStub);
        });

        it(`Should not reset if not viewing a local schema registry, connected: ${connected}`, async () => {
          provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;

          // Call the handler with true or false, should not matter.
          await provider.localSchemaRegistryConnectedHandler(connected);

          // Should not have called .reset()
          sinon.assert.notCalled(resetStub);
        });

        it(`Should reset if viewing a local schema registry and connected state changes, connected: ${connected}`, async () => {
          provider.schemaRegistry = TEST_LOCAL_SCHEMA_REGISTRY;

          // Call the handler with true or false, should not matter.
          await provider.localSchemaRegistryConnectedHandler(connected);

          // Should have called .reset()
          sinon.assert.calledOnce(resetStub);
        });
      }
    });

    describe("schemaSubjectChangedHandler", () => {
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
        sinon.assert.calledOnce(refreshStub);
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
        sinon.assert.calledOnce(refreshStub);
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
        sinon.assert.notCalled(refreshStub);
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
        sinon.assert.notCalled(refreshStub);
      });
    });

    describe("schemaVersionsChangedHandler", () => {
      let subjectsInTreeView: Map<string, Subject>;

      beforeEach(() => {
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
        sinon.assert.calledOnce(onDidChangeTreeDataFireStub);
        sinon.assert.alwaysCalledWithExactly(onDidChangeTreeDataFireStub, scratchSubject);
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
        sinon.assert.notCalled(refreshStub);
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
        sinon.assert.notCalled(refreshStub);
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
        sinon.assert.notCalled(refreshStub);
        assert.strictEqual(subjectsInTreeView.size, 0);
      });
    });
  });

  describe("setEventListeners() wires the proper handler methods to the proper event emitters", () => {
    let emitterStubs: StubbedEventEmitters;

    beforeEach(() => {
      // Stub all event emitters in the emitters module
      emitterStubs = eventEmitterStubs(sandbox);
    });

    // Define test cases as corresponding pairs of
    // [event emitter name, view provider handler method name]
    const handlerEmitterPairs: Array<[keyof typeof emitterStubs, keyof SchemasViewProvider]> = [
      ["environmentChanged", "environmentChangedHandler"],
      ["localSchemaRegistryConnected", "localSchemaRegistryConnectedHandler"],
      ["schemaSubjectChanged", "schemaSubjectChangedHandler"],
      ["schemaVersionsChanged", "schemaVersionsChangedHandler"],
    ];

    it("setCustomEventListeners should return the expected number of listeners", () => {
      const listeners = provider["setCustomEventListeners"]();
      assert.strictEqual(listeners.length, handlerEmitterPairs.length);
    });

    handlerEmitterPairs.forEach(([emitterName, handlerMethodName]) => {
      it(`should register ${handlerMethodName} with ${emitterName} emitter`, () => {
        // Create stub for the handler method
        const handlerStub = sandbox.stub(provider, handlerMethodName);

        // Re-invoke setCustomEventListeners() to capture emitter .event() stub calls
        provider["setCustomEventListeners"]();

        const emitterStub = emitterStubs[emitterName]!;

        // Verify the emitter's event method was called
        sinon.assert.calledOnce(emitterStub.event);

        // Capture the handler function that was registered
        const registeredHandler = emitterStub.event.firstCall.args[0];

        // Call the registered handler
        registeredHandler(undefined); // pass some dummy arg

        // Verify the expected method stub was called,
        // proving that the expected handler was registered
        // to the expected emitter.
        sinon.assert.calledOnce(handlerStub);
      });
    });
  });

  describe("revealSchema()", () => {
    let treeviewRevealStub: sinon.SinonStub;
    let setParentResourceStub: sinon.SinonStub;
    beforeEach(() => {
      treeviewRevealStub = sandbox.stub(provider["treeView"], "reveal");
      setParentResourceStub = sandbox.stub(provider, "setParentResource");
      provider.schemaRegistry = TEST_CCLOUD_SCHEMA_REGISTRY;
    });

    it("should call setParentResource to a different schema registry if needed", async () => {
      provider.schemaRegistry = null;

      stubbedCCloudResourceLoader.getSchemaRegistryForEnvironmentId.resolves(
        TEST_CCLOUD_SCHEMA_REGISTRY,
      );

      await provider.revealSchema(TEST_CCLOUD_SCHEMA);

      sinon.assert.calledOnce(setParentResourceStub);
    });

    it("should call treeView.reveal() to reveal the schema if in map", async () => {
      // Add the schema's subject to the map with schemas
      subjectsInTreeView.set(TEST_CCLOUD_SCHEMA.subject, TEST_CCLOUD_SCHEMA.subjectObject());

      stubbedCCloudResourceLoader.getSchemasForSubject.resolves([TEST_CCLOUD_SCHEMA]);

      await provider.revealSchema(TEST_CCLOUD_SCHEMA);

      sinon.assert.calledOnce(treeviewRevealStub);
    });

    it("should bail early if cannot find the schema registry for the schema", async () => {
      provider.schemaRegistry = null;
      stubbedCCloudResourceLoader.getSchemaRegistryForEnvironmentId.resolves(undefined);

      await provider.revealSchema(TEST_CCLOUD_SCHEMA);

      sinon.assert.notCalled(setParentResourceStub);
      sinon.assert.notCalled(treeviewRevealStub);
    });
  });
});
