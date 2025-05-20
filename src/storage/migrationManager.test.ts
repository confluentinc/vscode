import * as sinon from "sinon";
import {
  getStubbedGlobalState,
  getStubbedSecretStorage,
  getStubbedWorkspaceState,
  StubbedGlobalState,
  StubbedSecretStorage,
  StubbedWorkspaceState,
} from "../../tests/stubs/extensionStorage";
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
  let sandbox: sinon.SinonSandbox;

  let executeMigrationsStub: sinon.SinonStub;

  before(async () => {
    await getTestExtensionContext();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    executeMigrationsStub = sandbox.stub(migrationUtils, "executeMigrations");
  });

  afterEach(() => {
    sandbox.restore();
  });

  it(`migrateWorkspaceState() should call executeMigrations() when storage version is incorrect`, async () => {
    // stub the storage version returned
    const storedVersion = 1;
    const stubbedWorkspaceState: StubbedWorkspaceState = getStubbedWorkspaceState(sandbox);
    stubbedWorkspaceState.get.returns(storedVersion);

    await migrateWorkspaceState();

    sinon.assert.calledOnceWithExactly(stubbedWorkspaceState.get, DURABLE_STORAGE_VERSION_KEY);
    sinon.assert.calledOnceWithExactly(
      executeMigrationsStub,
      storedVersion,
      CODEBASE_STORAGE_VERSION,
      MigrationStorageType.WORKSPACE,
    );
    sinon.assert.calledOnceWithExactly(
      stubbedWorkspaceState.update,
      DURABLE_STORAGE_VERSION_KEY,
      CODEBASE_STORAGE_VERSION,
    );
  });

  it(`migrateWorkspaceState() should not call executeMigrations() when storage version is correct`, async () => {
    // stub the correct storage version returned
    const stubbedWorkspaceState: StubbedWorkspaceState = getStubbedWorkspaceState(sandbox);
    stubbedWorkspaceState.get.returns(CODEBASE_STORAGE_VERSION);

    await migrateWorkspaceState();

    sinon.assert.calledOnceWithExactly(stubbedWorkspaceState.get, DURABLE_STORAGE_VERSION_KEY);
    sinon.assert.notCalled(executeMigrationsStub);
    sinon.assert.notCalled(stubbedWorkspaceState.update);
  });

  it(`migrateGlobalState() should call executeMigrations() when storage version is incorrect`, async () => {
    // stub the storage version returned
    const storedVersion = 1;
    const stubbedGlobalState: StubbedGlobalState = getStubbedGlobalState(sandbox);
    stubbedGlobalState.get.returns(storedVersion);

    await migrateGlobalState();

    sinon.assert.calledOnceWithExactly(stubbedGlobalState.get, DURABLE_STORAGE_VERSION_KEY);
    sinon.assert.calledOnceWithExactly(
      executeMigrationsStub,
      storedVersion,
      CODEBASE_STORAGE_VERSION,
      MigrationStorageType.GLOBAL,
    );
    sinon.assert.calledOnceWithExactly(
      stubbedGlobalState.update,
      DURABLE_STORAGE_VERSION_KEY,
      CODEBASE_STORAGE_VERSION,
    );
  });

  it(`migrateGlobalState() for globalState should not call executeMigrations() when storage version is correct`, async () => {
    // stub the correct storage version returned
    const stubbedGlobalState: StubbedGlobalState = getStubbedGlobalState(sandbox);
    stubbedGlobalState.get.returns(CODEBASE_STORAGE_VERSION);

    await migrateGlobalState();

    sinon.assert.calledOnceWithExactly(stubbedGlobalState.get, DURABLE_STORAGE_VERSION_KEY);
    sinon.assert.notCalled(executeMigrationsStub);
    sinon.assert.notCalled(stubbedGlobalState.update);
  });

  it(`migrateSecretStorage() should call executeMigrations() when storage version is incorrect`, async () => {
    // stub the storage version returned
    const storedVersion = 1;
    const stubbedSecretStorage: StubbedSecretStorage = getStubbedSecretStorage(sandbox);
    stubbedSecretStorage.get.resolves(storedVersion);

    await migrateSecretStorage();

    sinon.assert.calledOnceWithExactly(stubbedSecretStorage.get, DURABLE_STORAGE_VERSION_KEY);
    sinon.assert.calledOnceWithExactly(
      executeMigrationsStub,
      storedVersion,
      CODEBASE_STORAGE_VERSION,
      MigrationStorageType.SECRET,
    );
    sinon.assert.calledOnceWithExactly(
      stubbedSecretStorage.store,
      DURABLE_STORAGE_VERSION_KEY,
      String(CODEBASE_STORAGE_VERSION), // secret storage expects string values
    );
  });

  it(`migrateSecretStorage() should not call executeMigrations() when storage version is correct`, async () => {
    // stub the correct storage version returned
    const stubbedSecretStorage: StubbedSecretStorage = getStubbedSecretStorage(sandbox);
    stubbedSecretStorage.get.resolves(CODEBASE_STORAGE_VERSION);

    await migrateSecretStorage();

    sinon.assert.calledOnceWithExactly(stubbedSecretStorage.get, DURABLE_STORAGE_VERSION_KEY);
    sinon.assert.notCalled(executeMigrationsStub);
    sinon.assert.notCalled(stubbedSecretStorage.store);
  });
});
