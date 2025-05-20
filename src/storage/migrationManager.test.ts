import * as sinon from "sinon";
import {
  getStubbedGlobalState,
  getStubbedSecretStorage,
  getStubbedWorkspaceState,
  StubbedMemento,
  StubbedSecretStorage,
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

  it(`migrate*() for workspaceState should call executeMigrations() when storage version is incorrect`, async () => {
    // stub the storage version returned
    const storedVersion = 1;
    const stubbedWorkspaceState: StubbedMemento = await getStubbedWorkspaceState(sandbox);
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

  it(`migrate*() for workspaceState should not call executeMigrations() when storage version is correct`, async () => {
    // stub the correct storage version returned
    const stubbedWorkspaceState: StubbedMemento = await getStubbedWorkspaceState(sandbox);
    stubbedWorkspaceState.get.returns(CODEBASE_STORAGE_VERSION);

    await migrateWorkspaceState();

    sinon.assert.calledOnceWithExactly(stubbedWorkspaceState.get, DURABLE_STORAGE_VERSION_KEY);
    sinon.assert.notCalled(executeMigrationsStub);
    sinon.assert.notCalled(stubbedWorkspaceState.update);
  });

  it(`migrate*() for globalState should call executeMigrations() when storage version is incorrect`, async () => {
    // stub the storage version returned
    const storedVersion = 1;
    const stubbedGlobalState: StubbedMemento = await getStubbedGlobalState(sandbox);
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

  it(`migrate*() for globalState should not call executeMigrations() when storage version is correct`, async () => {
    // stub the correct storage version returned
    const stubbedGlobalState: StubbedMemento = await getStubbedGlobalState(sandbox);
    stubbedGlobalState.get.returns(CODEBASE_STORAGE_VERSION);

    await migrateGlobalState();

    sinon.assert.calledOnceWithExactly(stubbedGlobalState.get, DURABLE_STORAGE_VERSION_KEY);
    sinon.assert.notCalled(executeMigrationsStub);
    sinon.assert.notCalled(stubbedGlobalState.update);
  });

  it(`migrate*() for secrets should call executeMigrations() when storage version is incorrect`, async () => {
    // stub the storage version returned
    const storedVersion = 1;
    const stubbedSecretStorage: StubbedSecretStorage = await getStubbedSecretStorage(sandbox);
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

  it(`migrate*() for secrets should not call executeMigrations() when storage version is correct`, async () => {
    // stub the correct storage version returned
    const stubbedSecretStorage: StubbedSecretStorage = await getStubbedSecretStorage(sandbox);
    stubbedSecretStorage.get.resolves(CODEBASE_STORAGE_VERSION);

    await migrateSecretStorage();

    sinon.assert.calledOnceWithExactly(stubbedSecretStorage.get, DURABLE_STORAGE_VERSION_KEY);
    sinon.assert.notCalled(executeMigrationsStub);
    sinon.assert.notCalled(stubbedSecretStorage.store);
  });
});
