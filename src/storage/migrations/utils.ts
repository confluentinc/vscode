import type { MigrationStorageType } from "../constants";
import type { BaseMigration } from "./base";
import { migrations, migrationVersions } from "./registry";

/**
 * Determine the migration versions/steps required to move between two storage versions, which may
 * be multiple versions apart.
 */
export function getMigrationVersions(
  sourceVersion: number | undefined,
  targetVersion: number,
): {
  versions: number[];
  isUpgrade: boolean;
} {
  // either the source version or the lowest migration version (2)
  const current: number = sourceVersion ?? Math.min(...migrationVersions);
  const isUpgrade = current < targetVersion;
  const versions: number[] = isUpgrade
    ? migrationVersions.filter((v) => v > current && v <= targetVersion)
    : migrationVersions.filter((v) => v <= current && v > targetVersion).reverse();

  return { versions, isUpgrade };
}

/** Execute the necessary migrations to move between two storage versions. */
export async function executeMigrations(
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
