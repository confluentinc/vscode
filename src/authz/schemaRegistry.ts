import { TokenManager } from "../authn/oauth2/tokenManager";
import { TARGET_SR_CLUSTER_HEADER } from "../constants";
import { SCHEMA_RBAC_WARNINGS_ENABLED } from "../extensionSettings/constants";
import { CCloudResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { isCCloud } from "../models/resource";
import type { KafkaTopic } from "../models/topic";
import { showWarningNotificationWithButtons } from "../notifications";
import { HttpError } from "../proxy/httpClient";
import { SchemaRegistryProxy } from "../proxy/schemaRegistryProxy";

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

  // Get the data plane token for Schema Registry access
  const token = await TokenManager.getInstance().getDataPlaneToken();
  if (!token) {
    logger.warn("No data plane token available for schema access check; assuming no access");
    return false;
  }

  // Build the subject name using TopicNameStrategy
  const subjectName = `${topic.name}-${type}`;

  // Create a Schema Registry proxy to check subject access
  // CCloud Schema Registry requires target-sr-cluster header for routing
  const proxy = new SchemaRegistryProxy({
    baseUrl: schemaRegistry.uri,
    auth: {
      type: "bearer",
      token,
    },
    headers: {
      [TARGET_SR_CLUSTER_HEADER]: schemaRegistry.id,
    },
  });

  try {
    // Try to list versions for the subject
    // If successful, user has access
    // If 404, subject doesn't exist (access granted, just no schema)
    // If 401/403, user doesn't have access
    await proxy.listVersions(subjectName);
    logger.debug("User has access to schema subject", { subject: subjectName });
    return true;
  } catch (error) {
    if (error instanceof HttpError) {
      // Determine access based on error response
      return determineAccessFromHttpError(error, subjectName);
    }

    // Unexpected error - log and assume no access for safety
    logger.warn("Unexpected error checking schema access", { subject: subjectName, error });
    return false;
  }
}

/**
 * Determines schema access based on an HttpError response.
 * @param error The HttpError from the Schema Registry API.
 * @param subjectName The subject name being checked.
 * @returns true if access is granted (including when subject doesn't exist), false otherwise.
 */
function determineAccessFromHttpError(error: HttpError, subjectName: string): boolean {
  // Parse the error response body if available
  const errorData = error.data as { error_code?: number; message?: string } | undefined;
  const errorCode = errorData?.error_code;

  logger.debug("Schema Registry error response", {
    subject: subjectName,
    status: error.status,
    errorCode,
  });

  // 40401 = Subject not found (access granted, just no schema for this topic)
  // 40403 = Schema not found (similar to above)
  if (errorCode === 40401 || errorCode === 40403) {
    logger.debug("Subject not found - user has access but no schema exists", {
      subject: subjectName,
    });
    return true;
  }

  // 404 without specific error code - treat as subject not found
  if (error.status === 404) {
    logger.debug("404 response - subject likely does not exist", { subject: subjectName });
    return true;
  }

  // 401/403 or error code 40301 = User is denied access
  if (error.status === 401 || error.status === 403 || errorCode === 40301) {
    logger.debug("User is denied access to schema subject", { subject: subjectName });
    return false;
  }

  // Other errors - assume no access for safety
  logger.warn("Unexpected Schema Registry error; assuming no access", {
    subject: subjectName,
    status: error.status,
    errorCode,
  });
  return false;
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

  void showWarningNotificationWithButtons(
    "You do not have permission to access schema(s) for this topic. Messages will still appear, but may not be deserializeable.",
    { "Don't Show Again": async () => await SCHEMA_RBAC_WARNINGS_ENABLED.update(false, true) },
  );
}
