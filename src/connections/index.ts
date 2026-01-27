/**
 * Connection management module.
 *
 * This module provides types and utilities for managing connections to
 * Kafka clusters, Schema Registries, and Confluent Cloud.
 */

// Core types
export {
  ConnectedState,
  ConnectionType,
  isConnectedStateInProgress,
  isConnectedStateTerminal,
  isConnectedStateUsable,
  type CCloudStatus,
  type CCloudUser,
  type ConnectionError,
  type ConnectionId,
  type ConnectionMetadata,
  type ConnectionStatus,
  type KafkaClusterStatus,
  type SchemaRegistryStatus,
} from "./types";

// Credential types
export {
  apiKeyCredentials,
  basicCredentials,
  CredentialType,
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
