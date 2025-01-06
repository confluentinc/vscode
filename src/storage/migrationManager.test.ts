import * as assert from "assert";
import * as sinon from "sinon";
import { StorageManager } from ".";
import { getTestExtensionContext } from "../../tests/unit/testUtils";
import { DURABLE_STORAGE_VERSION_KEY, MigrationStorageType } from "./constants";
import {
  CODEBASE_STORAGE_VERSION,
  migrateGlobalState,
  migrateSecretStorage,
  migrateWorkspaceState,
} from "./migrationManager";
import * as migrationUtils from "./migrations/utils";

describe("storage/migrationManager", () => {
  let manager: StorageManager;
  let sandbox: sinon.SinonSandbox;
  let getStorageVersionStub: sinon.SinonStub;
  let executeMigrationsStub: sinon.SinonStub;
  let setStorageVersionStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    executeMigrationsStub = sandbox.stub(migrationUtils, "executeMigrations");

    manager = StorageManager.getInstance();
  });

  afterEach(() => {
    sandbox.restore();
  });

  type TestMigrationSetup = [
    keyof StorageManager,
    (manager: StorageManager) => Promise<void>,
    MigrationStorageType,
    keyof StorageManager,
  ];
  const testSetup: TestMigrationSetup[] = [
    ["getGlobalState", migrateGlobalState, "global", "setGlobalState"],
    ["getWorkspaceState", migrateWorkspaceState, "workspace", "setWorkspaceState"],
    ["getSecret", migrateSecretStorage, "secret", "setSecret"],
  ];

  for (const [
    managerGetMethodName,
    migrationFunc,
    storageType,
    managerSetMethodName,
  ] of testSetup) {
    it(`migrate*() for "${storageType}" state/storage should call executeMigrations() when storage version is incorrect`, async () => {
      // stub the storage version returned
      const storedVersion = 1;
      getStorageVersionStub = sandbox.stub(manager, managerGetMethodName).resolves(storedVersion);
      setStorageVersionStub = sandbox.stub(manager, managerSetMethodName);

      await migrationFunc(manager);

      assert.ok(getStorageVersionStub.calledOnceWith(DURABLE_STORAGE_VERSION_KEY));
      assert.ok(
        executeMigrationsStub.calledOnceWith(storedVersion, CODEBASE_STORAGE_VERSION, storageType),
      );
      // also ensure we stamp the correct storage version after migration
      // (secret storage version must be a string though)
      const expectedVersion =
        storageType === "secret" ? String(CODEBASE_STORAGE_VERSION) : CODEBASE_STORAGE_VERSION;
      assert.ok(setStorageVersionStub.calledOnceWith(DURABLE_STORAGE_VERSION_KEY, expectedVersion));
    });

    it(`migrate*() for "${storageType}" state/storage should not call executeMigrations() when storage version is correct`, async () => {
      // stub the correct storage version returned
      getStorageVersionStub = sandbox
        .stub(manager, managerGetMethodName)
        .resolves(CODEBASE_STORAGE_VERSION);
      setStorageVersionStub = sandbox.stub(manager, managerSetMethodName);

      await migrationFunc(manager);

      assert.ok(getStorageVersionStub.calledOnceWith(DURABLE_STORAGE_VERSION_KEY));
      assert.ok(executeMigrationsStub.notCalled);
      assert.ok(setStorageVersionStub.notCalled);
    });
  }
});
