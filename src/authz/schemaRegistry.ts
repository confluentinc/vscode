import { ResponseError, SubjectsV1Api } from "../clients/schemaRegistryRest";
import { Logger } from "../logging";
import { SchemaRegistryCluster } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { getSidecar } from "../sidecar";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("authz.schemaRegistry");

export async function canAccessSchemaForTopic(topic: KafkaTopic): Promise<boolean> {
  if (!topic.environmentId) {
    // no way of checking local topic schemas currently
    return true;
  }

  const environmentId: string = topic.environmentId;
  const schemaRegistry: SchemaRegistryCluster | null =
    await getResourceManager().getCCloudSchemaRegistryCluster(environmentId);
  if (!schemaRegistry) {
    logger.debug(
      "no Schema Registry cluster in extension state matching CCloud topic's environment ID; assuming user can access (non-existent) schemas",
      { environmentId },
    );
    // if we had schemas, we would have a schema registry
    return true;
  }

  const sidecar = await getSidecar();
  // we don't use the SchemasV1Api because it's either going to list all schemas or require a schema
  // ID, which we don't have
  const client: SubjectsV1Api = sidecar.getSubjectsV1Api(
    schemaRegistry.id,
    schemaRegistry.connectionId,
  );

  // this will either raise ResponseErrors or pass
  try {
    const [keySchema, valueSchema] = await Promise.all([
      // even if the topic only has one schema type or the other, we'll see a 403 if we can't access
      // across both (key & value subject) request responses
      // NOTE: if the subject doesn't follow the TopicNameStrategy, we won't be able to track it via
      // other extension features
      client.lookUpSchemaUnderSubject({
        subject: `${topic.name}-key`,
        RegisterSchemaRequest: {},
      }),
      client.lookUpSchemaUnderSubject({
        subject: `${topic.name}-value`,
        RegisterSchemaRequest: {},
      }),
    ]);
    logger.debug("successfully looked up schemas for topic", {
      keySchema: keySchema,
      valueSchema: valueSchema,
      topic: topic,
    });
    return true;
  } catch (error) {
    if (error instanceof ResponseError) {
      const body = await error.response.json();
      logger.error("error response looking up subject:", body);
    } else {
      logger.error("error making lookupSchemaUnderSubject request:", error);
    }
    return false;
  }
}
