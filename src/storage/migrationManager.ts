import { StorageManager } from ".";
import { Logger } from "../logging";
import { DURABLE_STORAGE_VERSION_KEY, MigrationStorageType } from "./constants";
import { BaseMigration } from "./migrations/base";
import { migrations, migrationVersions } from "./migrations/registry";

// The current storage version for the extension, set in global state, workspace state, and
// SecretStorage after migrations are run during extension activation.
// ---
// This should be incremented whenever a breaking change is made to the global/workspace state or
// SecretStorage data structures.
const CODEBASE_STORAGE_VERSION = 2;

const logger = new Logger("storage.migrationManager");

export async function migrateStorageIfNeeded(manager: StorageManager): Promise<void> {
  // TEMPORARY: clear workspace state every time since there isn't anything that must be persisted
  // between sessions (yet)
  await manager.clearWorkspaceState();

  // handle global/workspace state + secret storage migrations and setting the new storage version
  await Promise.all([
    migrateGlobalState(manager),
    migrateWorkspaceState(manager),
    migrateSecretStorage(manager),
  ]);
}

/** Check the storage version in **global state**, then migrate if necessary. */
async function migrateGlobalState(manager: StorageManager): Promise<void> {
  const globalStorageVersion = await manager.getGlobalState<number>(DURABLE_STORAGE_VERSION_KEY);
  if (globalStorageVersion !== CODEBASE_STORAGE_VERSION) {
    logger.debug(
      `global storage version is incorrect: "${globalStorageVersion}", should be "${CODEBASE_STORAGE_VERSION}"`,
    );
    await executeMigrations(globalStorageVersion, CODEBASE_STORAGE_VERSION, "global");
    manager.setGlobalState(DURABLE_STORAGE_VERSION_KEY, CODEBASE_STORAGE_VERSION);
  } else {
    logger.debug(`global storage storage version is correct: "${globalStorageVersion}"`);
  }
}

/** Check the storage version in **workspace state**, then migrate if necessary. */
async function migrateWorkspaceState(manager: StorageManager): Promise<void> {
  const workspaceStorageVersion = await manager.getWorkspaceState<number>(
    DURABLE_STORAGE_VERSION_KEY,
  );
  if (workspaceStorageVersion !== CODEBASE_STORAGE_VERSION) {
    logger.debug(
      `workspace storage version is incorrect: "${workspaceStorageVersion}", should be "${CODEBASE_STORAGE_VERSION}"`,
    );
    await executeMigrations(workspaceStorageVersion, CODEBASE_STORAGE_VERSION, "workspace");
    manager.setWorkspaceState(DURABLE_STORAGE_VERSION_KEY, CODEBASE_STORAGE_VERSION);
  } else {
    logger.debug(`workspace storage storage version is correct: v${workspaceStorageVersion}`);
  }
}

/** Check the storage version in **secret storage**, then migrate if necessary. */
async function migrateSecretStorage(manager: StorageManager): Promise<void> {
  const secretStorageVersion: string | undefined = await manager.getSecret(
    DURABLE_STORAGE_VERSION_KEY,
  );
  if (secretStorageVersion !== String(CODEBASE_STORAGE_VERSION)) {
    logger.debug(
      `secret storage version is incorrect: "${secretStorageVersion}", should be "${CODEBASE_STORAGE_VERSION}"`,
    );
    await executeMigrations(Number(secretStorageVersion), CODEBASE_STORAGE_VERSION, "secret");
    manager.setSecret(DURABLE_STORAGE_VERSION_KEY, String(CODEBASE_STORAGE_VERSION));
  } else {
    logger.debug(`secret storage version is correct: "${secretStorageVersion}"`);
  }
}

/**
 * Determine the migration versions/steps required to move between two storage versions, which may
 * be multiple versions apart.
 */
function getMigrationVersions(
  sourceVersion: number | undefined,
  targetVersion: number,
): {
  versions: number[];
  isUpgrade: boolean;
} {
  // either the source version or the lowest migration version (1)
  const current: number = sourceVersion ?? Math.min(...migrationVersions);
  const isUpgrade = current < targetVersion;
  const versions: number[] = isUpgrade
    ? migrationVersions.filter((v) => v > current && v <= targetVersion)
    : migrationVersions.filter((v) => v <= current && v > targetVersion).reverse();

  return { versions, isUpgrade };
}

/** Execute the necessary migrations to move between two storage versions. */
async function executeMigrations(
  sourceVersion: number | undefined,
  targetVersion: number,
  storageType: MigrationStorageType,
): Promise<void> {
  const { versions, isUpgrade } = getMigrationVersions(sourceVersion, targetVersion);

  for (const version of versions) {
    const migration: BaseMigration = migrations[version];
    if (!migration) {
      continue;
    }
    await migration.run(isUpgrade, storageType);
  }
}
