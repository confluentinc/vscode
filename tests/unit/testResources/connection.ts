import { randomUUID } from "crypto";
import type { Connection, ConnectionSpec, UserInfo } from "../../../src/clients/sidecar";
import {
  ConnectedState,
  ConnectionFromJSON,
  ConnectionSpecFromJSON,
  ConnectionType,
} from "../../../src/clients/sidecar";
import {
  CCLOUD_AUTH_CALLBACK_URI,
  CCLOUD_CONNECTION_ID,
  CCLOUD_CONNECTION_SPEC,
  LOCAL_CONNECTION_ID,
  LOCAL_CONNECTION_SPEC,
} from "../../../src/constants";
import type { ConnectionId } from "../../../src/models/resource";
import { SIDECAR_PORT } from "../../../src/sidecar/constants";
import type { CustomConnectionSpec } from "../../../src/storage/resourceManager";
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

/** A basic CCloud {@link Connection} with `NONE` connected state. */
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
    // start with unauthenticated connection, then switch to ConnectedState.Success and
    // add TEST_CCLOUD_USER and TEST_AUTH_EXPIRATION later
    ccloud: {
      state: ConnectedState.None,
    },
  },
} satisfies Connection);

/** A CCloud {@link Connection} with `SUCCESS` state and user info. */
export const TEST_AUTHENTICATED_CCLOUD_CONNECTION: Connection = ConnectionFromJSON({
  ...TEST_CCLOUD_CONNECTION,
  status: {
    ...TEST_CCLOUD_CONNECTION.status,
    ccloud: {
      ...TEST_CCLOUD_CONNECTION.status.ccloud,
      requires_authentication_at: TEST_AUTH_EXPIRATION,
      state: ConnectedState.Success,
      user: TEST_CCLOUD_USER,
    },
  },
} satisfies Connection);

export const TEST_LOCAL_CONNECTION: Connection = ConnectionFromJSON({
  api_version: "gateway/v1",
  kind: "Connection",
  id: LOCAL_CONNECTION_ID,
  metadata: {
    self: `http://localhost:${SIDECAR_PORT}/gateway/v1/connections/${LOCAL_CONNECTION_ID}`,
  },
  spec: LOCAL_CONNECTION_SPEC,
  status: {},
} satisfies Connection);

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
  } satisfies ConnectionSpec,
  status: {},
} satisfies Connection);

/**
 * Fake spec augmented with `formConnectionType` for test purposes.
 *
 * **NOTE**: This does not include a {@link ConnectionSpec.kafka_cluster Kafka config} or a
 * {@link ConnectionSpec.schema_registry Schema Registry config} by default.
 */
export const TEST_DIRECT_CONNECTION_FORM_SPEC: CustomConnectionSpec = {
  ...ConnectionSpecFromJSON(TEST_DIRECT_CONNECTION.spec),
  id: TEST_DIRECT_CONNECTION_ID, // enforced ConnectionId type
  formConnectionType: "Apache Kafka",
  specifiedConnectionType: undefined,
} satisfies CustomConnectionSpec;
