import { randomUUID } from "crypto";
import {
  Connection,
  ConnectionFromJSON,
  ConnectionSpecFromJSON,
  ConnectionType,
  UserInfo,
} from "../../../src/clients/sidecar";
import {
  CCLOUD_AUTH_CALLBACK_URI,
  CCLOUD_CONNECTION_ID,
  CCLOUD_CONNECTION_SPEC,
  LOCAL_CONNECTION_ID,
  LOCAL_CONNECTION_SPEC,
} from "../../../src/constants";
import { ConnectionId } from "../../../src/models/resource";
import { SIDECAR_PORT } from "../../../src/sidecar/constants";
import { CustomConnectionSpec } from "../../../src/storage/resourceManager";
import { TEST_CCLOUD_ORGANIZATION } from "./organization";

export const TEST_CCLOUD_USER: UserInfo = {
  id: "test-user-id",
  username: "test-user",
  first_name: "Test",
  last_name: "User",
  social_connection: "test-social",
  auth_type: "test-auth",
};
const TEST_AUTH_EXPIRATION = new Date(Date.now() + 4 * 60 * 60 * 1000);

/** A basic CCloud {@link Connection} with `NO_TOKEN` auth status. */
export const TEST_CCLOUD_CONNECTION: Connection = ConnectionFromJSON({
  api_version: "gateway/v1",
  kind: "Connection",
  id: CCLOUD_CONNECTION_ID,
  metadata: {
    self: `http://localhost:${SIDECAR_PORT}/gateway/v1/connections/${CCLOUD_CONNECTION_ID}`,
    sign_in_uri: `http://login.confluent.io/login?...`,
  },
  spec: {
    ...CCLOUD_CONNECTION_SPEC,
    ccloud_config: {
      organization_id: TEST_CCLOUD_ORGANIZATION.id,
      ide_auth_callback_uri: CCLOUD_AUTH_CALLBACK_URI,
    },
  },
  status: {
    // start with unauthenticated connection, then add TEST_CCLOUD_USER and TEST_AUTH_EXPIRATION later
    authentication: {
      status: "NO_TOKEN",
    },
  },
});

/** A CCloud {@link Connection} with `VALID_TOKEN` auth status and user info. */
export const TEST_AUTHENTICATED_CCLOUD_CONNECTION: Connection = ConnectionFromJSON({
  ...TEST_CCLOUD_CONNECTION,
  status: {
    ...TEST_CCLOUD_CONNECTION.status,
    authentication: {
      status: "VALID_TOKEN",
      user: TEST_CCLOUD_USER,
      requires_authentication_at: TEST_AUTH_EXPIRATION,
    },
  },
});

export const TEST_LOCAL_CONNECTION: Connection = ConnectionFromJSON({
  api_version: "gateway/v1",
  kind: "Connection",
  id: LOCAL_CONNECTION_ID,
  metadata: {
    self: `http://localhost:${SIDECAR_PORT}/gateway/v1/connections/${LOCAL_CONNECTION_ID}`,
  },
  spec: LOCAL_CONNECTION_SPEC,
  status: {
    authentication: {
      status: "NO_TOKEN",
    },
  },
});

export const TEST_DIRECT_CONNECTION_ID = randomUUID() as ConnectionId;
export const TEST_DIRECT_CONNECTION: Connection = ConnectionFromJSON({
  api_version: "gateway/v1",
  kind: "Connection",
  id: TEST_DIRECT_CONNECTION_ID,
  metadata: {
    self: `http://localhost:${SIDECAR_PORT}/gateway/v1/connections/${TEST_DIRECT_CONNECTION_ID}`,
  },
  spec: {
    id: TEST_DIRECT_CONNECTION_ID,
    name: "New Connection",
    type: ConnectionType.Direct,
  },
  status: {
    authentication: {
      status: "NO_TOKEN",
    },
  },
});

/** Fake spec augmented with `formConnectionType` for test purposes. */
export const TEST_DIRECT_CONNECTION_FORM_SPEC: CustomConnectionSpec = {
  ...ConnectionSpecFromJSON(TEST_DIRECT_CONNECTION.spec),
  id: TEST_DIRECT_CONNECTION_ID, // enforced ConnectionId type
  formConnectionType: "Apache Kafka",
  specifiedConnectionType: undefined,
};
