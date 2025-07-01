import * as sinon from "sinon";
import * as vscode from "vscode";
import * as context from "../context/values";
import {
  flinkStatementSearchSet,
  resourceSearchSet,
  schemaSearchSet,
  topicSearchSet,
} from "../emitters";
import {
  clearFlinkStatementsSearch,
  clearResourceSearch,
  clearSchemaSearch,
  clearTopicSearch,
  searchFlinkStatements,
  searchResources,
  searchSchemas,
  searchTopics,
} from "./search";

describe("commands/search.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let showInputBoxStub: sinon.SinonStub;
  let setContextValueStub: sinon.SinonStub;
  let resourceSearchSetFireStub: sinon.SinonStub;
  let topicSearchSetFireStub: sinon.SinonStub;
  let schemaSearchSetFireStub: sinon.SinonStub;
  let flinkStatementSearchSetFireStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    showInputBoxStub = sandbox.stub(vscode.window, "showInputBox").resolves();

    setContextValueStub = sandbox.stub(context, "setContextValue").resolves();

    resourceSearchSetFireStub = sandbox.stub(resourceSearchSet, "fire");
    topicSearchSetFireStub = sandbox.stub(topicSearchSet, "fire");
    schemaSearchSetFireStub = sandbox.stub(schemaSearchSet, "fire");
    flinkStatementSearchSetFireStub = sandbox.stub(flinkStatementSearchSet, "fire");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("searchResources() should exit early when no search string is provided", async () => {
    // simulate the user cancelling the input box
    showInputBoxStub.resolves(undefined);

    await searchResources();

    sinon.assert.calledOnce(showInputBoxStub);
    sinon.assert.notCalled(setContextValueStub);
    sinon.assert.notCalled(resourceSearchSetFireStub);
  });

  it(`searchResources() should set ${context.ContextValues.resourceSearchApplied}=true and fire resourceSearchSet with the provided search string`, async () => {
    const searchString = "test-search";
    showInputBoxStub.resolves(searchString);

    await searchResources();

    sinon.assert.calledOnce(showInputBoxStub);
    sinon.assert.calledWith(
      showInputBoxStub.firstCall,
      sinon.match({
        title: "Search items in the Resources view",
        ignoreFocusOut: true,
      }),
    );
    sinon.assert.calledWith(setContextValueStub, context.ContextValues.resourceSearchApplied, true);
    sinon.assert.calledWith(resourceSearchSetFireStub, searchString);
  });

  it(`clearResourceSearch() should set ${context.ContextValues.resourceSearchApplied}=false and fire resourceSearchSet with null`, async () => {
    await clearResourceSearch();

    sinon.assert.calledWith(
      setContextValueStub,
      context.ContextValues.resourceSearchApplied,
      false,
    );
    sinon.assert.calledWith(resourceSearchSetFireStub, null);
  });

  it("searchTopics() should exit early when no search string is provided", async () => {
    // simulate the user cancelling the input box
    showInputBoxStub.resolves(undefined);

    await searchTopics();

    sinon.assert.calledOnce(showInputBoxStub);
    sinon.assert.notCalled(setContextValueStub);
    sinon.assert.notCalled(topicSearchSetFireStub);
  });

  it(`searchTopics() should set ${context.ContextValues.topicSearchApplied}=true and fire topicSearchSet with the provided search string`, async () => {
    const searchString = "test-search";
    showInputBoxStub.resolves(searchString);

    await searchTopics();

    sinon.assert.calledOnce(showInputBoxStub);
    sinon.assert.calledWith(
      showInputBoxStub.firstCall,
      sinon.match({
        title: "Search items in the Topics view",
        ignoreFocusOut: true,
      }),
    );
    sinon.assert.calledWith(setContextValueStub, context.ContextValues.topicSearchApplied, true);
    sinon.assert.calledWith(topicSearchSetFireStub, searchString);
  });

  it(`clearTopicSearch() should set ${context.ContextValues.topicSearchApplied}=false and fire topicSearchSet with null`, async () => {
    await clearTopicSearch();

    sinon.assert.calledWith(setContextValueStub, context.ContextValues.topicSearchApplied, false);
    sinon.assert.calledWith(topicSearchSetFireStub, null);
  });

  it("searchSchemas() should exit early when no search string is provided", async () => {
    // simulate the user cancelling the input box
    showInputBoxStub.resolves(undefined);

    await searchSchemas();

    sinon.assert.calledOnce(showInputBoxStub);
    sinon.assert.notCalled(setContextValueStub);
    sinon.assert.notCalled(schemaSearchSetFireStub);
  });

  it(`searchSchemas() should set ${context.ContextValues.schemaSearchApplied}=true and fire schemaSearchSet with the provided search string`, async () => {
    const searchString = "test-search";
    showInputBoxStub.resolves(searchString);

    await searchSchemas();

    sinon.assert.calledOnce(showInputBoxStub);
    sinon.assert.calledWith(
      showInputBoxStub.firstCall,
      sinon.match({
        title: "Search items in the Schemas view",
        ignoreFocusOut: true,
      }),
    );
    sinon.assert.calledWith(setContextValueStub, context.ContextValues.schemaSearchApplied, true);
    sinon.assert.calledWith(schemaSearchSetFireStub, searchString);
  });

  it(`clearSchemaSearch() should set ${context.ContextValues.schemaSearchApplied}=false and fire schemaSearchSet with null`, async () => {
    await clearSchemaSearch();

    sinon.assert.calledWith(setContextValueStub, context.ContextValues.schemaSearchApplied, false);
    sinon.assert.calledWith(schemaSearchSetFireStub, null);
  });

  it("searchFlinkStatements() should exit early when no search string is provided", async () => {
    // simulate the user cancelling the input box
    showInputBoxStub.resolves(undefined);

    await searchFlinkStatements();

    sinon.assert.calledOnce(showInputBoxStub);
    sinon.assert.notCalled(flinkStatementSearchSetFireStub);
  });

  it("searchFlinkStatements() should fire flinkStatementSearchSet with the provided search string", async () => {
    const searchString = "test-search";
    showInputBoxStub.resolves(searchString);

    await searchFlinkStatements();

    sinon.assert.calledOnce(showInputBoxStub);
    sinon.assert.calledWith(
      showInputBoxStub.firstCall,
      sinon.match({
        title: "Search items in the Flink Statements view",
        ignoreFocusOut: true,
      }),
    );
    // context should not be set directly as we migrate to BaseViewProvider handling it
    sinon.assert.notCalled(setContextValueStub);
    sinon.assert.calledWith(flinkStatementSearchSetFireStub, searchString);
  });

  it("clearFlinkStatementsSearch() should fire flinkStatementSearchSet with null", async () => {
    await clearFlinkStatementsSearch();

    // context should not be set directly as we migrate to BaseViewProvider handling it
    sinon.assert.notCalled(setContextValueStub);
    sinon.assert.calledWith(flinkStatementSearchSetFireStub, null);
  });
});
