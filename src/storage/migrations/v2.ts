import { ExtensionContext } from "vscode";
import { getExtensionContext } from "../../context/extension";
import { Logger } from "../../logging";
import { SecretStorageKeys } from "../constants";
import { mapToString } from "../resourceManager";
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
    const context: ExtensionContext = getExtensionContext();

    // NOTE: we aren't using other helper methods, types, interfaces, etc. here to avoid having to
    // migrate those as well, but the storage key should be fine on its own
    const connectionSpecsStr: string | undefined = await context.secrets.get(
      SecretStorageKeys.DIRECT_CONNECTIONS,
    );
    if (!connectionSpecsStr) {
      logger.debug("no ConnectionSpecs to check for upgrade");
      return;
    }

    // should be a map-like structure of connection ID -> ConnectionSpec
    const connectionSpecs = JSON.parse(connectionSpecsStr);
    if (typeof connectionSpecs !== "object" || connectionSpecs === null) {
      throw new Error("ConnectionSpecs must be an object");
    }

    // copy over existing+updated specs into a new map to write once later
    const updatedConnectionSpecs: Map<string, any> = new Map();
    const specs: any[] = Object.values(connectionSpecs);
    for (const spec of specs) {
      if (typeof spec !== "object" || spec === null || !spec.id) {
        continue;
      }

      // direct connection `ssl` defaults: `enabled` if `formConnectionType` is "Confluent Cloud",
      // defaulting to "true" otherwise (users should be able to adjust this for non-CCloud
      // connections anyway)
      const isCCloud = spec.formConnectionType
        ? spec.formConnectionType === "Confluent Cloud"
        : true;

      if (spec.kafka_cluster && spec.kafka_cluster.ssl === undefined) {
        spec.kafka_cluster.ssl = { enabled: isCCloud };
      }
      if (spec.schema_registry && spec.schema_registry.ssl === undefined) {
        spec.schema_registry.ssl = { enabled: isCCloud };
      }

      updatedConnectionSpecs.set(spec.id, spec);
    }

    if (updatedConnectionSpecs.size > 0) {
      logger.debug(`Adding 'ssl' defaults to ${updatedConnectionSpecs.size} ConnectionSpec(s)`);
      await context.secrets.store(
        SecretStorageKeys.DIRECT_CONNECTIONS,
        mapToString(updatedConnectionSpecs),
      );
    } else {
      logger.debug("No ConnectionSpecs to upgrade");
    }
  }

  /**
   * V2 to V1:
   * - Remove `ssl` fields from ConnectionSpecs' `kafka_cluster` and `schema_registry` configs.
   */
  async downgradeSecretStorage(): Promise<void> {
    const context: ExtensionContext = getExtensionContext();

    // NOTE: we aren't using other helper methods, types, interfaces, etc. here to avoid having to
    // migrate those as well, but the storage key should be fine on its own
    const connectionSpecsStr: string | undefined = await context.secrets.get(
      SecretStorageKeys.DIRECT_CONNECTIONS,
    );
    if (!connectionSpecsStr) {
      logger.debug("no ConnectionSpecs to check for downgrade");
      return;
    }

    // should be a map-like structure of connection ID -> ConnectionSpec
    const connectionSpecs = JSON.parse(connectionSpecsStr);
    if (typeof connectionSpecs !== "object" || connectionSpecs === null) {
      throw new Error("ConnectionSpecs must be an object");
    }

    // copy over existing+updated specs into a new map to write once later
    const updatedConnectionSpecs: Map<string, any> = new Map();
    const specs: any[] = Object.values(connectionSpecs);
    for (const spec of specs) {
      if (typeof spec !== "object" || spec === null || !spec.id) {
        continue;
      }

      if (spec.kafka_cluster && spec.kafka_cluster.ssl !== undefined) {
        delete spec.kafka_cluster.ssl;
      }
      if (spec.schema_registry && spec.schema_registry.ssl !== undefined) {
        delete spec.schema_registry.ssl;
      }

      updatedConnectionSpecs.set(spec.id, spec);
    }

    if (updatedConnectionSpecs.size > 0) {
      logger.debug(`Removing 'ssl' defaults from ${updatedConnectionSpecs.size} ConnectionSpec(s)`);
      await context.secrets.store(
        SecretStorageKeys.DIRECT_CONNECTIONS,
        mapToString(updatedConnectionSpecs),
      );
    } else {
      logger.debug("No ConnectionSpecs to downgrade");
    }
  }
}
