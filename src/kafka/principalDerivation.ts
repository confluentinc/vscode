/**
 * Kafka Principal Derivation.
 *
 * Extracts the Kafka principal from credentials for use in ACL evaluation.
 * Different credential types map to different principal formats.
 */

import {
  CredentialType,
  type BasicCredentials,
  type Credentials,
  type KerberosCredentials,
} from "../connections";
import { getCredentialsType } from "../directConnections/credentials";
import type { SupportedAuthTypes } from "../directConnections/types";

/**
 * Result of principal derivation attempt.
 */
export interface PrincipalResult {
  /** The derived principal in Kafka format (e.g., "User:alice"). */
  principal?: string;
  /** Whether the principal could be derived from the credentials. */
  canDerive: boolean;
  /** Reason why principal could not be derived (if canDerive is false). */
  reason?: string;
}

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
 * Derives the Kafka principal from credentials.
 *
 * Principal formats by credential type:
 * - BASIC: User:{username}
 * - API_KEY: User:{apiKey}
 * - SCRAM: User:{username}
 * - KERBEROS: User:{principal}
 * - NONE: No principal (open access assumed)
 * - MTLS: Cannot derive (certificate CN not accessible)
 * - OAUTH: Cannot derive (token claims not accessible)
 *
 * @param credentials The credentials to derive principal from.
 * @returns PrincipalResult with the derived principal or reason for failure.
 */
export function derivePrincipal(credentials: Credentials | undefined): PrincipalResult {
  if (!credentials) {
    return {
      canDerive: false,
      reason: "No credentials provided",
    };
  }

  // Detect credential type - handles both modern (with type) and legacy (property-based) credentials
  const detectedAuthType = getCredentialsType(credentials);
  const credType = credentials.type ?? authTypeToCredentialType(detectedAuthType);

  switch (credType) {
    case CredentialType.NONE:
      return {
        canDerive: false,
        reason: "No authentication configured - open access assumed",
      };

    case CredentialType.BASIC:
      return deriveFromBasic(credentials as BasicCredentials);

    case CredentialType.API_KEY:
      return deriveFromApiKey(credentials);

    case CredentialType.SCRAM:
      return deriveFromScram(credentials);

    case CredentialType.KERBEROS:
      return deriveFromKerberos(credentials as KerberosCredentials);

    case CredentialType.MTLS:
      return {
        canDerive: false,
        reason: "Cannot derive principal from mTLS credentials - certificate CN not accessible",
      };

    case CredentialType.OAUTH:
      return {
        canDerive: false,
        reason: "Cannot derive principal from OAuth credentials - token claims not accessible",
      };

    default:
      return {
        canDerive: false,
        reason: `Unknown credential type: ${credType}`,
      };
  }
}

/**
 * Derives principal from BASIC credentials.
 */
function deriveFromBasic(credentials: BasicCredentials): PrincipalResult {
  const username = credentials.username;
  if (!username) {
    return {
      canDerive: false,
      reason: "BASIC credentials missing username",
    };
  }
  return {
    principal: `User:${username}`,
    canDerive: true,
  };
}

/**
 * Derives principal from API_KEY credentials.
 * Handles both camelCase (apiKey) and snake_case (api_key) property names.
 */
function deriveFromApiKey(credentials: Credentials): PrincipalResult {
  const creds = credentials as unknown as Record<string, unknown>;
  const apiKey = (creds.apiKey ?? creds.api_key) as string | undefined;

  if (!apiKey) {
    return {
      canDerive: false,
      reason: "API_KEY credentials missing apiKey",
    };
  }
  return {
    principal: `User:${apiKey}`,
    canDerive: true,
  };
}

/**
 * Derives principal from SCRAM credentials.
 * Handles both camelCase and snake_case property names.
 */
function deriveFromScram(credentials: Credentials): PrincipalResult {
  const creds = credentials as unknown as Record<string, unknown>;
  const username = (creds.username ?? creds.scramUsername ?? creds.scram_username) as
    | string
    | undefined;

  if (!username) {
    return {
      canDerive: false,
      reason: "SCRAM credentials missing username",
    };
  }
  return {
    principal: `User:${username}`,
    canDerive: true,
  };
}

/**
 * Derives principal from KERBEROS credentials.
 */
function deriveFromKerberos(credentials: KerberosCredentials): PrincipalResult {
  const principal = credentials.principal;
  if (!principal) {
    return {
      canDerive: false,
      reason: "KERBEROS credentials missing principal",
    };
  }
  return {
    principal: `User:${principal}`,
    canDerive: true,
  };
}
