import * as assert from "assert";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_DIRECT_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../constants";
import { ConnectionId, connectionIdToType, isCCloud, isDirect, isLocal } from "./resource";
import { KafkaTopic } from "./topic";

type ConnectionTypeMatches = [KafkaTopic, boolean, boolean, boolean];

const connectionTypeMatches: ConnectionTypeMatches[] = [
  [TEST_LOCAL_KAFKA_TOPIC, true, false, false],
  [TEST_CCLOUD_KAFKA_TOPIC, false, true, false],
  [TEST_DIRECT_KAFKA_TOPIC, false, false, true],
];

describe("isLocal/isCCloud/isDirect helper functions", () => {
  for (const [resource, local, cloud, direct] of connectionTypeMatches) {
    it(`isLocal() should return ${local} if the connectionType is "${resource.connectionType}"`, () => {
      assert.equal(isLocal(resource), local);
    });
    it(`isCCloud() should return ${cloud} if the connectionType is "${resource.connectionType}"`, () => {
      assert.equal(isCCloud(resource), cloud);
    });
    it(`isDirect() should return ${direct} if the connectionType is "${resource.connectionType}"`, () => {
      assert.equal(isDirect(resource), direct);
    });
  }
});

describe("connectionIdToType tests", () => {
  it("should return Local for LOCAL_CONNECTION_ID", () => {
    assert.equal(connectionIdToType(LOCAL_CONNECTION_ID), ConnectionType.Local);
  });
  it("should return Ccloud for CCLOUD_CONNECTION_ID", () => {
    assert.equal(connectionIdToType(CCLOUD_CONNECTION_ID), ConnectionType.Ccloud);
  });
  it("should return Direct for a UUID", () => {
    assert.equal(
      connectionIdToType("123e4567-e89b-12d3-a456-426614174000" as ConnectionId),
      ConnectionType.Direct,
    );
  });
});
