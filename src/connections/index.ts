/**
 * Connection management module.
 *
 * This module provides types and utilities for managing connections to
 * Kafka clusters, Schema Registries, and Confluent Cloud.
 */

// Core types
export {
  ConnectedState,
  ConnectionFromJSON,
  ConnectionType,
  instanceOfConnection,
  isConnectedStateInProgress,
  isConnectedStateTerminal,
  isConnectedStateUsable,
  type AuthError,
  type AuthErrors,
  type CCloudStatus,
  type CCloudUser,
  type Connection,
  type ConnectionError,
  type ConnectionId,
  type ConnectionMetadata,
  type ConnectionStatus,
  type KafkaClusterStatus,
  type SchemaRegistryStatus,
  type UserInfo,
} from "./types";

// Credential types
export {
  apiKeyCredentials,
  basicCredentials,
  CredentialType,
  instanceOfApiKeyAndSecret,
  instanceOfApiKeyCredentials,
  instanceOfBasicCredentials,
  instanceOfKerberosCredentials,
  instanceOfMtlsCredentials,
  instanceOfOAuthCredentials,
  instanceOfScramCredentials,
  isCredentialType,
  noCredentials,
  requiresSecureStorage,
  ScramHashAlgorithm,
  StoreType,
  type ApiKeyCredentials,
  type BasicCredentials,
  type CertificateStore,
  type Credentials,
  type KerberosCredentials,
  type MtlsCredentials,
  type NoCredentials,
  type OAuthCredentials,
  type ScramCredentials,
} from "./credentials";

// Connection spec types
export {
  defaultTLSConfig,
  disabledTLSConfig,
  FormConnectionType,
  hasKafkaCluster,
  hasSchemaRegistry,
  instanceOfKafkaClusterConfig,
  instanceOfSchemaRegistryConfig,
  validateConnectionSpec,
  type CCloudConfig,
  type ConnectionSpec,
  type CustomConnectionSpec,
  type KafkaClusterConfig,
  type KeyStore,
  type LocalConfig,
  type SchemaRegistryConfig,
  type TLSConfig,
  type TrustStore,
} from "./spec";

// Storage
export {
  connectionSpecFromJSON,
  connectionSpecToJSON,
  ConnectionStorage,
  type ConnectionsById,
} from "./storage";

// Handlers
export {
  CCloudConnectionHandler,
  ConnectionHandler,
  DirectConnectionHandler,
  LocalConnectionHandler,
  type ConnectionStatusChangeEvent,
  type ConnectionTestResult,
} from "./handlers";

// Manager
export {
  ConnectionManager,
  type ConnectionCreatedEvent,
  type ConnectionDeletedEvent,
  type ConnectionUpdatedEvent,
} from "./connectionManager";

// Re-export ResponseError from kafkaRest client for backwards compatibility
export { ResponseError } from "../clients/kafkaRest";

// Re-export ConsumeRecord types from kafkaRestProxy
export {
  type ConsumeRecord,
  type ConsumeRecordHeader,
  type ConsumeRecordMetadata,
  type ConsumePartitionData,
  type ConsumeResponse,
} from "../proxy/kafkaRestProxy";

// Alias for backward compatibility with sidecar types
export type { ConsumeRecord as PartitionConsumeRecord } from "../proxy/kafkaRestProxy";
