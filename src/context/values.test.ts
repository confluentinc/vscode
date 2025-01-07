import * as assert from "assert";
import sinon from "sinon";
import { commands } from "vscode";
import { ContextValues, getContextValue, setContextValue } from "./values";

describe("ContextValue functions", () => {
  let sandbox: sinon.SinonSandbox;
  let executeCommandStub: sinon.SinonStub;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    executeCommandStub = sandbox.stub(commands, "executeCommand");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("setContextValue() should correctly context value and execute the setContext command", async () => {
    const key = ContextValues.resourceSelectedForCompare;
    const value = true;

    await setContextValue(key, value);

    assert.ok(executeCommandStub.calledWith("setContext", key, value));
    assert.deepStrictEqual(getContextValue<boolean>(key), value);
  });

  it("setContextValue() should throw an error for an untracked context value", async () => {
    await assert.rejects(
      () => setContextValue("invalidKey" as ContextValues, "value"),
      new Error(
        'Unknown contextValue "invalidKey"; ensure this is added to src/context.ts::ContextValues before using in package.json',
      ),
    );
  });

  it("getContextValue() should return the correct context value", async () => {
    const key = ContextValues.CCLOUD_RESOURCES;
    const value = ["resource1", "resource2"];

    await setContextValue(key, value);

    assert.deepStrictEqual(getContextValue<string[]>(key), value);
  });

  it("getContextValue() should return undefined for a non-existent context value", () => {
    assert.strictEqual(getContextValue<string>("nonExistentKey"), undefined);
  });
});
