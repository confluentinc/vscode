import { randomUUID } from "crypto";
import { Connection, UserInfo } from "../../../src/clients/sidecar";
import {
  CCLOUD_CONNECTION_ID,
  CCLOUD_CONNECTION_SPEC,
  LOCAL_CONNECTION_SPEC,
} from "../../../src/constants";
import { SIDECAR_PORT } from "../../../src/sidecar/constants";
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
export const TEST_CCLOUD_CONNECTION: Connection = {
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
    },
  },
  status: {
    // start with unauthenticated connection, then add TEST_CCLOUD_USER and TEST_AUTH_EXPIRATION later
    authentication: {
      status: "NO_TOKEN",
    },
  },
};

/** A CCloud {@link Connection} with `VALID_TOKEN` auth status and user info. */
export const TEST_AUTHENTICATED_CCLOUD_CONNECTION: Connection = {
  ...TEST_CCLOUD_CONNECTION,
  status: {
    ...TEST_CCLOUD_CONNECTION.status,
    authentication: {
      status: "VALID_TOKEN",
      user: TEST_CCLOUD_USER,
      requires_authentication_at: TEST_AUTH_EXPIRATION,
    },
  },
};

const TEST_LOCAL_CONNECTION_ID = randomUUID();
export const TEST_LOCAL_CONNECTION: Connection = {
  api_version: "gateway/v1",
  kind: "Connection",
  id: TEST_LOCAL_CONNECTION_ID,
  metadata: {
    self: `http://localhost:${SIDECAR_PORT}/gateway/v1/connections/${TEST_LOCAL_CONNECTION_ID}`,
  },
  spec: LOCAL_CONNECTION_SPEC,
  status: {
    authentication: {
      status: "NO_TOKEN",
    },
  },
};
