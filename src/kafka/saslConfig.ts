/**
 * SASL configuration mapping for kafkajs.
 *
 * Maps the extension's credential types to kafkajs SASLOptions.
 */

import type { SASLOptions } from "kafkajs";
import {
  CredentialType,
  ScramHashAlgorithm,
  type BasicCredentials,
  type Credentials,
  type KerberosCredentials,
  type OAuthCredentials,
} from "../connections";
import { getCredentialsType } from "../directConnections/credentials";
import type { SupportedAuthTypes } from "../directConnections/types";
import { KafkaAdminError, KafkaAdminErrorCategory } from "./errors";

/**
 * Maps a SupportedAuthTypes string to CredentialType enum.
 */
function authTypeToCredentialType(authType: SupportedAuthTypes): CredentialType {
  switch (authType) {
    case "Basic":
      return CredentialType.BASIC;
    case "API":
      return CredentialType.API_KEY;
    case "SCRAM":
      return CredentialType.SCRAM;
    case "OAuth":
      return CredentialType.OAUTH;
    case "Kerberos":
      return CredentialType.KERBEROS;
    case "None":
    default:
      return CredentialType.NONE;
  }
}

/**
 * Maps the extension's Credentials type to kafkajs SASLOptions.
 *
 * Handles both modern credentials (with `type` discriminator) and
 * legacy/imported credentials (without `type`, detected by property names).
 *
 * @param credentials The credentials to convert.
 * @returns kafkajs SASL options, or undefined if no authentication required.
 * @throws KafkaAdminError if the credential type is not supported by kafkajs.
 */
export function toSaslOptions(credentials: Credentials | undefined): SASLOptions | undefined {
  if (!credentials) {
    return undefined;
  }

  // Detect credential type - handles both modern (with type) and legacy (property-based) credentials
  const detectedAuthType = getCredentialsType(credentials);
  const credType = credentials.type ?? authTypeToCredentialType(detectedAuthType);

  switch (credType) {
    case CredentialType.NONE:
      return undefined;

    case CredentialType.BASIC:
      return toPlainSasl(credentials as BasicCredentials);

    case CredentialType.API_KEY:
      return toApiKeySaslFromAny(credentials);

    case CredentialType.SCRAM:
      return toScramSaslFromAny(credentials);

    case CredentialType.OAUTH:
      return toOAuthBearerSasl(credentials as OAuthCredentials);

    case CredentialType.MTLS:
      // MTLS is handled via SSL config, not SASL
      return undefined;

    case CredentialType.KERBEROS:
      throw new KafkaAdminError(
        "Kerberos/GSSAPI authentication is not supported by kafkajs. " +
          "Use a direct connection with REST API fallback instead.",
        KafkaAdminErrorCategory.INVALID,
      );
  }
}

/**
 * Converts BasicCredentials to PLAIN SASL options.
 * PLAIN mechanism sends username/password in plain text (should only be used with SSL).
 */
function toPlainSasl(credentials: BasicCredentials): SASLOptions {
  return {
    mechanism: "plain",
    username: credentials.username,
    password: credentials.password,
  };
}

/**
 * Converts API key credentials to PLAIN SASL options.
 * Handles both camelCase (apiKey/apiSecret) and snake_case (api_key/api_secret) property names.
 */
function toApiKeySaslFromAny(credentials: Credentials): SASLOptions {
  const creds = credentials as unknown as Record<string, unknown>;
  return {
    mechanism: "plain",
    username: ((creds.apiKey ?? creds.api_key) as string) ?? "",
    password: ((creds.apiSecret ?? creds.api_secret) as string) ?? "",
  };
}

/**
 * Converts SCRAM credentials to SCRAM SASL options.
 * Handles both camelCase and snake_case property names for legacy/imported credentials.
 */
function toScramSaslFromAny(credentials: Credentials): SASLOptions {
  const creds = credentials as unknown as Record<string, unknown>;

  // Detect hash algorithm - check both camelCase and snake_case
  const hashAlg = (creds.hashAlgorithm ?? creds.hash_algorithm) as string | undefined;
  const mechanism = hashAlg === ScramHashAlgorithm.SHA_512 ? "scram-sha-512" : "scram-sha-256";

  // Get username - check standard, scram-specific, and snake_case variants
  const username =
    ((creds.username ?? creds.scramUsername ?? creds.scram_username) as string) ?? "";

  // Get password - check standard, scram-specific, and snake_case variants
  const password =
    ((creds.password ?? creds.scramPassword ?? creds.scram_password) as string) ?? "";

  return {
    mechanism,
    username,
    password,
  };
}

/**
 * Converts OAuthCredentials to OAUTHBEARER SASL options.
 *
 * Note: OAuth with kafkajs requires implementing a token provider function.
 * This is primarily used for CCloud, but CCloud typically uses REST API instead.
 *
 * @throws KafkaAdminError with guidance to use REST API for OAuth.
 */
function toOAuthBearerSasl(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _credentials: OAuthCredentials,
): SASLOptions {
  // OAuth requires a custom token provider function in kafkajs.
  // For CCloud connections (which use OAuth), we use the REST API instead of kafkajs.
  // If we reach this point, it's likely a misconfiguration.
  throw new KafkaAdminError(
    "OAuth authentication with kafkajs Admin client is not currently supported. " +
      "CCloud connections should use the REST API for topic operations.",
    KafkaAdminErrorCategory.INVALID,
  );
}

/**
 * Creates Kerberos-specific error with helpful message.
 * Called when user attempts to use Kerberos credentials with kafkajs.
 */
export function createKerberosUnsupportedError(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _credentials: KerberosCredentials,
): KafkaAdminError {
  return new KafkaAdminError(
    "Kerberos/GSSAPI authentication is not supported by kafkajs. " +
      "Consider using a Confluent REST Proxy with Kerberos authentication, " +
      "or use SASL/SCRAM or SASL/PLAIN authentication instead.",
    KafkaAdminErrorCategory.INVALID,
  );
}
