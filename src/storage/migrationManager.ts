// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { ExtensionContext, SecretStorage } from "vscode";
import { Logger } from "../logging";
import { DURABLE_STORAGE_VERSION_KEY, MigrationStorageType } from "./constants";
import { executeMigrations } from "./migrations/utils";
import { GlobalState, WorkspaceState } from "./types";
import { clearWorkspaceState, getGlobalState, getSecretStorage, getWorkspaceState } from "./utils";

/**
 * The current storage version for the extension, set in global state, workspace state, and
 * {@link SecretStorage} after migrations are run during extension activation.
 *
 * This should be incremented whenever a breaking change is made to the {@link ExtensionContext}'s
 * `globalState`, `workspaceState`, or {@link SecretStorage} data structures.
 */
export const CODEBASE_STORAGE_VERSION = 2;

const logger = new Logger("storage.migrationManager");

export async function migrateStorageIfNeeded(): Promise<void> {
  // TEMPORARY: clear workspace state every time since there isn't anything that must be persisted
  // between sessions (yet)
  await clearWorkspaceState();
  // handle global/workspace state + secret storage migrations and setting the new storage version
  await Promise.all([migrateGlobalState(), migrateWorkspaceState(), migrateSecretStorage()]);
}

/** Check the storage version in **global state**, then migrate if necessary. */
export async function migrateGlobalState(): Promise<void> {
  const globalState: GlobalState = getGlobalState();
  const globalStorageVersion: number | undefined = globalState.get(DURABLE_STORAGE_VERSION_KEY);
  if (globalStorageVersion !== CODEBASE_STORAGE_VERSION) {
    logger.debug(
      `global storage version is incorrect: "${globalStorageVersion}", should be "${CODEBASE_STORAGE_VERSION}"`,
    );
    await executeMigrations(
      globalStorageVersion,
      CODEBASE_STORAGE_VERSION,
      MigrationStorageType.GLOBAL,
    );
    await globalState.update(DURABLE_STORAGE_VERSION_KEY, CODEBASE_STORAGE_VERSION);
    logger.debug(`global storage version set to "${CODEBASE_STORAGE_VERSION}"`);
  } else {
    logger.debug(`global storage version is correct: "${globalStorageVersion}"`);
  }
}

/** Check the storage version in **workspace state**, then migrate if necessary. */
export async function migrateWorkspaceState(): Promise<void> {
  const workspaceState: WorkspaceState = getWorkspaceState();
  const workspaceStorageVersion: number | undefined = workspaceState.get(
    DURABLE_STORAGE_VERSION_KEY,
  );
  if (workspaceStorageVersion !== CODEBASE_STORAGE_VERSION) {
    logger.debug(
      `workspace storage version is incorrect: "${workspaceStorageVersion}", should be "${CODEBASE_STORAGE_VERSION}"`,
    );
    await executeMigrations(
      workspaceStorageVersion,
      CODEBASE_STORAGE_VERSION,
      MigrationStorageType.WORKSPACE,
    );
    await workspaceState.update(DURABLE_STORAGE_VERSION_KEY, CODEBASE_STORAGE_VERSION);
    logger.debug(`workspace storage version set to "${CODEBASE_STORAGE_VERSION}"`);
  } else {
    logger.debug(`workspace storage version is correct: ${workspaceStorageVersion}`);
  }
}

/** Check the storage version in **secret storage**, then migrate if necessary. */
export async function migrateSecretStorage(): Promise<void> {
  const secretStorage: SecretStorage = getSecretStorage();
  const secretStorageVersion: string | undefined = await secretStorage.get(
    DURABLE_STORAGE_VERSION_KEY,
  );
  if (String(secretStorageVersion) !== String(CODEBASE_STORAGE_VERSION)) {
    logger.debug(
      `secret storage version is incorrect: "${secretStorageVersion}", should be "${CODEBASE_STORAGE_VERSION}"`,
    );
    await executeMigrations(
      Number(secretStorageVersion),
      CODEBASE_STORAGE_VERSION,
      MigrationStorageType.SECRET,
    );
    logger.debug(`trying to store secret storage version to "${CODEBASE_STORAGE_VERSION}"`);
    await secretStorage.store(DURABLE_STORAGE_VERSION_KEY, String(CODEBASE_STORAGE_VERSION));
    logger.debug(`secret storage version set to "${CODEBASE_STORAGE_VERSION}"`);
  } else {
    logger.debug(`secret storage version is correct: "${secretStorageVersion}"`);
  }
}
