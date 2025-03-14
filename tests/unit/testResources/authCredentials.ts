import {
  ApiKeyAndSecret,
  ApiKeyAndSecretFromJSON,
  BasicCredentials,
  BasicCredentialsFromJSON,
  KerberosCredentials,
  KerberosCredentialsFromJSON,
  OAuthCredentials,
  OAuthCredentialsFromJSON,
  ScramCredentials,
  ScramCredentialsFromJSON,
} from "../../../src/clients/sidecar";
import { SupportedAuthTypes } from "../../../src/directConnections/types";

type TEST_CRED_TYPES =
  | ApiKeyAndSecret
  | BasicCredentials
  | KerberosCredentials
  | OAuthCredentials
  | ScramCredentials;

export const TEST_APIKEYSECRET_CREDENTIALS: ApiKeyAndSecret = ApiKeyAndSecretFromJSON({
  api_key: "your_api_key_here",
  api_secret: "your_api_secret_here",
} as ApiKeyAndSecret);

export const TEST_BASIC_CREDENTIALS: BasicCredentials = BasicCredentialsFromJSON({
  username: "your_username_here",
  password: "your_password_here",
} as BasicCredentials);

export const TEST_KERBEROS_CREDENTIALS: KerberosCredentials = KerberosCredentialsFromJSON({
  principal: "your_principal_here",
  keytab_path: "your_keytab_path_here",
  service_name: "your_service_name_here",
} as KerberosCredentials);

export const TEST_OAUTH_CREDENTIALS: OAuthCredentials = OAuthCredentialsFromJSON({
  tokens_url: "https://your_tokens_url_here",
  client_id: "your_client_id_here",
  client_secret: "your_client_secret_here",
  scope: "your_scope_here",
  connect_timeout_millis: 5000,
  ccloud_logical_cluster_id: "your_logical_cluster_id_here",
  ccloud_identity_pool_id: "your_identity_pool_id_here",
} as OAuthCredentials);

export const TEST_SCRAM_CREDENTIALS: ScramCredentials = ScramCredentialsFromJSON({
  hash_algorithm: "SCRAM_SHA_256",
  scram_username: "your_scram_username_here",
  scram_password: "your_scram_password_here",
} as ScramCredentials);

export const TEST_AUTHTYPES_AND_CREDS = new Map<SupportedAuthTypes, TEST_CRED_TYPES>([
  ["API", TEST_APIKEYSECRET_CREDENTIALS],
  ["Basic", TEST_BASIC_CREDENTIALS],
  ["Kerberos", TEST_KERBEROS_CREDENTIALS],
  ["OAuth", TEST_OAUTH_CREDENTIALS],
  ["SCRAM", TEST_SCRAM_CREDENTIALS],
]);
