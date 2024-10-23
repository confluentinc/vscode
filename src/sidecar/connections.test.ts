import * as assert from "assert";
import { ContextValues, setContextValue } from "../context";
import { hasCCloudAuthSession } from "./connections";

describe("hasCCloudAuthSession() tests", () => {
  afterEach(() => {
    setContextValue(ContextValues.ccloudConnectionAvailable, false);
  });

  it("hasCCloudAuthSession() should return false when the context value is false or undefined", () => {
    for (const value of [false, undefined]) {
      setContextValue(ContextValues.ccloudConnectionAvailable, value);
      assert.strictEqual(hasCCloudAuthSession(), false, `Expected ${value} to return false`);
    }
  });

  it("hasCCloudAuthSession() should return true when the context value is true", () => {
    setContextValue(ContextValues.ccloudConnectionAvailable, true);
    assert.strictEqual(hasCCloudAuthSession(), true);
  });
});
