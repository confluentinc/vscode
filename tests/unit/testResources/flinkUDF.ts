import { FlinkUdf } from "../../../src/models/flinkUDF";
import { CCloudFlinkDbKafkaCluster } from "../../../src/models/kafkaCluster";
import { TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER } from "./kafkaCluster";

/** Make a quick FlinkUDF instance for tests. Defaults to being from TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER. */
export function createFlinkUDF(
  name: string,
  flinkDbCluster: CCloudFlinkDbKafkaCluster = TEST_CCLOUD_FLINK_DB_KAFKA_CLUSTER,
  opts: {
    id?: string;
    description?: string;
    language?: string;
    externalName?: string;
    isDeterministic?: boolean;
    artifactReference?: string;
    kind?: string;
    returnType?: string;
    creationTs?: Date;
  } = {},
): FlinkUdf {
  return new FlinkUdf({
    environmentId: flinkDbCluster.environmentId,
    provider: flinkDbCluster.provider,
    region: flinkDbCluster.region,
    databaseId: flinkDbCluster.id,
    id: opts.id ?? `${name}-1`,
    name: name,
    language: opts.language ?? "JAVA",
    externalName: opts.externalName ?? `com.example.${name}`,
    isDeterministic: opts.isDeterministic ?? true,
    artifactReference: opts.artifactReference ?? "my-artifact:1.0.0",
    kind: opts.kind ?? "SCALAR",
    returnType: opts.returnType ?? "STRING",
    creationTs: opts.creationTs ?? new Date(),
    parameters: [], // for now.
    description: opts.description ?? "description", // for now.
  });
}
