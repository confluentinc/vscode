import { toKafkaTopicOperations } from "../authz/types";
import { ResponseError, TopicData, TopicDataList, TopicV3Api } from "../clients/kafkaRest";
import { Schema as ResponseSchema, SubjectsV1Api } from "../clients/schemaRegistryRest";
import { Logger } from "../logging";
import { KafkaCluster } from "../models/kafkaCluster";
import { Schema, SchemaType, Subject, subjectMatchesTopicName } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { getSidecar } from "../sidecar";
import { executeInWorkerPool, extract } from "../utils/workerPool";

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
 * and set whether or not each topic has a matching schema by subject.
 */
export function correlateTopicsWithSchemaSubjects(
  cluster: KafkaCluster,
  topicsRespTopics: TopicData[],
  subjects: Subject[],
): KafkaTopic[] {
  const topics: KafkaTopic[] = topicsRespTopics.map((topic) => {
    const matchingSubjects: Subject[] = subjects.filter((subject) =>
      subjectMatchesTopicName(subject.name, topic.topic_name),
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
      hasSchema: matchingSubjects.length > 0,
      operations: toKafkaTopicOperations(topic.authorized_operations!),
      children: matchingSubjects,
    });
  });

  return topics;
}

/**
 * Fetch all of the subjects in the schema registry and return them as an array of sorted Subject objects.
 * Does not store into the resource manager.
 */
export async function fetchSubjects(schemaRegistry: SchemaRegistry): Promise<Subject[]> {
  const sidecarHandle = await getSidecar();
  const client: SubjectsV1Api = sidecarHandle.getSubjectsV1Api(
    schemaRegistry.id,
    schemaRegistry.connectionId,
  );

  // Fetch + sort the subject strings from the SR.
  const sortedSubjectStrings: string[] = (await client.list()).sort((a, b) => a.localeCompare(b));

  // Promote to Subject objects carrying the schema registry's metadata.
  return sortedSubjectStrings.map(
    (subjectString) =>
      new Subject(
        subjectString,
        schemaRegistry.connectionId,
        schemaRegistry.environmentId,
        schemaRegistry.id,
      ),
  );
}

/**
 * Given a schema registry and a subject, fetch the versions available, then fetch the details
 * of each version and return them as an array of {@link Schema}.
 *
 * The returned array of schema metadata concerning a a single subject is called a "subject group".
 *
 * @returns An array of all the schemas for the subject in the schema registry, sorted descending by version.
 */
export async function fetchSchemaSubjectGroup(
  schemaRegistry: SchemaRegistry,
  subject: string,
): Promise<Schema[]> {
  const sidecarHandle = await getSidecar();
  const client: SubjectsV1Api = sidecarHandle.getSubjectsV1Api(
    schemaRegistry.id,
    schemaRegistry.connectionId,
  );

  // Learn all of the live version numbers for the subject in one round trip.
  const versions: number[] = await client.listVersions({ subject });

  // Reverse sort versions to get the highest version first. This will then
  // become the order of the returned array of Schema.
  versions.sort((a, b) => b - a);

  // Now prep to fetch each of the versions concurrently via concurrent
  // calls to fetchSchemaVersion() driven by executeInWorkerPool().
  const highestVersion = Math.max(...versions);
  const concurrentVersionRequests: FetchSchemaVersionParams[] = versions.map(
    (version): FetchSchemaVersionParams => {
      return {
        // The only varying parameter in the concurrent calls/requests is the version number.
        schemaRegistry: schemaRegistry,
        client: client,
        subject: subject,
        version: version,
        highestVersion: highestVersion,
      };
    },
  );

  // Fetch all versions concurrently capped at 5 concurrent requests at a time.
  const concurrentFetchResults = await executeInWorkerPool(
    fetchSchemaVersion,
    concurrentVersionRequests,
    {
      maxWorkers: 5,
    },
  );

  // Filter the executeInWorkerPool() return for successful results and return the schemas.
  // If any single request failed, fail the whole operation.
  return extract(concurrentFetchResults);
}

/** Interface describing a bundle of params needed for call to {@link fetchSchemaVersion} */
interface FetchSchemaVersionParams {
  schemaRegistry: SchemaRegistry;
  client: SubjectsV1Api;
  subject: string;
  version: number;
  highestVersion: number;
}

/** Hit the /subjects/{subject}/versions/{version} route, returning a Schema model. */
export async function fetchSchemaVersion(params: FetchSchemaVersionParams): Promise<Schema> {
  const responseSchema: ResponseSchema = await params.client.getSchemaByVersion({
    subject: params.subject,
    version: params.version.toString(),
  });

  // Convert the response schema to a Schema model. Discards the returned schema document, sigh. We're
  // only interested in the metadata.
  const schemaRegistry = params.schemaRegistry;
  return Schema.create({
    // Fields copied from the SR ...
    connectionId: schemaRegistry.connectionId,
    connectionType: schemaRegistry.connectionType,
    schemaRegistryId: schemaRegistry.id,
    environmentId: schemaRegistry.environmentId,

    // Fields specific to this single schema subject binding.
    id: responseSchema.id!.toString(),
    subject: responseSchema.subject!,
    version: responseSchema.version!,
    // AVRO doesn't show up in `schemaType`
    // https://docs.confluent.io/platform/current/schema-registry/develop/api.html#get--subjects-(string-%20subject)-versions-(versionId-%20version)
    type: (responseSchema.schemaType as SchemaType) || SchemaType.Avro,
    isHighestVersion: responseSchema.version === params.highestVersion,
  });
}
