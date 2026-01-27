/**
 * Core types for connection state management.
 * These types replace the sidecar-generated models in `src/clients/sidecar/models/`.
 */

/** Unique identifier for a connection. */
export type ConnectionId = string & { readonly __brand: "ConnectionId" };

/** Type of connection to a Kafka cluster and/or Schema Registry. */
export enum ConnectionType {
  /** Confluent Cloud via OAuth authentication. */
  CCLOUD = "CCLOUD",
  /** Local Docker-based Kafka/Schema Registry. */
  LOCAL = "LOCAL",
  /** Direct TCP connection with manual configuration. */
  DIRECT = "DIRECT",
}

/** Current state of a connection or sub-connection. */
export enum ConnectedState {
  /** Connection not attempted. */
  NONE = "NONE",
  /** Connection attempt in progress. */
  ATTEMPTING = "ATTEMPTING",
  /** Connected and healthy. */
  SUCCESS = "SUCCESS",
  /** Token or authentication has expired. */
  EXPIRED = "EXPIRED",
  /** Connection failed. */
  FAILED = "FAILED",
}

/** Error details for a connection failure. */
export interface ConnectionError {
  /** Error message describing the failure. */
  message: string;
  /** Error code if available. */
  code?: string;
  /** Timestamp when the error occurred. */
  timestamp?: Date;
}

/** CCloud-specific user information. */
export interface CCloudUser {
  /** Unique user identifier. */
  id: string;
  /** Username (typically email). */
  username: string;
  /** User's first name. */
  firstName?: string;
  /** User's last name. */
  lastName?: string;
  /** Authentication provider (e.g., "auth0", "google"). */
  socialConnection?: string;
  /** Type of authentication used. */
  authType?: string;
}

/** Status of a Confluent Cloud connection. */
export interface CCloudStatus {
  /** Current connection state. */
  state: ConnectedState;
  /** Authenticated user information (when state is SUCCESS). */
  user?: CCloudUser;
  /** Errors if the connection failed. */
  errors?: ConnectionError[];
  /** When the current authentication will expire. */
  requiresAuthenticationAt?: Date;
}

/** Status of a Kafka cluster connection. */
export interface KafkaClusterStatus {
  /** Current connection state. */
  state: ConnectedState;
  /** Kafka cluster ID (when connected). */
  clusterId?: string;
  /** Errors if the connection failed. */
  errors?: ConnectionError[];
}

/** Status of a Schema Registry connection. */
export interface SchemaRegistryStatus {
  /** Current connection state. */
  state: ConnectedState;
  /** Schema Registry cluster ID (when connected). */
  clusterId?: string;
  /** Errors if the connection failed. */
  errors?: ConnectionError[];
}

/** Combined status of all connection components. */
export interface ConnectionStatus {
  /** CCloud-specific status (for CCLOUD connections). */
  ccloud?: CCloudStatus;
  /** Kafka cluster status. */
  kafkaCluster?: KafkaClusterStatus;
  /** Schema Registry status. */
  schemaRegistry?: SchemaRegistryStatus;
}

/** Read-only metadata about a connection. */
export interface ConnectionMetadata {
  /** URI for signing in (OAuth flow). */
  signInUri?: string;
  /** When the connection was created. */
  createdAt?: Date;
  /** When the connection was last updated. */
  updatedAt?: Date;
}

/**
 * Determines if a ConnectedState represents a usable connection.
 * @param state The state to check.
 * @returns true if the connection is usable (SUCCESS).
 */
export function isConnectedStateUsable(state: ConnectedState): boolean {
  return state === ConnectedState.SUCCESS;
}

/**
 * Determines if a ConnectedState represents a terminal failure.
 * @param state The state to check.
 * @returns true if the connection is in a terminal failure state.
 */
export function isConnectedStateTerminal(state: ConnectedState): boolean {
  return state === ConnectedState.FAILED || state === ConnectedState.EXPIRED;
}

/**
 * Determines if a ConnectedState represents an in-progress state.
 * @param state The state to check.
 * @returns true if the connection is attempting to connect.
 */
export function isConnectedStateInProgress(state: ConnectedState): boolean {
  return state === ConnectedState.ATTEMPTING;
}
