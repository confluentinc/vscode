import * as assert from "assert";
import sinon from "sinon";
import * as vscode from "vscode";
import { TEST_LOCAL_SCHEMA } from "../../tests/unit/testResources";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import * as contextValues from "../context/values";
import { SchemaDocumentProvider } from "../documentProviders/schema";
import { Schema } from "../models/schema";
import { getStorageManager } from "../storage";
import { WorkspaceStorageKeys } from "../storage/constants";
import * as diffs from "./diffs";

describe("commands/diffs.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let executeCommandStub: sinon.SinonStub;
  let setContextValueStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    executeCommandStub = sandbox.stub(vscode.commands, "executeCommand");
    setContextValueStub = sandbox.stub(contextValues, "setContextValue");
  });

  afterEach(async () => {
    // clear stored URI between tests
    await getStorageManager().deleteWorkspaceState(WorkspaceStorageKeys.DIFF_BASE_URI);
    sandbox.restore();
  });

  it("selectForCompareCommand() should store schema URI in workspace state when schema is selected for compare", async () => {
    const schema = TEST_LOCAL_SCHEMA;
    const expectedUri = new SchemaDocumentProvider().resourceToUri(schema, schema.fileName());

    await diffs.selectForCompareCommand(schema);

    const storedUriString = await getStorageManager().getWorkspaceState(
      WorkspaceStorageKeys.DIFF_BASE_URI,
    );
    assert.strictEqual(storedUriString, expectedUri.toString());
    sinon.assert.calledWith(
      setContextValueStub,
      contextValues.ContextValues.resourceSelectedForCompare,
      true,
    );
  });

  it("selectForCompareCommand() should do nothing when no item is provided", async () => {
    await diffs.selectForCompareCommand(undefined);

    const storedUri = await getStorageManager().getWorkspaceState(
      WorkspaceStorageKeys.DIFF_BASE_URI,
    );
    assert.strictEqual(storedUri, undefined);
    sinon.assert.notCalled(setContextValueStub);
  });

  it("compareWithSelectedCommand() should execute the diff command with correct URIs when comparing two schemas", async () => {
    // preload first schema URI
    const schema1 = TEST_LOCAL_SCHEMA;
    const uri1 = new SchemaDocumentProvider().resourceToUri(schema1, schema1.fileName());
    await diffs.selectForCompareCommand(schema1);

    // compare with second schema
    const schema2 = Schema.create({ ...TEST_LOCAL_SCHEMA, id: "different-id" });
    const uri2 = new SchemaDocumentProvider().resourceToUri(schema2, schema2.fileName());
    await diffs.compareWithSelectedCommand(schema2);

    assert.ok(executeCommandStub.calledOnce);
    sinon.assert.calledWith(
      executeCommandStub,
      "vscode.diff",
      // fsPath will show up as `null`, so just compare the scheme, path, and query
      sinon.match((value) => {
        return (
          value.scheme === uri1.scheme && value.path === uri1.path && value.query === uri1.query
        );
      }),
      sinon.match((value) => {
        return (
          value.scheme === uri2.scheme && value.path === uri2.path && value.query === uri2.query
        );
      }),
      sinon.match.string, // for the title argument
    );
  });

  it("compareWithSelectedCommand() should not execute the diff command when no previous selection exists", async () => {
    const schema = TEST_LOCAL_SCHEMA;

    // Clear any existing stored URI
    await getStorageManager().setWorkspaceState(WorkspaceStorageKeys.DIFF_BASE_URI, undefined);

    await diffs.compareWithSelectedCommand(schema);

    assert.ok(executeCommandStub.notCalled);
  });

  it("compareWithSelectedCommand() should throw an error when trying to compare unsupported resource type", async () => {
    const unsupportedItem = { type: "unsupported" };

    await assert.rejects(
      async () => await diffs.compareWithSelectedCommand(unsupportedItem),
      /Unsupported resource type for comparison/,
    );
  });
});
