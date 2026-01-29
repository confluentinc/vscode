import type {
  ApiKeyCredentials,
  BasicCredentials,
  KerberosCredentials,
  OAuthCredentials,
  ScramCredentials,
} from "../../../src/connections";
import type { SupportedAuthTypes } from "../../../src/directConnections/types";

type TEST_CRED_TYPES =
  | ApiKeyCredentials
  | BasicCredentials
  | KerberosCredentials
  | OAuthCredentials
  | ScramCredentials;

export const TEST_APIKEYSECRET_CREDENTIALS: ApiKeyCredentials = {
  api_key: "your_api_key_here",
  api_secret: "your_api_secret_here",
};

export const TEST_BASIC_CREDENTIALS: BasicCredentials = {
  username: "your_username_here",
  password: "your_password_here",
};

export const TEST_KERBEROS_CREDENTIALS: KerberosCredentials = {
  principal: "your_principal_here",
  keytab_path: "your_keytab_path_here",
  service_name: "your_service_name_here",
};

export const TEST_OAUTH_CREDENTIALS: OAuthCredentials = {
  tokens_url: "https://your_tokens_url_here",
  client_id: "your_client_id_here",
  client_secret: "your_client_secret_here",
  scope: "your_scope_here",
  connect_timeout_millis: 5000,
  ccloud_logical_cluster_id: "your_logical_cluster_id_here",
  ccloud_identity_pool_id: "your_identity_pool_id_here",
};

export const TEST_SCRAM_CREDENTIALS: ScramCredentials = {
  hash_algorithm: "SCRAM_SHA_256",
  scram_username: "your_scram_username_here",
  scram_password: "your_scram_password_here",
};

export const TEST_AUTHTYPES_AND_CREDS = new Map<SupportedAuthTypes, TEST_CRED_TYPES>([
  ["API", TEST_APIKEYSECRET_CREDENTIALS],
  ["Basic", TEST_BASIC_CREDENTIALS],
  ["Kerberos", TEST_KERBEROS_CREDENTIALS],
  ["OAuth", TEST_OAUTH_CREDENTIALS],
  ["SCRAM", TEST_SCRAM_CREDENTIALS],
]);
