import { ConnectionType } from "../../../src/clients/sidecar";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../../../src/constants";
import type { ConnectionId, EnvironmentId } from "../../../src/models/resource";
import type { BaseViewProviderData } from "../../../src/viewProviders/baseModels/base";
import type { EnvironmentedBaseViewProviderData } from "../../../src/viewProviders/baseModels/parentedBase";
import { TEST_DIRECT_CONNECTION_ID } from "./connection";
import {
  TEST_CCLOUD_ENVIRONMENT_ID,
  TEST_CCLOUD_PROVIDER,
  TEST_CCLOUD_REGION,
} from "./environments";

/** Return a test {@link ConnectionId} for the given {@link ConnectionType} */
export function getTestConnectionIdForType(connectionType: ConnectionType): ConnectionId {
  switch (connectionType) {
    case ConnectionType.Ccloud:
      return CCLOUD_CONNECTION_ID;
    case ConnectionType.Local:
      return LOCAL_CONNECTION_ID;
    case ConnectionType.Direct:
      return TEST_DIRECT_CONNECTION_ID;
    default:
      throw new Error(`Unsupported connection type: ${connectionType}`);
  }
}

/** Return a test {@link EnvironmentId} for the given {@link ConnectionType} */
export function getTestEnvironmentIdForConnectionType(
  connectionType: ConnectionType,
): EnvironmentId {
  switch (connectionType) {
    case ConnectionType.Ccloud:
      return TEST_CCLOUD_ENVIRONMENT_ID;
    case ConnectionType.Local:
      // local connection is treated as an individual environment
      return LOCAL_CONNECTION_ID as unknown as EnvironmentId;
    case ConnectionType.Direct:
      // direct connections are treated as individual environments
      return TEST_DIRECT_CONNECTION_ID as unknown as EnvironmentId;
    default:
      throw new Error(`Unsupported connection type: ${connectionType}`);
  }
}

/**
 * Helper function to create a test object that satisfies {@link BaseViewProviderData}.
 * Uses the CCloud {@link ConnectionType connection type} by default.
 */
export function createTestResource(
  id: string,
  name?: string,
  connectionType: ConnectionType = ConnectionType.Ccloud,
  children?: BaseViewProviderData[],
): BaseViewProviderData {
  return {
    id,
    connectionId: getTestConnectionIdForType(connectionType),
    connectionType,
    searchableText: () => name ?? id,
    children,
  };
}

/** Extended parent resource type that includes optional provider/region for CCloud resources. */
export interface TestParentedResource extends EnvironmentedBaseViewProviderData {
  provider?: string;
  region?: string;
}

/**
 * Helper function to create a test object that satisfies {@link EnvironmentedBaseViewProviderData}.
 * For CCloud resources, also includes default values for the `provider` and `region` properties.
 */
export function createParentedTestResource(
  id: string,
  name?: string,
  connectionType: ConnectionType = ConnectionType.Ccloud,
): TestParentedResource {
  const base: TestParentedResource = {
    id,
    name: name ?? id,
    connectionId: getTestConnectionIdForType(connectionType),
    connectionType,
    environmentId: getTestEnvironmentIdForConnectionType(connectionType),
    searchableText: () => name ?? id,
  };

  if (connectionType === ConnectionType.Ccloud) {
    base.provider = TEST_CCLOUD_PROVIDER;
    base.region = TEST_CCLOUD_REGION;
  }

  return base;
}
