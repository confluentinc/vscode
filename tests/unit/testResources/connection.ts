import { randomUUID } from "crypto";
import type { Connection, ConnectionSpec, UserInfo } from "../../../src/connections";
import {
  ConnectedState,
  ConnectionFromJSON,
  connectionSpecFromJSON,
  ConnectionType,
} from "../../../src/connections";
import {
  CCLOUD_AUTH_CALLBACK_URI,
  CCLOUD_CONNECTION_SPEC,
  LOCAL_CONNECTION_SPEC,
} from "../../../src/constants";
import type { ConnectionId } from "../../../src/models/resource";
import type { CustomConnectionSpec } from "../../../src/storage/resourceManager";
import { TEST_CCLOUD_ORGANIZATION } from "./organization";

export const TEST_CCLOUD_USER: UserInfo = {
  id: "test-user-id",
  username: "test-user",
  firstName: "Test",
  lastName: "User",
  socialConnection: "test-social",
  authType: "test-auth",
};
const TEST_AUTH_EXPIRATION = new Date(Date.now() + 4 * 60 * 60 * 1000);

/** A basic CCloud {@link Connection} with `NONE` connected state. */
export const TEST_CCLOUD_CONNECTION: Connection = ConnectionFromJSON({
  spec: {
    ...CCLOUD_CONNECTION_SPEC,
    ccloudConfig: {
      organizationId: TEST_CCLOUD_ORGANIZATION.id,
      ideAuthCallbackUri: CCLOUD_AUTH_CALLBACK_URI,
    },
  },
  metadata: {
    signInUri: `http://login.confluent.io/login?...`,
  },
  status: {
    // start with unauthenticated connection, then switch to ConnectedState.SUCCESS and
    // add TEST_CCLOUD_USER and TEST_AUTH_EXPIRATION later
    ccloud: {
      state: ConnectedState.NONE,
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
      requiresAuthenticationAt: TEST_AUTH_EXPIRATION,
      state: ConnectedState.SUCCESS,
      user: TEST_CCLOUD_USER,
    },
  },
} satisfies Connection);

export const TEST_LOCAL_CONNECTION: Connection = ConnectionFromJSON({
  spec: LOCAL_CONNECTION_SPEC,
  metadata: {},
  status: {},
} satisfies Connection);

export const TEST_DIRECT_CONNECTION_ID = randomUUID() as ConnectionId;
export const TEST_DIRECT_CONNECTION: Connection = ConnectionFromJSON({
  spec: {
    id: TEST_DIRECT_CONNECTION_ID,
    name: "New Connection",
    type: ConnectionType.Direct,
  } satisfies ConnectionSpec,
  metadata: {},
  status: {},
} satisfies Connection);

/**
 * Fake spec augmented with `formConnectionType` for test purposes.
 *
 * **NOTE**: This does not include a {@link ConnectionSpec.kafkaCluster Kafka config} or a
 * {@link ConnectionSpec.schemaRegistry Schema Registry config} by default.
 */
export const TEST_DIRECT_CONNECTION_FORM_SPEC: CustomConnectionSpec = {
  ...connectionSpecFromJSON(TEST_DIRECT_CONNECTION.spec),
  id: TEST_DIRECT_CONNECTION_ID, // enforced ConnectionId type
  formConnectionType: "Apache Kafka",
  specifiedConnectionType: undefined,
} satisfies CustomConnectionSpec;
