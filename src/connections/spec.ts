/**
 * Connection specification types for configuring connections.
 * These types define the input configuration for creating and managing connections.
 */

import type { Credentials } from "./credentials";
import type { ConnectionId, ConnectionType } from "./types";

/** TLS/SSL configuration for secure connections. */
export interface TLSConfig {
  /** Whether TLS is enabled. */
  enabled: boolean;
  /** Whether to verify the server's hostname against its certificate. */
  verifyHostname?: boolean;
  /** Trust store configuration for server certificate verification. */
  truststore?: TrustStore;
  /** Key store configuration for client certificate (mTLS). */
  keystore?: KeyStore;
}

/** Trust store for server certificate verification. */
export interface TrustStore {
  /** Path to the trust store file. */
  path: string;
  /** Password for the trust store (optional for PEM format). */
  password?: string;
  /** Trust store format type. */
  type?: "JKS" | "PKCS12" | "PEM" | "UNKNOWN";
}

/** Key store for client certificate authentication (mTLS). */
export interface KeyStore {
  /** Path to the key store file. */
  path: string;
  /** Password for the key store (optional for PEM format). */
  password?: string;
  /** Key store format type. */
  type?: "JKS" | "PKCS12" | "PEM" | "UNKNOWN";
  /** Password for the private key (if different from key store password). */
  keyPassword?: string;
}

/** Confluent Cloud-specific configuration. */
export interface CCloudConfig {
  /** Organization ID to use (optional, uses default if absent). */
  organizationId?: string;
  /** IDE OAuth callback URI (used for OAuth redirect). */
  ideAuthCallbackUri?: string;
}

/** Local Docker-based Kafka/Schema Registry configuration. */
export interface LocalConfig {
  /** URL to local Schema Registry (optional, auto-discovered if not specified). */
  schemaRegistryUri?: string;
}

/** Kafka cluster configuration. */
export interface KafkaClusterConfig {
  /** Comma-separated list of bootstrap server host:port pairs. */
  bootstrapServers: string;
  /** Credentials for authentication (optional, null means no auth). */
  credentials?: Credentials;
  /** TLS/SSL configuration (optional, null means use default settings). */
  ssl?: TLSConfig;
  /** Custom client ID suffix (useful for WarpStream or port-forwarding). */
  clientIdSuffix?: string;
}

/** Schema Registry configuration. */
export interface SchemaRegistryConfig {
  /** Schema Registry cluster ID (optional, used for identification). */
  id?: string;
  /** Full URL to Schema Registry endpoint. */
  uri: string;
  /** Credentials for authentication (optional). */
  credentials?: Credentials;
  /** TLS/SSL configuration (optional). */
  ssl?: TLSConfig;
}

/**
 * Connection specification - the input configuration for creating a connection.
 * This is the "spec" part of the Kubernetes-style resource model.
 */
export interface ConnectionSpec {
  /** Unique identifier for the connection. */
  id: ConnectionId;
  /** User-friendly display name. */
  name: string;
  /** Type of connection. */
  type: ConnectionType;

  /** CCloud-specific configuration (for CCLOUD connections). */
  ccloudConfig?: CCloudConfig;

  /** Local configuration (for LOCAL connections). */
  localConfig?: LocalConfig;

  /** Kafka cluster configuration. */
  kafkaCluster?: KafkaClusterConfig;

  /** Schema Registry configuration. */
  schemaRegistry?: SchemaRegistryConfig;
}

/** Form connection type - describes how the user selected the connection type. */
export enum FormConnectionType {
  /** Confluent Cloud connection. */
  CCLOUD = "Confluent Cloud",
  /** Local Kafka/Schema Registry. */
  LOCAL = "Local",
  /** Apache Kafka connection. */
  APACHE_KAFKA = "Apache Kafka",
  /** Other/custom connection type. */
  OTHER = "Other",
}

/**
 * Extended connection spec with form-specific metadata.
 * Used when creating connections from the UI form.
 */
export interface CustomConnectionSpec extends ConnectionSpec {
  /** How the user selected the connection type in the form. */
  formConnectionType?: FormConnectionType;
  /** User's custom type string if "Other" was selected. */
  specifiedConnectionType?: string;
}

/**
 * Creates a default TLS configuration with TLS enabled and hostname verification.
 * @returns Default TLS configuration.
 */
export function defaultTLSConfig(): TLSConfig {
  return {
    enabled: true,
    verifyHostname: true,
  };
}

/**
 * Creates a disabled TLS configuration.
 * @returns TLS configuration with TLS disabled.
 */
export function disabledTLSConfig(): TLSConfig {
  return {
    enabled: false,
  };
}

/**
 * Validates that a connection spec has the required fields for its type.
 * @param spec The connection spec to validate.
 * @returns An array of validation error messages (empty if valid).
 */
export function validateConnectionSpec(spec: ConnectionSpec): string[] {
  const errors: string[] = [];

  if (!spec.id) {
    errors.push("Connection ID is required");
  }
  if (!spec.name || spec.name.trim().length === 0) {
    errors.push("Connection name is required");
  }
  if (!spec.type) {
    errors.push("Connection type is required");
  }

  // Type-specific validation
  if (spec.kafkaCluster) {
    if (
      !spec.kafkaCluster.bootstrapServers ||
      spec.kafkaCluster.bootstrapServers.trim().length === 0
    ) {
      errors.push("Kafka bootstrap servers are required when configuring a Kafka cluster");
    }
  }

  if (spec.schemaRegistry) {
    if (!spec.schemaRegistry.uri || spec.schemaRegistry.uri.trim().length === 0) {
      errors.push("Schema Registry URI is required when configuring a Schema Registry");
    }
  }

  return errors;
}

/**
 * Checks if a connection spec has Kafka cluster configuration.
 * @param spec The connection spec to check.
 * @returns true if the spec has Kafka cluster configuration.
 */
export function hasKafkaCluster(spec: ConnectionSpec): boolean {
  return !!spec.kafkaCluster?.bootstrapServers;
}

/**
 * Checks if a connection spec has Schema Registry configuration.
 * @param spec The connection spec to check.
 * @returns true if the spec has Schema Registry configuration.
 */
export function hasSchemaRegistry(spec: ConnectionSpec): boolean {
  return !!spec.schemaRegistry?.uri;
}

/**
 * Type guard to check if an object is a KafkaClusterConfig.
 * @param obj The object to check.
 * @returns true if the object is a KafkaClusterConfig.
 */
export function instanceOfKafkaClusterConfig(obj: unknown): obj is KafkaClusterConfig {
  if (!obj || typeof obj !== "object") return false;
  const config = obj as KafkaClusterConfig;
  return typeof config.bootstrapServers === "string";
}

/**
 * Type guard to check if an object is a SchemaRegistryConfig.
 * @param obj The object to check.
 * @returns true if the object is a SchemaRegistryConfig.
 */
export function instanceOfSchemaRegistryConfig(obj: unknown): obj is SchemaRegistryConfig {
  if (!obj || typeof obj !== "object") return false;
  const config = obj as SchemaRegistryConfig;
  return typeof config.uri === "string";
}
