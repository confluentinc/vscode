/**
 * Credential types for authenticating to Kafka clusters and Schema Registries.
 * Uses a discriminated union pattern with `type` as the discriminator.
 */

/** Credential type discriminator values. */
export enum CredentialType {
  /** No authentication required. */
  NONE = "NONE",
  /** Basic username/password authentication. */
  BASIC = "BASIC",
  /** API key and secret (commonly used with Confluent Cloud). */
  API_KEY = "API_KEY",
  /** OAuth2 token-based authentication. */
  OAUTH = "OAUTH",
  /** SCRAM (Salted Challenge Response Authentication Mechanism). */
  SCRAM = "SCRAM",
  /** Mutual TLS (client certificate authentication). */
  MTLS = "MTLS",
  /** Kerberos/GSSAPI authentication. */
  KERBEROS = "KERBEROS",
}

/** No authentication. */
export interface NoCredentials {
  type: CredentialType.NONE;
}

/** Basic username/password authentication. */
export interface BasicCredentials {
  type: CredentialType.BASIC;
  /** Username for authentication. */
  username: string;
  /** Password for authentication. */
  password: string;
}

/** API key and secret authentication (commonly used with Confluent Cloud). */
export interface ApiKeyCredentials {
  type: CredentialType.API_KEY;
  /** The API key. */
  apiKey: string;
  /** The API secret. */
  apiSecret: string;
}

/** OAuth2 token-based authentication configuration. */
export interface OAuthCredentials {
  type: CredentialType.OAUTH;
  /** URL to fetch tokens from. */
  tokensUrl: string;
  /** OAuth client ID. */
  clientId: string;
  /** OAuth client secret (optional for public clients). */
  clientSecret?: string;
  /** OAuth scope(s) to request. */
  scope?: string;
  /** Connection timeout in milliseconds. */
  connectTimeoutMillis?: number;
  /** CCloud logical cluster ID (CCloud-specific). */
  ccloudLogicalClusterId?: string;
  /** CCloud identity pool ID (CCloud-specific). */
  ccloudIdentityPoolId?: string;
}

/** SCRAM hash algorithm options. */
export enum ScramHashAlgorithm {
  SHA_256 = "SCRAM-SHA-256",
  SHA_512 = "SCRAM-SHA-512",
}

/** SCRAM (Salted Challenge Response Authentication Mechanism) credentials. */
export interface ScramCredentials {
  type: CredentialType.SCRAM;
  /** Hash algorithm to use. */
  hashAlgorithm: ScramHashAlgorithm;
  /** SCRAM username. */
  username: string;
  /** SCRAM password. */
  password: string;
}

/** Store type for TLS certificates. */
export enum StoreType {
  /** Java KeyStore format. */
  JKS = "JKS",
  /** PKCS#12 format. */
  PKCS12 = "PKCS12",
  /** PEM format. */
  PEM = "PEM",
  /** Unknown or auto-detect. */
  UNKNOWN = "UNKNOWN",
}

/** Configuration for a certificate/key store. */
export interface CertificateStore {
  /** Path to the store file. */
  path: string;
  /** Password for the store (optional for PEM format). */
  password?: string;
  /** Store format type. */
  type?: StoreType;
  /** Password for the private key (if different from store password). */
  keyPassword?: string;
}

/** Mutual TLS client certificate authentication. */
export interface MtlsCredentials {
  type: CredentialType.MTLS;
  /** Client certificate keystore configuration. */
  keystore: CertificateStore;
}

/** Kerberos/GSSAPI authentication. */
export interface KerberosCredentials {
  type: CredentialType.KERBEROS;
  /** Kerberos principal (e.g., "user@REALM"). */
  principal: string;
  /** Path to the keytab file. */
  keytabPath: string;
  /** Kerberos service name (defaults to "kafka"). */
  serviceName?: string;
}

/**
 * Union type of all supported credential types.
 * Use the `type` field as a discriminator to determine the credential type.
 */
export type Credentials =
  | NoCredentials
  | BasicCredentials
  | ApiKeyCredentials
  | OAuthCredentials
  | ScramCredentials
  | MtlsCredentials
  | KerberosCredentials;

