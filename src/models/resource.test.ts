import * as assert from "assert";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_DIRECT_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources";
import { ConnectionType } from "../clients/sidecar";
import { CCLOUD_CONNECTION_ID, LOCAL_CONNECTION_ID } from "../constants";
import {
  ConnectionId,
  connectionIdToType,
  getConnectionLabel,
  isCCloud,
  isDirect,
  isLocal,
  isSearchable,
} from "./resource";
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

describe("isSearchable", () => {
  it("should return true for elements that implement a searchableText method", () => {
    const searchable = {
      searchableText: () => "searchable",
    };

    assert.equal(isSearchable(searchable), true);
  });

  it("should return false for elements that don't implement a searchableText method", () => {
    const notSearchable = { name: "searchable" };

    assert.equal(isSearchable(notSearchable), false);
  });

  it("should return false for undefined", () => {
    assert.equal(isSearchable(undefined), false);
  });
});

describe("getConnectionLabel", () => {
  it("should return Local for Local", () => {
    assert.equal(getConnectionLabel(ConnectionType.Local), "Local");
  });

  it("should return Confluent Cloud for Ccloud", () => {
    assert.equal(getConnectionLabel(ConnectionType.Ccloud), "Confluent Cloud");
  });

  it("should return Other for Direct", () => {
    assert.equal(getConnectionLabel(ConnectionType.Direct), "Other");
  });

  it("Should throw an error for an unknown connection type", () => {
    assert.throws(() => getConnectionLabel("unknown" as ConnectionType));
  });
});
