import { StorageManager } from ".";
import { Logger } from "../logging";

// Define the current storage version for the extension. This should be incremented whenever a
// breaking change is made to the storage format.
const CODEBASE_STORAGE_VERSION = 1;
const DURABLE_STORAGE_VERSION_KEY = "storageVersion";

const logger = new Logger("storage.migrationManager");

/**
 * Drive migrations of either global or workspace state as needed at startup time.
 */
export async function migrateStorageIfNeeded(manager: StorageManager): Promise<void> {
  // While in EA, just blow away the storage every time. We don't want to deal with migrations
  // yet, and there's nothing critical in the extension right now that depends on persisted state
  // across extension reloads.
  await manager.clearGlobalState();
  await manager.clearWorkspaceState();

  // But when we do want to start migrating storage, we can use the following logic to check the
  // current storage version and migrate as needed.
  const globalStorageVersion = await manager.getGlobalState<number>(DURABLE_STORAGE_VERSION_KEY);
  if (globalStorageVersion !== CODEBASE_STORAGE_VERSION) {
    logger.info(
      `Migrating global storage from ${globalStorageVersion} to ${CODEBASE_STORAGE_VERSION}`,
    );

    // Add global migration logic here. Have fun with that.

    // Stamp current global state
    await manager.setGlobalState(DURABLE_STORAGE_VERSION_KEY, CODEBASE_STORAGE_VERSION);
  }

  // also check workspace state for storage versioning. This may be first time running the extension
  // in this workspace in quite some time.
  const workspaceStorageVersion = await manager.getWorkspaceState<number>(
    DURABLE_STORAGE_VERSION_KEY,
  );
  if (workspaceStorageVersion !== CODEBASE_STORAGE_VERSION) {
    logger.info(
      `Migrating workspace storage from ${workspaceStorageVersion} to ${CODEBASE_STORAGE_VERSION}`,
    );

    // Add workspace migration logic here. Have fun with that.

    // Stamp current workspace state
    await manager.setWorkspaceState(DURABLE_STORAGE_VERSION_KEY, CODEBASE_STORAGE_VERSION);
  }
}
