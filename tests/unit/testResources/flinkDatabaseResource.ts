import { ConnectionType } from "../../../src/connections";
import { CCLOUD_CONNECTION_ID } from "../../../src/constants";
import { IconNames } from "../../../src/icons";
import type { FlinkDatabaseResource } from "../../../src/models/flinkDatabaseResource";
import {
  TEST_CCLOUD_ENVIRONMENT_ID,
  TEST_CCLOUD_PROVIDER,
  TEST_CCLOUD_REGION,
} from "./environments";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "./kafkaCluster";

/**
 * Create a general-purpose {@link FlinkDatabaseResource} object.
 * This will return only the core/shared properties of the database resource types to help test
 * the {@link FlinkDatabaseResourceContainer} class.
 */
export function createFakeFlinkDatabaseResource(
  options?: Partial<Omit<FlinkDatabaseResource, "connectionId" | "connectionType">>,
): FlinkDatabaseResource {
  return {
    // these won't change until we support other connection types:
    connectionId: CCLOUD_CONNECTION_ID,
    connectionType: ConnectionType.Ccloud,
    // database details:
    environmentId: options?.environmentId ?? TEST_CCLOUD_ENVIRONMENT_ID,
    provider: options?.provider ?? TEST_CCLOUD_PROVIDER,
    region: options?.region ?? TEST_CCLOUD_REGION,
    databaseId: options?.databaseId ?? TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER.id,
    // base resource details:
    id: options?.id ?? "Resource1",
    name: options?.name ?? "Test Resource",
    iconName: options?.iconName ?? IconNames.PLACEHOLDER,
    searchableText: options?.searchableText ?? (() => ""),
  };
}
