// same as in src/clients/sidecar/models/ConnectionType.ts
export enum ConnectionType {
  Local = "LOCAL",
  Ccloud = "CCLOUD",
  Direct = "DIRECT",
}

// same as src/directConnections/types.ts
export enum FormConnectionType {
  ApacheKafka = "Apache Kafka",
  ConfluentCloud = "Confluent Cloud",
  ConfluentPlatform = "Confluent Platform",
  WarpStream = "WarpStream",
  Other = "Other",
}
export enum SupportedAuthType {
  None = "None",
  Basic = "Basic",
  API = "API",
  SCRAM = "SCRAM",
  OAuth = "OAuth",
  Kerberos = "Kerberos",
}

/** Base requirements for Kafka and/or Schema Registry configurations. */
interface DirectConnectionConfig {
  authType: SupportedAuthType;
  credentials: Record<string, any>;
}
export interface DirectConnectionKafkaConfig extends DirectConnectionConfig {
  bootstrapServers: string;
}
export interface DirectConnectionSchemaRegistryConfig extends DirectConnectionConfig {
  uri: string;
}

/** Configuration options for setting up a direct connection. */
export interface DirectConnectionOptions {
  name?: string;
  formConnectionType?: FormConnectionType;
  kafkaConfig?: DirectConnectionKafkaConfig;
  schemaRegistryConfig?: DirectConnectionSchemaRegistryConfig;
}

/** Configuration options for setting up a local connection. */
export interface LocalConnectionOptions {
  schemaRegistry?: boolean;
}
