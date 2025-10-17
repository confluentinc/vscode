import * as assert from "assert";
import * as sinon from "sinon";
import type { TextDocument } from "vscode";
import { Uri, workspace } from "vscode";
import { DocumentMetadataManager } from "./documentMetadataManager";
import { FLINKSTATEMENT_URI_SCHEME } from "./documentProviders/flinkStatement";
import { UriMetadataKeys } from "./storage/constants";
import { ResourceManager } from "./storage/resourceManager";
import type { UriMetadataMap } from "./storage/types";

describe("documentMetadataManager.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let stubResourceManager: sinon.SinonStubbedInstance<ResourceManager>;
  let manager: DocumentMetadataManager;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    stubResourceManager = sandbox.createStubInstance(ResourceManager);
    sandbox.stub(ResourceManager, "getInstance").returns(stubResourceManager);

    manager = DocumentMetadataManager.getInstance();
  });

  afterEach(() => {
    manager.dispose();
    DocumentMetadataManager["instance"] = null;
    sandbox.restore();
  });

  it("should create only one instance of DocumentMetadataManager", () => {
    const manager2 = DocumentMetadataManager.getInstance();
    try {
      assert.strictEqual(manager, manager2);
    } finally {
      manager2.dispose();
    }
  });

  it("should register document lifecycle event handlers when instantiated", () => {
    const onDidOpenTextDocumentSpy = sandbox.spy(workspace, "onDidOpenTextDocument");
    const onDidSaveTextDocumentSpy = sandbox.spy(workspace, "onDidSaveTextDocument");
    const onDidCloseTextDocumentSpy = sandbox.spy(workspace, "onDidCloseTextDocument");

    // ensure we start fresh with a new constructor call
    manager.dispose();
    DocumentMetadataManager["instance"] = null;
    DocumentMetadataManager.getInstance();

    sinon.assert.calledOnce(onDidOpenTextDocumentSpy);
    sinon.assert.calledOnce(onDidSaveTextDocumentSpy);
    sinon.assert.calledOnce(onDidCloseTextDocumentSpy);
  });

  it("handleDocumentSave() should exit early for 'untitled' documents", async () => {
    // NOTE: setting up fake TextDocuments is tricky since we can't create them directly, so we're
    // only populating the fields needed for the test and associated codebase logic, then using the
    // `as unknown as TextDocument` pattern to appease TypeScript
    const fakeUntitledDoc: TextDocument = {
      uri: Uri.parse("untitled:test.sql"),
    } as unknown as TextDocument;

    await manager["handleDocumentSave"](fakeUntitledDoc);

    sinon.assert.notCalled(stubResourceManager.getAllUriMetadata);
  });

  for (const scheme of ["untitled", FLINKSTATEMENT_URI_SCHEME]) {
    it(`handleDocumentSave() should migrate metadata to newly-saved 'file' document when content matches exactly (unsaved scheme='${scheme}')`, async () => {
      // set up the unsaved document
      const fakeUnsavedDoc: TextDocument = {
        uri: Uri.parse(`${scheme}:test.sql`),
        getText: () => "SELECT * FROM test",
      } as unknown as TextDocument;
      sandbox.stub(workspace, "textDocuments").get(() => [fakeUnsavedDoc]);
      sandbox.stub(workspace, "openTextDocument").resolves(fakeUnsavedDoc);
      // set up the "after save" file-scheme document
      const fakeFileDoc: TextDocument = {
        uri: Uri.parse("file:///test.sql"),
        getText: () => "SELECT * FROM test",
      } as unknown as TextDocument;

      // set some initial metadata for the untitled document to be migrated
      const metadata = {
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: "test-compute-pool",
      };
      const metadataMap: UriMetadataMap = new Map();
      metadataMap.set(fakeUnsavedDoc.uri.toString(), metadata);
      stubResourceManager.getAllUriMetadata.resolves(metadataMap);

      await manager["handleDocumentSave"](fakeFileDoc);

      // migration should have happened by setting the metadata for the file document and deleting the
      // metadata for the untitled document
      sinon.assert.calledWith(stubResourceManager.setUriMetadata, fakeFileDoc.uri, metadata);
      sinon.assert.calledWith(stubResourceManager.deleteUriMetadata, fakeUnsavedDoc.uri);
    });

    it(`handleDocumentSave() should migrate metadata to newly-saved 'file' document when content matches aside from whitespace/newlines (unsaved scheme='${scheme}')`, async () => {
      // set up the unsaved document
      const fakeUnsavedDoc: TextDocument = {
        uri: Uri.parse(`${scheme}:test.sql`),
        getText: () => "   SELECT * FROM test  ",
      } as unknown as TextDocument;
      sandbox.stub(workspace, "textDocuments").get(() => [fakeUnsavedDoc]);
      sandbox.stub(workspace, "openTextDocument").resolves(fakeUnsavedDoc);
      // set up the "after save" file document
      const fakeFileDoc: TextDocument = {
        uri: Uri.parse("file:///test.sql"),
        getText: () => "SELECT * FROM test\n",
      } as unknown as TextDocument;

      // set some initial metadata for the untitled document to be migrated
      const metadata = {
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: "test-compute-pool",
      };
      const metadataMap: UriMetadataMap = new Map();
      metadataMap.set(fakeUnsavedDoc.uri.toString(), metadata);
      stubResourceManager.getAllUriMetadata.resolves(metadataMap);

      await manager["handleDocumentSave"](fakeFileDoc);

      // migration should have happened by setting the metadata for the file document and deleting the
      // metadata for the untitled document
      sinon.assert.calledWith(stubResourceManager.setUriMetadata, fakeFileDoc.uri, metadata);
      sinon.assert.calledWith(stubResourceManager.deleteUriMetadata, fakeUnsavedDoc.uri);
    });

    it(`handleDocumentSave() should not migrate metadata when content does not match (unsaved scheme='${scheme}')`, async () => {
      // set up the unsaved document
      const fakeUnsavedDoc: TextDocument = {
        uri: Uri.parse(`${scheme}:test.sql`),
        getText: () => "SELECT * FROM test",
      } as unknown as TextDocument;
      sandbox.stub(workspace, "textDocuments").get(() => [fakeUnsavedDoc]);
      sandbox.stub(workspace, "openTextDocument").resolves(fakeUnsavedDoc);
      // set up the "after save" file document
      const fakeFileDoc: TextDocument = {
        uri: Uri.parse("file:///test.sql"),
        getText: () => "SELECT * FROM some_other_table",
      } as unknown as TextDocument;

      // set some initial metadata for the untitled document to (hopefully) not migrate
      const metadata = {
        [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: "test-compute-pool",
      };
      const metadataMap: UriMetadataMap = new Map();
      metadataMap.set(fakeUnsavedDoc.uri.toString(), metadata);
      stubResourceManager.getAllUriMetadata.resolves(metadataMap);

      await manager["handleDocumentSave"](fakeFileDoc);

      // migration should not have happened
      sinon.assert.notCalled(stubResourceManager.setUriMetadata);
      sinon.assert.notCalled(stubResourceManager.deleteUriMetadata);
    });
  }
});
