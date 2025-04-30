import * as assert from "assert";
import * as sinon from "sinon";
import { TextDocument, Uri, workspace } from "vscode";
import { DocumentMetadataManager } from "./documentMetadataManager";
import { UriMetadataKeys } from "./storage/constants";
import { ResourceManager } from "./storage/resourceManager";
import { UriMetadataMap } from "./storage/types";

describe("documentMetadataManager.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let stubResourceManager: sinon.SinonStubbedInstance<ResourceManager>;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    stubResourceManager = sandbox.createStubInstance(ResourceManager);
    sandbox.stub(ResourceManager, "getInstance").returns(stubResourceManager);
  });

  afterEach(() => {
    DocumentMetadataManager["instance"] = null;
    sandbox.restore();
  });

  it("should create only one instance of DocumentMetadataManager", () => {
    const instance1 = DocumentMetadataManager.getInstance();
    const instance2 = DocumentMetadataManager.getInstance();
    assert.strictEqual(instance1, instance2);
  });

  it("should register document lifecycle event handlers when instantiated", () => {
    const onDidOpenTextDocumentSpy = sandbox.spy(workspace, "onDidOpenTextDocument");
    const onDidSaveTextDocumentSpy = sandbox.spy(workspace, "onDidSaveTextDocument");
    const onDidCloseTextDocumentSpy = sandbox.spy(workspace, "onDidCloseTextDocument");

    DocumentMetadataManager.getInstance();

    assert.ok(onDidOpenTextDocumentSpy.calledOnce);
    assert.ok(onDidSaveTextDocumentSpy.calledOnce);
    assert.ok(onDidCloseTextDocumentSpy.calledOnce);
  });

  it("handleDocumentSave() should exit early for 'untitled' documents", async () => {
    // NOTE: setting up fake TextDocuments is tricky since we can't create them directly, so we're
    // only populating the fields needed for the test and associated codebase logic, then using the
    // `as unknown as TextDocument` pattern to appease TypeScript
    const fakeUntitledDoc: TextDocument = {
      uri: Uri.parse("untitled:test.sql"),
    } as unknown as TextDocument;

    const dmm = DocumentMetadataManager.getInstance();
    await dmm["handleDocumentSave"](fakeUntitledDoc);

    sinon.assert.notCalled(stubResourceManager.getAllUriMetadata);
  });

  it("handleDocumentSave() should migrate metadata from tracked 'untitled' document to newly-saved 'file' document when content matches", async () => {
    // set up the "before save" untitled document
    const fakeUntitledDoc: TextDocument = {
      uri: Uri.parse("untitled:test.sql"),
      getText: () => "SELECT * FROM test",
    } as unknown as TextDocument;
    sandbox.stub(workspace, "textDocuments").get(() => [fakeUntitledDoc]);
    // set up the "after save" file document
    const fakeFileDoc: TextDocument = {
      uri: Uri.parse("file:///test.sql"),
      getText: () => "SELECT * FROM test",
    } as unknown as TextDocument;
    sandbox.stub(workspace, "openTextDocument").resolves(fakeFileDoc);

    // set some initial metadata for the untitled document to be migrated
    const metadata = {
      [UriMetadataKeys.COMPUTE_POOL_ID]: "test-compute-pool",
      [UriMetadataKeys.ENVIRONMENT_ID]: "test-env",
    };
    const metadataMap: UriMetadataMap = new Map();
    metadataMap.set(fakeUntitledDoc.uri.toString(), metadata);
    stubResourceManager.getAllUriMetadata.resolves(metadataMap);

    const dmm = DocumentMetadataManager.getInstance();
    await dmm["handleDocumentSave"](fakeFileDoc);

    // migration should have happened by setting the metadata for the file document and deleting the
    // metadata for the untitled document
    assert.ok(stubResourceManager.setUriMetadata.calledWith(fakeFileDoc.uri, metadata));
    assert.ok(stubResourceManager.deleteUriMetadata.calledWith(fakeUntitledDoc.uri));
  });

  it("handleDocumentSave() should not migrate metadata when content does not match", async () => {
    // set up the "before save" untitled document
    const fakeUntitledDoc: TextDocument = {
      uri: Uri.parse("untitled:test.sql"),
      getText: () => "SELECT * FROM test",
    } as unknown as TextDocument;
    sandbox.stub(workspace, "textDocuments").get(() => [fakeUntitledDoc]);
    // set up the "after save" file document
    const fakeFileDoc: TextDocument = {
      uri: Uri.parse("file:///test.sql"),
      getText: () => "SELECT * FROM some_other_table",
    } as unknown as TextDocument;

    // set some initial metadata for the untitled document to (hopefully) not migrate
    const metadata = {
      [UriMetadataKeys.COMPUTE_POOL_ID]: "test-compute-pool",
      [UriMetadataKeys.ENVIRONMENT_ID]: "test-env",
    };
    const metadataMap: UriMetadataMap = new Map();
    metadataMap.set(fakeUntitledDoc.uri.toString(), metadata);
    stubResourceManager.getAllUriMetadata.resolves(metadataMap);

    const dmm = DocumentMetadataManager.getInstance();
    await dmm["handleDocumentSave"](fakeFileDoc);

    // migration should not have happened
    assert.ok(stubResourceManager.setUriMetadata.notCalled);
    assert.ok(stubResourceManager.deleteUriMetadata.notCalled);
  });
});
