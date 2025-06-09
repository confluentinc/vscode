// import future migration versions here
import { BaseMigration } from "./base";
import { MigrationV2 } from "./v2";

/** Mapping of storage version numbers to migration class instances. */
export const migrations: Record<number, BaseMigration> = {
  // 1 doesn't exist since there is no undefined<->1 migration
  2: new MigrationV2(),
  // add future storage versions here
};

/** Ordered list of migration version numbers. */
export const migrationVersions: number[] = Object.keys(migrations)
  .map(Number)
  .sort((a, b) => a - b);
