import { toKafkaTopicOperations } from "../authz/types";
import { ResponseError, TopicData, TopicDataList, TopicV3Api } from "../clients/kafkaRest";
import {
  Schema as ResponseSchema,
  SchemasV1Api,
  SubjectsV1Api,
} from "../clients/schemaRegistryRest";
import { Logger } from "../logging";
import { KafkaCluster } from "../models/kafkaCluster";
import { Schema, SchemaType } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { getSidecar } from "../sidecar";

const logger = new Logger("resourceLoader");

/**
 * Internal functions used by ResourceLoaders.
 *
 * Factored out from resourceLoader.ts to allow for
 * test suite mocking / stubbing.
 */

export class TopicFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TopicFetchError";
  }
}

/**
 * Deep read and return of all topics in a Kafka cluster.
 */
export async function fetchTopics(cluster: KafkaCluster): Promise<TopicData[]> {
  logger.debug(`fetching topics for ${cluster.connectionType} Kafka cluster ${cluster.id}`);

  const sidecar = await getSidecar();
  const client: TopicV3Api = sidecar.getTopicV3Api(cluster.id, cluster.connectionId);
  let topicsResp: TopicDataList;

  try {
    topicsResp = await client.listKafkaTopics({
      cluster_id: cluster.id,
      includeAuthorizedOperations: true,
    });
    logger.debug(
      `fetched ${topicsResp.data.length} topic(s) for ${cluster.connectionType} Kafka cluster ${cluster.id}`,
    );
  } catch (error) {
    if (error instanceof ResponseError) {
      // XXX todo improve this, raise a more specific error type.
      const body = await error.response.json();

      throw new TopicFetchError(JSON.stringify(body));
    } else {
      throw new TopicFetchError(JSON.stringify(error));
    }
  }

  // sort multiple topics by name
  if (topicsResp.data.length > 1) {
    topicsResp.data.sort((a, b) => a.topic_name.localeCompare(b.topic_name));
  }

  return topicsResp.data;
}

/**
 * Convert an array of {@link TopicData} to an array of {@link KafkaTopic}
 * and set whether or not each topic has a matching schema.
 */
export function correlateTopicsWithSchemas(
  cluster: KafkaCluster,
  topicsRespTopics: TopicData[],
  schemas: Schema[],
): KafkaTopic[] {
  const topics: KafkaTopic[] = topicsRespTopics.map((topic) => {
    const hasMatchingSchema: boolean = schemas.some((schema) =>
      schema.matchesTopicName(topic.topic_name),
    );

    return KafkaTopic.create({
      connectionId: cluster.connectionId,
      connectionType: cluster.connectionType,
      name: topic.topic_name,
      is_internal: topic.is_internal,
      replication_factor: topic.replication_factor,
      partition_count: topic.partitions_count,
      partitions: topic.partitions,
      configs: topic.configs,
      clusterId: cluster.id,
      environmentId: cluster.environmentId,
      hasSchema: hasMatchingSchema,
      operations: toKafkaTopicOperations(topic.authorized_operations!),
    });
  });

  return topics;
}

/**
 * Deep read and return of all schemas in a CCloud or local environment's Schema Registry.
 * Does not store into the resource manager.
 *
 * @param schemaRegistry The Schema Registry to fetch schemas from.
 * @returns An array of all the schemas in the environment's Schema Registry.
 */
export async function fetchSchemas(schemaRegistry: SchemaRegistry): Promise<Schema[]> {
  const sidecarHandle = await getSidecar();
  const client: SchemasV1Api = sidecarHandle.getSchemasV1Api(
    schemaRegistry.id,
    schemaRegistry.connectionId,
  );
  const schemaListRespData: ResponseSchema[] = await client.getSchemas();

  // Keep track of the highest version number for each subject to determine if a schema is the latest version,
  // needed for context value setting (only the most recent versions are evolvable, see package.json).
  const subjectToHighestVersion: Map<string, number> = new Map();
  for (const schema of schemaListRespData) {
    const subject = schema.subject!;
    const version = schema.version!;
    if (!subjectToHighestVersion.has(subject) || version > subjectToHighestVersion.get(subject)!) {
      subjectToHighestVersion.set(subject, version);
    }
  }

  const schemas: Schema[] = schemaListRespData.map((schema: ResponseSchema) => {
    // AVRO doesn't show up in `schemaType`
    // https://docs.confluent.io/platform/current/schema-registry/develop/api.html#get--subjects-(string-%20subject)-versions-(versionId-%20version)
    const schemaType = (schema.schemaType as SchemaType) || SchemaType.Avro;
    // casting `id` from number to string to allow returning Schema types in `.getChildren()` above
    return Schema.create({
      connectionId: schemaRegistry.connectionId,
      connectionType: schemaRegistry.connectionType,
      id: schema.id!.toString(),
      subject: schema.subject!,
      version: schema.version!,
      type: schemaType,
      schemaRegistryId: schemaRegistry.id,
      environmentId: schemaRegistry.environmentId,
      isHighestVersion: schema.version === subjectToHighestVersion.get(schema.subject!),
    });
  });
  return schemas;
}

/**
 * Fetch all of the subjects in the schema registry and return them as an array of strings.
 * Does not store into the resource manager.
 */
export async function fetchSubjects(schemaRegistry: SchemaRegistry): Promise<string[]> {
  const sidecarHandle = await getSidecar();
  const client: SubjectsV1Api = sidecarHandle.getSubjectsV1Api(
    schemaRegistry.id,
    schemaRegistry.connectionId,
  );

  return await client.list();
}
