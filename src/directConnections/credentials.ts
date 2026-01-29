import {
  instanceOfApiKeyAndSecret,
  instanceOfBasicCredentials,
  instanceOfKerberosCredentials,
  instanceOfOAuthCredentials,
  instanceOfScramCredentials,
} from "../connections";
import type { SupportedAuthTypes } from "./types";

/**
 * Detects the credential type from a credentials object.
 * Handles both modern credentials (with `type` discriminator) and
 * legacy/imported credentials (without `type`, detected by property names).
 */
export function getCredentialsType(creds: any): SupportedAuthTypes {
  if (!creds || typeof creds !== "object") return "None";

  // First try modern credentials with type discriminator
  if (instanceOfBasicCredentials(creds)) return "Basic";
  if (instanceOfApiKeyAndSecret(creds)) return "API";
  if (instanceOfScramCredentials(creds)) return "SCRAM";
  if (instanceOfOAuthCredentials(creds)) return "OAuth";
  if (instanceOfKerberosCredentials(creds)) return "Kerberos";

  // Fallback: detect legacy/imported credentials by property names
  // (these don't have a `type` field)
  if (hasProperties(creds, ["apiKey", "apiSecret"])) return "API";
  if (hasProperties(creds, ["username", "password"]) && !hasProperties(creds, ["hashAlgorithm"])) {
    return "Basic";
  }
  if (
    hasProperties(creds, ["scramUsername", "scramPassword"]) ||
    hasProperties(creds, ["hashAlgorithm"])
  ) {
    return "SCRAM";
  }
  if (hasProperties(creds, ["tokensUrl", "clientId"])) return "OAuth";
  if (hasProperties(creds, ["principal", "keytabPath"])) return "Kerberos";

  return "None";
}

/** Helper to check if an object has all the specified properties. */
function hasProperties(obj: any, props: string[]): boolean {
  return props.every((prop) => prop in obj && obj[prop] !== undefined);
}
