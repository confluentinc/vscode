import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as commands from ".";
import * as contextValues from "../context/values";

import { ViewSearchCommands, getAllSearchCommandsInstances } from "./search";

describe("commands/search", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe("ViewSearchCommands", () => {
    const testLabelNoun = "Test Items";
    const testViewName = "testItems";
    const testSearchContextValue = contextValues.ContextValues.resourceSearchApplied; // Using an existing context value for testing
    let testEmitter: vscode.EventEmitter<string | null>;
    let viewSearchCommands: ViewSearchCommands;
    let emitterFireStub: sinon.SinonStub;
    let setContextValueStub: sinon.SinonStub;

    beforeEach(() => {
      testEmitter = new vscode.EventEmitter<string | null>();
      emitterFireStub = sandbox.stub(testEmitter, "fire");
      setContextValueStub = sandbox.stub(contextValues, "setContextValue");
      viewSearchCommands = new ViewSearchCommands(
        testLabelNoun,
        testViewName,
        testSearchContextValue,
        testEmitter,
      );
    });
    afterEach(() => {
      testEmitter.dispose();
    });

    describe("searchCommand", () => {
      let showInputBoxStub: sinon.SinonStub;

      beforeEach(() => {
        showInputBoxStub = sandbox.stub(vscode.window, "showInputBox");
      });

      it("should exit early when no search string is provided", async () => {
        showInputBoxStub.resolves(undefined); // Simulate user cancelling input box

        await viewSearchCommands.searchCommand();

        sinon.assert.calledOnce(showInputBoxStub);
        sinon.assert.notCalled(setContextValueStub);
        sinon.assert.notCalled(emitterFireStub);
      });

      it("should set context value and fire emitter with the provided search string", async () => {
        const searchString = "test-search";
        showInputBoxStub.resolves(searchString);

        await viewSearchCommands.searchCommand();

        sinon.assert.calledOnce(showInputBoxStub);
        sinon.assert.calledOnceWithExactly(setContextValueStub, testSearchContextValue, true);
        sinon.assert.calledOnceWithExactly(emitterFireStub, searchString);
      });
    });

    describe("clearCommand", () => {
      it("should set context value to false and fire emitter with null", async () => {
        await viewSearchCommands.clearCommand();

        sinon.assert.calledOnceWithExactly(setContextValueStub, testSearchContextValue, false);
        sinon.assert.calledOnceWithExactly(emitterFireStub, null);
      });
    });

    describe("registerCommands", () => {
      let registerCommandWithLoggingStub: sinon.SinonStub;

      beforeEach(() => {
        registerCommandWithLoggingStub = sandbox.stub(commands, "registerCommandWithLogging");
      });

      it("should register search and clear commands with correct names", () => {
        viewSearchCommands.registerCommands();

        sinon.assert.calledTwice(registerCommandWithLoggingStub);
        sinon.assert.calledWithExactly(
          registerCommandWithLoggingStub.firstCall,
          `confluent.${testViewName}.search`,
          sinon.match.func,
        );
        sinon.assert.calledWithExactly(
          registerCommandWithLoggingStub.secondCall,
          `confluent.${testViewName}.search.clear`,
          sinon.match.func,
        );
      });
    });
  });

  describe("getAllSearchCommandsInstances()", () => {
    const searchableViews = [
      { labelNoun: "Resources", viewName: "resources" },
      { labelNoun: "Topics", viewName: "topics" },
      { labelNoun: "Schemas", viewName: "schemas" },
      { labelNoun: "Flink Statements", viewName: "flink.statements" },
      { labelNoun: "Flink Database", viewName: "flink.database" },
    ];

    let allSearchCommandsInstances: ViewSearchCommands[];
    before(() => {
      allSearchCommandsInstances = getAllSearchCommandsInstances();
    });

    it("should have an instance for each searchable view", () => {
      assert.strictEqual(
        allSearchCommandsInstances.length,
        searchableViews.length,
        "Mismatch in number of searchable views and ViewSearchCommands instances",
      );

      searchableViews.forEach((view) => {
        const instance = allSearchCommandsInstances.find(
          (inst) => inst.labelNoun === view.labelNoun && inst.viewName === view.viewName,
        );
        assert.ok(
          instance !== undefined,
          `No ViewSearchCommands instance found for view: ${view.labelNoun}`,
        );
      });

      it("All context values should be unique", () => {
        const contextValuesSet = new Set<string>();
        allSearchCommandsInstances.forEach((instance) => {
          assert.ok(
            !contextValuesSet.has(instance.searchContextValue),
            `Duplicate context value found: ${instance.searchContextValue}`,
          );
          contextValuesSet.add(instance.searchContextValue);
        });
      });

      it("All view names should be unique", () => {
        const viewNamesSet = new Set<string>();
        allSearchCommandsInstances.forEach((instance) => {
          assert.ok(
            !viewNamesSet.has(instance.viewName),
            `Duplicate view name found: ${instance.viewName}`,
          );
          viewNamesSet.add(instance.viewName);
        });
      });

      it("All event emitters should be unique", () => {
        const emittersSet = new Set<vscode.EventEmitter<string | null>>();
        allSearchCommandsInstances.forEach((instance) => {
          assert.ok(
            !emittersSet.has(instance.emitter),
            `Duplicate event emitter found for view: ${instance.viewName}`,
          );
          emittersSet.add(instance.emitter);
        });
      });
    });
  });
});
