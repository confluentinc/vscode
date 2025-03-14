import {
  instanceOfApiKeyAndSecret,
  instanceOfBasicCredentials,
  instanceOfKerberosCredentials,
  instanceOfOAuthCredentials,
  instanceOfScramCredentials,
} from "../clients/sidecar";
import { SupportedAuthTypes } from "./types";

export function getCredentialsType(creds: any): SupportedAuthTypes {
  if (!creds || typeof creds !== "object") return "None";
  if (instanceOfBasicCredentials(creds)) return "Basic";
  if (instanceOfApiKeyAndSecret(creds)) return "API";
  if (instanceOfScramCredentials(creds)) return "SCRAM";
  if (instanceOfOAuthCredentials(creds)) return "OAuth";
  if (instanceOfKerberosCredentials(creds)) return "Kerberos";
  return "None";
}
