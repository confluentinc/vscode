import * as assert from "assert";
import {
  TEST_CCLOUD_KAFKA_TOPIC,
  TEST_DIRECT_KAFKA_TOPIC,
  TEST_LOCAL_KAFKA_TOPIC,
} from "../../tests/unit/testResources";
import { isCCloud, isDirect, isLocal } from "./resource";
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
