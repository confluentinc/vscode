import { Logger } from "../../logging";
import { MigrationStorageType } from "../constants";

export abstract class BaseMigration {
  abstract readonly version: number;

  logger = new Logger("storage.migrations");

  async run(isUpgrade: boolean = true, storageType: MigrationStorageType): Promise<void> {
    const logMsg = `${storageType} storage to version "${isUpgrade ? this.version : this.version - 1}"`;

    this.logger.debug(`${isUpgrade ? "upgrading" : "downgrading"} ${logMsg}...`);
    try {
      switch (storageType) {
        case MigrationStorageType.GLOBAL:
          await (isUpgrade ? this.upgradeGlobalState() : this.downgradeGlobalState());
          break;
        case MigrationStorageType.WORKSPACE:
          await (isUpgrade ? this.upgradeWorkspaceState() : this.downgradeWorkspaceState());
          break;
        case MigrationStorageType.SECRET:
          await (isUpgrade ? this.upgradeSecretStorage() : this.downgradeSecretStorage());
          break;
        default:
          throw new Error(`Unknown storage type: ${storageType}`);
      }
      this.logger.debug(`successfully ${isUpgrade ? "upgraded" : "downgraded"} ${logMsg}`);
    } catch (e) {
      if (e instanceof Error) {
        this.logger.error(
          `error ${isUpgrade ? "upgrading" : "downgrading"} ${logMsg}: ${e.message}`,
        );
      }
    }
  }

  // default no-op implementations, to be overridden by subclasses as needed
  protected async upgradeGlobalState(): Promise<void> {}
  protected async upgradeWorkspaceState(): Promise<void> {}
  protected async upgradeSecretStorage(): Promise<void> {}
  protected async downgradeGlobalState(): Promise<void> {}
  protected async downgradeWorkspaceState(): Promise<void> {}
  protected async downgradeSecretStorage(): Promise<void> {}
}
