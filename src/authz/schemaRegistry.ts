import { ResponseError, SubjectsV1Api } from "../clients/schemaRegistryRest";
import { SCHEMA_RBAC_WARNINGS_ENABLED } from "../extensionSettings/constants";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { isCCloud } from "../models/resource";
import { KafkaTopic } from "../models/topic";
import { showWarningNotificationWithButtons } from "../notifications";
import { getSidecar } from "../sidecar";

const logger = new Logger("authz.schemaRegistry");

export async function canAccessSchemaForTopic(topic: KafkaTopic): Promise<boolean> {
  // even if the topic only has one schema type or the other, we'll see a 403 if we can't access
  // across both (key & value subject) request responses

  // NOTE: if the subject doesn't follow the TopicNameStrategy, we won't be able to track it via
  // other extension features.

  // TopicRecordNameStrategy complicates this, in that those schema
  // subject names aren't  predictable from just the topic name like for TopicNameStrategy.

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
  if (!isCCloud(topic)) {
    // no (current) way of checking DIRECT or LOCAL schema access, so assume true.
    return true;
  }

  const ccloudLoader = CCloudResourceLoader.getInstance();

  const schemaRegistry = await ccloudLoader.getSchemaRegistryForEnvironmentId(topic.environmentId);
  if (!schemaRegistry) {
    logger.debug(
      "no Schema Registry in extension state matching CCloud topic's environment ID; assuming user can access (non-existent) schemas",
      { environmentId: topic.environmentId, topic: topic.name },
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
      const decision = await determineAccessFromResponseError(error.response);
      logger.debug("determined access from response error:", { canAccessSchemas: decision, type });
      return decision;
    } else {
      logger.error("error making lookupSchemaUnderSubject request:", error);
    }
    return false;
  }
}

export async function determineAccessFromResponseError(response: Response): Promise<boolean> {
  let body: any;
  try {
    body = await response.json();
  } catch (error) {
    // maybe some HTML error, treat as if we can't access
    logger.debug("error parsing response body from schema lookup:", error);
    return false;
  }

  logger.debug("error response looking up subject:", body);
  // "Schema not found" = schema exists but this endpoint can't get it (???)
  const schema404 = body.error_code === 40403;
  // "Subject '...' not found" = no schema(s) for the topic
  const noSchema404 = body.error_code === 40401;

  // any other error means the schema can't be accessed for some other reason (401, 403),
  // likely "(40301) User is denied operation Read on Subject: _____"
  return schema404 || noSchema404;
}

/**
 * Show a warning notification if the user doesn't have `READ` access for the Schema Registry
 * cluster and the `confluent.cloud.messageViewer.showSchemaWarningNotifications` setting is enabled.
 * @remarks The notification will show a "Don't Show Again" button that will disable future warnings
 * by updating the setting.
 * */
export function showNoSchemaAccessWarningNotification(): void {
  const warningsEnabled: boolean = SCHEMA_RBAC_WARNINGS_ENABLED.value;
  if (!warningsEnabled) {
    logger.warn("user is missing schema access, but warning notifications are disabled");
    return;
  }

  showWarningNotificationWithButtons(
    "You do not have permission to access schema(s) for this topic. Messages will still appear, but may not be deserializeable.",
    { "Don't Show Again": async () => await SCHEMA_RBAC_WARNINGS_ENABLED.update(false, true) },
  );
}
