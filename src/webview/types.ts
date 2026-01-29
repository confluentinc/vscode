/**
 * Type definitions for webview code.
 *
 * This file provides types that webviews need WITHOUT importing runtime code
 * from the main codebase. This prevents the bundler from pulling in Node.js
 * modules (vscode, path, fs, etc.) which would break the webview.
 *
 * IMPORTANT: Only add type definitions and enums here. Never import from
 * modules that have Node.js dependencies.
 */

/**
 * Connection state enum - must match ../connections/types.ts ConnectedState
 * Duplicated here to avoid pulling in Node.js dependencies.
 */
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

/**
 * Store type for TLS certificates - must match ../connections/credentials.ts StoreType
 * Duplicated here to avoid pulling in Node.js dependencies.
 */
export enum StoreType {
  JKS = "JKS",
  PKCS12 = "PKCS12",
  PEM = "PEM",
  UNKNOWN = "UNKNOWN",
}

/** Form connection type options. */
export type FormConnectionType =
  | "Apache Kafka"
  | "Confluent Cloud"
  | "Confluent Platform"
  | "WarpStream"
  | "Other";

/** Supported authentication types for direct connections. */
export type SupportedAuthTypes = "None" | "Basic" | "API" | "SCRAM" | "OAuth" | "Kerberos";

/** Basic username/password authentication. */
export interface BasicCredentials {
  type?: string;
  username: string;
  password: string;
}

/** API key and secret authentication. */
export interface ApiKeyCredentials {
  type?: string;
  apiKey: string;
  apiSecret: string;
}

/** OAuth2 token-based authentication. */
export interface OAuthCredentials {
  type?: string;
  tokensUrl: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
  connectTimeoutMillis?: number;
  ccloudLogicalClusterId?: string;
  ccloudIdentityPoolId?: string;
}

/** SCRAM authentication. */
export interface ScramCredentials {
  type?: string;
  hashAlgorithm: string;
  username: string;
  password: string;
}

/** Kerberos authentication. */
export interface KerberosCredentials {
  type?: string;
  principal: string;
  keytabPath: string;
  serviceName?: string;
}

/** Union of all credential types. */
export type Credentials =
  | BasicCredentials
  | ApiKeyCredentials
  | OAuthCredentials
  | ScramCredentials
  | KerberosCredentials;

/** TLS/SSL configuration. */
export interface TLSConfig {
  enabled: boolean;
  verifyHostname?: boolean;
  truststore?: {
    path: string;
    password?: string;
    type?: StoreType | string;
  };
  keystore?: {
    path: string;
    password?: string;
    type?: StoreType | string;
    keyPassword?: string;
  };
}

/** Kafka cluster configuration. */
export interface KafkaClusterConfig {
  bootstrapServers: string;
  credentials?: Credentials;
  ssl?: TLSConfig;
  clientIdSuffix?: string;
}

/** Schema Registry configuration. */
export interface SchemaRegistryConfig {
  id?: string;
  uri: string;
  credentials?: Credentials;
  ssl?: TLSConfig;
}

/** Custom connection specification. */
export interface CustomConnectionSpec {
  id: string;
  name: string;
  type: string;
  formConnectionType?: FormConnectionType;
  specifiedConnectionType?: string;
  kafkaCluster?: KafkaClusterConfig;
  schemaRegistry?: SchemaRegistryConfig;
}
