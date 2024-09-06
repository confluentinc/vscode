import { ResponseError, SubjectsV1Api } from "../clients/schemaRegistryRest";
import { Logger } from "../logging";
import { SchemaRegistryCluster } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import { getSidecar } from "../sidecar";
import { getResourceManager } from "../storage/resourceManager";

const logger = new Logger("authz.schemaRegistry");

export async function canAccessSchemaForTopic(topic: KafkaTopic): Promise<boolean> {
  // even if the topic only has one schema type or the other, we'll see a 403 if we can't access
  // across both (key & value subject) request responses
  // NOTE: if the subject doesn't follow the TopicNameStrategy, we won't be able to track it via
  // other extension features
  const [keyAccess, valueAccess] = await Promise.all([
    canAccessSchemaTypeForTopic(topic, "key"),
    canAccessSchemaTypeForTopic(topic, "value"),
  ]);
  return keyAccess || valueAccess;
}

export async function canAccessSchemaTypeForTopic(
  topic: KafkaTopic,
  type: "key" | "value",
): Promise<boolean> {
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
    const schemaResp = await client.lookUpSchemaUnderSubject({
      subject: `${topic.name}-${type}`,
      RegisterSchemaRequest: {},
    });
    logger.debug("successfully looked up schema for topic", {
      schemaResp: schemaResp,
      topic: topic,
    });
    return true;
  } catch (error) {
    if (error instanceof ResponseError) {
      return await determineAccessFromResponseError(error.response);
    } else {
      logger.error("error making lookupSchemaUnderSubject request:", error);
    }
    return false;
  }
}

async function determineAccessFromResponseError(response: Response): Promise<boolean> {
  const body = await response.json();
  logger.error("error response looking up subject:", body);
  switch (response.status) {
    case 401:
      // unauthorized
      return false;
    case 403:
      // forbidden
      return false;
    case 404:
      {
        // not found
        if (body.error_code === 40401) {
          // "Subject '...' not found" = no schema(s) for the topic
          return true;
        } else if (body.error_code === 40403) {
          // "Schema not found" = schema exists but this endpoint can't get it (???)
          return true;
        }
      }
      break;
    default:
      // unknown error
      return false;
  }

  return false;
}