/**
 * Type guard to check if credentials are of a specific type.
 * @param credentials The credentials to check.
 * @param type The credential type to check for.
 * @returns true if the credentials match the specified type.
 */
export function isCredentialType<T extends CredentialType>(
  credentials: Credentials | undefined,
  type: T,
): credentials is Extract<Credentials, { type: T }> {
  return credentials?.type === type;
}

/**
 * Creates empty credentials of type NONE.
 * @returns NoCredentials object.
 */
export function noCredentials(): NoCredentials {
  return { type: CredentialType.NONE };
}

/**
 * Creates Basic credentials.
 * @param username The username.
 * @param password The password.
 * @returns BasicCredentials object.
 */
export function basicCredentials(username: string, password: string): BasicCredentials {
  return { type: CredentialType.BASIC, username, password };
}

/**
 * Creates API Key credentials.
 * @param apiKey The API key.
 * @param apiSecret The API secret.
 * @returns ApiKeyCredentials object.
 */
export function apiKeyCredentials(apiKey: string, apiSecret: string): ApiKeyCredentials {
  return { type: CredentialType.API_KEY, apiKey, apiSecret };
}

/**
 * Determines if credentials require secure storage (contain secrets).
 * @param credentials The credentials to check.
 * @returns true if the credentials contain sensitive data that should be stored securely.
 */
export function requiresSecureStorage(credentials: Credentials | undefined): boolean {
  if (!credentials) return false;
  switch (credentials.type) {
    case CredentialType.NONE:
      return false;
    case CredentialType.BASIC:
    case CredentialType.API_KEY:
    case CredentialType.OAUTH:
    case CredentialType.SCRAM:
      return true;
    case CredentialType.MTLS:
    case CredentialType.KERBEROS:
      // File paths don't need secure storage (files should be secured by filesystem)
      return false;
  }
}

/**
 * Type guard to check if an object is BasicCredentials.
 * @param obj The object to check.
 * @returns true if the object is BasicCredentials.
 */
export function instanceOfBasicCredentials(obj: unknown): obj is BasicCredentials {
  return isCredentialType(obj as Credentials, CredentialType.BASIC);
}

/**
 * Type guard to check if an object is ApiKeyCredentials.
 * Also matches the old "ApiKeyCredentials" type name.
 * @param obj The object to check.
 * @returns true if the object is ApiKeyCredentials.
 */
export function instanceOfApiKeyCredentials(obj: unknown): obj is ApiKeyCredentials {
  return isCredentialType(obj as Credentials, CredentialType.API_KEY);
}

/** Alias for backwards compatibility with sidecar naming. */
export const instanceOfApiKeyAndSecret = instanceOfApiKeyCredentials;

/**
 * Type guard to check if an object is OAuthCredentials.
 * @param obj The object to check.
 * @returns true if the object is OAuthCredentials.
 */
export function instanceOfOAuthCredentials(obj: unknown): obj is OAuthCredentials {
  return isCredentialType(obj as Credentials, CredentialType.OAUTH);
}

/**
 * Type guard to check if an object is ScramCredentials.
 * @param obj The object to check.
 * @returns true if the object is ScramCredentials.
 */
export function instanceOfScramCredentials(obj: unknown): obj is ScramCredentials {
  return isCredentialType(obj as Credentials, CredentialType.SCRAM);
}

/**
 * Type guard to check if an object is MtlsCredentials.
 * @param obj The object to check.
 * @returns true if the object is MtlsCredentials.
 */
export function instanceOfMtlsCredentials(obj: unknown): obj is MtlsCredentials {
  return isCredentialType(obj as Credentials, CredentialType.MTLS);
}

/**
 * Type guard to check if an object is KerberosCredentials.
 * @param obj The object to check.
 * @returns true if the object is KerberosCredentials.
 */
export function instanceOfKerberosCredentials(obj: unknown): obj is KerberosCredentials {
  return isCredentialType(obj as Credentials, CredentialType.KERBEROS);
}
