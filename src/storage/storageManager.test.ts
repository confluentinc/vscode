import assert from "assert";
import { getStorageManager } from ".";
import { getTestStorageManager } from "../../tests/unit/testUtils";

describe("StorageManager Tests", function () {
  let testKey: string;

  before(async () => {
    await getTestStorageManager();
  });

  beforeEach(() => {
    // generate a random key for each test to use so we don't have to worry about conflicts
    testKey = `test-key-${Math.random().toString(36).substring(4)}`;
  });

  it("should successfully get/set/delete SecretStorage items", async () => {
    // SecretStorage only holds strings, so no object or array values here
    const testValue = `test-value-${Math.random().toString(36).substring(4)}`;

    const storageManager = getStorageManager();
    await storageManager.setSecret(testKey, testValue);
    const value = await storageManager.getSecret(testKey);
    assert.deepStrictEqual(value, testValue);

    await storageManager.deleteSecret(testKey);
    const deletedValue = await storageManager.getSecret(testKey);
    assert.deepStrictEqual(deletedValue, undefined);
  });

  it("should successfully get/set/delete WorkspaceState items", async () => {
    const testValueObj = {
      foo: `test-value-${Math.random().toString(36).substring(4)}`,
    };

    const storageManager = getStorageManager();
    await storageManager.setWorkspaceState(testKey, testValueObj);
    const value = await storageManager.getWorkspaceState(testKey);
    assert.deepStrictEqual(value, testValueObj);

    await storageManager.deleteWorkspaceState(testKey);
    const deletedValue = await storageManager.getWorkspaceState(testKey);
    assert.deepStrictEqual(deletedValue, undefined, `Expected undefined, got ${deletedValue}`);
  });

  it("should successfully get/set/delete GlobalState items", async () => {
    const testValueObj = {
      foo: `test-value-${Math.random().toString(36).substring(4)}`,
    };

    const storageManager = getStorageManager();
    await storageManager.setGlobalState(testKey, testValueObj);
    const value = await storageManager.getGlobalState(testKey);
    assert.deepStrictEqual(value, testValueObj);

    await storageManager.deleteGlobalState(testKey);
    const deletedValue = await storageManager.getGlobalState(testKey);
    assert.deepStrictEqual(deletedValue, undefined, `Expected undefined, got ${deletedValue}`);
  });

  it("should successfully clear global state", async () => {
    const storageManager = getStorageManager();
    await storageManager.setGlobalState(testKey, "test-value");
    await storageManager.clearGlobalState();
    const keys = await storageManager.getGlobalStateKeys();
    assert.deepStrictEqual(keys, []);
  });

  it("should successfully clear workspace state", async () => {
    const storageManager = getStorageManager();
    await storageManager.setWorkspaceState(testKey, "test-value");
    await storageManager.clearWorkspaceState();
    const keys = await storageManager.getWorkspaceStateKeys();
    assert.deepStrictEqual(keys, []);
  });
});
