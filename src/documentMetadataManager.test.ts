import * as assert from "assert";
import * as sinon from "sinon";
import { TextDocument, Uri, workspace } from "vscode";
import { DocumentMetadataManager } from "./documentMetadataManager";
import { UriMetadataKeys } from "./storage/constants";
import { ResourceManager } from "./storage/resourceManager";
import { UriMetadataMap } from "./storage/types";

describe("documentMetadataManager.ts", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("DocumentMetadataManager", () => {
    let stubResourceManager: sinon.SinonStubbedInstance<ResourceManager>;
    let manager: DocumentMetadataManager;

    beforeEach(() => {
      stubResourceManager = sandbox.createStubInstance(ResourceManager);
      sandbox.stub(ResourceManager, "getInstance").returns(stubResourceManager);

      manager = DocumentMetadataManager.getInstance();
    });

    afterEach(() => {
      manager.dispose();
      DocumentMetadataManager["instance"] = null;
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

    describe("handleDocumentSave()", () => {
      // NOTE: setting up fake TextDocuments is tricky since we can't create them directly, so we're
      // only populating the fields needed for the test and associated codebase logic, then using the
      // `as unknown as TextDocument` pattern to appease TypeScript.

      // first, the unsaved "untitled" document
      const fakeUntitledDoc: TextDocument = {
        uri: Uri.parse("untitled:test.sql"),
        getText: () => "SELECT * FROM test",
      } as unknown as TextDocument;
      // and the after-save "file" document
      const fakeFileDoc: TextDocument = {
        ...fakeUntitledDoc,
        uri: fakeUntitledDoc.uri.with({ scheme: "file" }),
      } as unknown as TextDocument;

      it("should exit early for 'untitled' documents", async () => {
        await manager["handleDocumentSave"](fakeUntitledDoc);

        sinon.assert.notCalled(stubResourceManager.getAllUriMetadata);
      });

      it("should migrate 'untitled' doc metadata to newly-saved 'file' doc when content matches exactly", async () => {
        // set up the unsaved document
        sandbox.stub(workspace, "textDocuments").get(() => [fakeUntitledDoc]);
        sandbox.stub(workspace, "openTextDocument").resolves(fakeUntitledDoc);

        // set some initial metadata for the untitled document to be migrated
        const metadata = {
          [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: "test-compute-pool",
        };
        const metadataMap: UriMetadataMap = new Map();
        metadataMap.set(fakeUntitledDoc.uri.toString(), metadata);
        stubResourceManager.getAllUriMetadata.resolves(metadataMap);

        await manager["handleDocumentSave"](fakeFileDoc);

        // migration should have happened by setting the metadata for the file document and deleting the
        // metadata for the untitled document
        sinon.assert.calledWith(stubResourceManager.setUriMetadata, fakeFileDoc.uri, metadata);
        sinon.assert.calledWith(stubResourceManager.deleteUriMetadata, fakeUntitledDoc.uri);
      });

      it("should migrate 'untitled' doc metadata to newly-saved 'file' doc when content matches aside from whitespace/newlines", async () => {
        // set up the unsaved document
        const fakeUntitledDocWithWhitespaceContent: TextDocument = {
          ...fakeUntitledDoc,
          getText: () => "   SELECT * FROM test  ",
        } as unknown as TextDocument;
        sandbox.stub(workspace, "textDocuments").get(() => [fakeUntitledDocWithWhitespaceContent]);
        sandbox.stub(workspace, "openTextDocument").resolves(fakeUntitledDocWithWhitespaceContent);

        // set some initial metadata for the untitled document to be migrated
        const metadata = {
          [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: "test-compute-pool",
        };
        const metadataMap: UriMetadataMap = new Map();
        metadataMap.set(fakeUntitledDocWithWhitespaceContent.uri.toString(), metadata);
        stubResourceManager.getAllUriMetadata.resolves(metadataMap);

        await manager["handleDocumentSave"](fakeFileDoc);

        // migration should have happened by setting the metadata for the file document and deleting the
        // metadata for the untitled document
        sinon.assert.calledWith(stubResourceManager.setUriMetadata, fakeFileDoc.uri, metadata);
        sinon.assert.calledWith(
          stubResourceManager.deleteUriMetadata,
          fakeUntitledDocWithWhitespaceContent.uri,
        );
      });

      it("should not migrate metadata when content does not match", async () => {
        sandbox.stub(workspace, "textDocuments").get(() => [fakeUntitledDoc]);
        sandbox.stub(workspace, "openTextDocument").resolves(fakeUntitledDoc);
        // set up the "after save" file document from some other source
        const fakeFileDocWithOtherContents: TextDocument = {
          uri: Uri.parse("file:///test.sql"),
          getText: () => "SELECT * FROM some_other_table",
        } as unknown as TextDocument;

        // set some initial metadata for the untitled document to (hopefully) not migrate
        const metadata = {
          [UriMetadataKeys.FLINK_COMPUTE_POOL_ID]: "test-compute-pool",
        };
        const metadataMap: UriMetadataMap = new Map();
        metadataMap.set(fakeUntitledDoc.uri.toString(), metadata);
        stubResourceManager.getAllUriMetadata.resolves(metadataMap);

        await manager["handleDocumentSave"](fakeFileDocWithOtherContents);

        // migration should not have happened
        sinon.assert.notCalled(stubResourceManager.setUriMetadata);
        sinon.assert.notCalled(stubResourceManager.deleteUriMetadata);
      });
    });
  });
});
