import { Logger } from "../../logging";
import { DirectConnectionsById, getResourceManager } from "../resourceManager";
import { BaseMigration } from "./base";

const logger = new Logger("storage.migrations.v2");

export class MigrationV2 extends BaseMigration {
  readonly version = 2;

  /**
   * V1 to V2:
   * - Add `ssl` defaults to ConnectionSpecs' `kafka_cluster` and `schema_registry` configs based on
   *  the `formConnectionType` field.
   */
  async upgradeSecretStorage(): Promise<void> {
    const rm = getResourceManager();

    // direct connection `ssl` defaults: `enabled` if `formConnectionType` is "Confluent Cloud"
    const connectionSpecs: DirectConnectionsById = await rm.getDirectConnections();
    const connectionSpecUpdates: Promise<void>[] = [];
    for (const spec of connectionSpecs.values()) {
      if (spec.kafka_cluster && spec.kafka_cluster.ssl === undefined) {
        spec.kafka_cluster.ssl = { enabled: spec.formConnectionType === "Confluent Cloud" };
      }
      if (spec.schema_registry && spec.schema_registry.ssl === undefined) {
        spec.schema_registry.ssl = { enabled: spec.formConnectionType === "Confluent Cloud" };
      }
      connectionSpecUpdates.push(rm.addDirectConnection(spec));
    }

    if (connectionSpecUpdates.length > 0) {
      logger.debug(`Adding 'ssl' defaults to ${connectionSpecUpdates.length} ConnectionSpec(s)`);
      await Promise.all(connectionSpecUpdates);
    } else {
      logger.debug("No ConnectionSpecs to upgrade");
    }
  }

  /**
   * V2 to V1:
   * - Remove `ssl` fields from ConnectionSpecs' `kafka_cluster` and `schema_registry` configs.
   */
  async downgradeSecretStorage(): Promise<void> {
    const rm = getResourceManager();

    const connectionSpecs: DirectConnectionsById = await rm.getDirectConnections();
    const connectionSpecUpdates: Promise<void>[] = [];
    for (const spec of connectionSpecs.values()) {
      if (spec.kafka_cluster && spec.kafka_cluster.ssl !== undefined) {
        delete spec.kafka_cluster.ssl;
      }
      if (spec.schema_registry && spec.schema_registry.ssl !== undefined) {
        delete spec.schema_registry.ssl;
      }
      connectionSpecUpdates.push(rm.addDirectConnection(spec));
    }

    if (connectionSpecUpdates.length > 0) {
      logger.debug(
        `Removing 'ssl' defaults from ${connectionSpecUpdates.length} ConnectionSpec(s)`,
      );
      await Promise.all(connectionSpecUpdates);
    } else {
      logger.debug("No ConnectionSpecs to downgrade");
    }
  }
}
