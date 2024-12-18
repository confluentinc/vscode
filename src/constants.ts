import { extensions } from "vscode";
import { ConnectionSpec } from "./clients/sidecar";
import { ConnectionId } from "./models/resource";

export const EXTENSION_ID = "confluentinc.vscode-confluent";
/** The version of the extension, as defined in package.json. */
export const EXTENSION_VERSION: string = extensions.getExtension(EXTENSION_ID)!.packageJSON.version;

/**
 * Ids to use with ThemeIcons for different Confluent/Kafka resources
 * @see https://code.visualstudio.com/api/references/icons-in-labels
 * @remarks Any custom icon IDs must match the `contributes.icons` section of package.json.
 */
export enum IconNames {
  APACHE_KAFKA_LOGO = "apache-kafka",
  CURRENT_RESOURCE = "check",
  CONNECTION = "plug",
  ORGANIZATION = "account",
  CONFLUENT_LOGO = "confluent-logo",
  CCLOUD_ENVIRONMENT = "confluent-environment",
  KAFKA_CLUSTER = "confluent-kafka-cluster",
  LOCAL_RESOURCE_GROUP = "device-desktop",
  SCHEMA_REGISTRY = "confluent-schema-registry",
  SCHEMA = "primitive-square",
  KEY_SUBJECT = "key",
  VALUE_SUBJECT = "symbol-object",
  OTHER_SUBJECT = "question",
  TOPIC = "confluent-topic",
  TOPIC_WITHOUT_SCHEMA = "confluent-topic-without-schema",
  EXPERIMENTAL = "beaker",
}

export const DIFFABLE_READONLY_SCHEME = "confluent.resource";

// must match the `contributes.authentication` ID in package.json
export const AUTH_PROVIDER_ID = "confluent-cloud-auth-provider";
/** This is what appears in "Sign in with <label> to use Confluent" from the Accounts action. */
export const AUTH_PROVIDER_LABEL = "Confluent Cloud";

/** Single CCloud connection spec to be used with the sidecar Connections API. */
export const CCLOUD_CONNECTION_SPEC: ConnectionSpec = {
  id: "vscode-confluent-cloud-connection",
  name: "Confluent Cloud",
  type: "CCLOUD",
};
// these two avoid the need to use `CCLOUD_CONNECTION_SPEC.id!` or `CCLOUD_CONNECTION_SPEC.name!`
// everywhere in the codebase
export const CCLOUD_CONNECTION_ID = CCLOUD_CONNECTION_SPEC.id! as ConnectionId;
export const CCLOUD_CONNECTION_NAME = CCLOUD_CONNECTION_SPEC.name!;

/** Single local connection spec to be used with the sidecar Connections API. */
export const LOCAL_CONNECTION_SPEC: ConnectionSpec = {
  id: "vscode-local-connection",
  name: "Local",
  type: "LOCAL",
};
// these two avoid the need to use `LOCAL_CONNECTION_SPEC.id!` or `LOCAL_CONNECTION_SPEC.name!`
// everywhere in the codebase
export const LOCAL_CONNECTION_ID = LOCAL_CONNECTION_SPEC.id! as ConnectionId;
export const LOCAL_CONNECTION_NAME = LOCAL_CONNECTION_SPEC.name!;
/** The port used for the local Kafka REST proxy. Used by the extension during container creation,
 * and by the sidecar for local Kafka discovery. */
export const LOCAL_KAFKA_REST_PORT = 8082; // TODO: make this configurable once the sidecar supports it
/** The name of the "local" {@link Environment} manageable by the extension via Docker. */
export const LOCAL_ENVIRONMENT_NAME = "Local"; // not shown anywhere currently
