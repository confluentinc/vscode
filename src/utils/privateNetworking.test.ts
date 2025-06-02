import assert from "assert";
import sinon from "sinon";
import { Uri } from "vscode";
import {
  TEST_CCLOUD_KAFKA_CLUSTER,
  TEST_CCLOUD_PROVIDER,
  TEST_CCLOUD_REGION,
  TEST_CCLOUD_SCHEMA_REGISTRY,
} from "../../tests/unit/testResources";
import * as ccloudStateHandling from "../authn/ccloudStateHandling";
import * as notifications from "../notifications";
import {
  containsPrivateNetworkPattern,
  showPrivateNetworkingHelpNotification,
} from "./privateNetworking";

describe("utils/privateNetworking.ts containsPrivateNetworkPattern()", () => {
  it("should return false for null or empty strings", () => {
    assert.strictEqual(containsPrivateNetworkPattern(""), false);
    assert.strictEqual(containsPrivateNetworkPattern(null as unknown as string), false);
    assert.strictEqual(containsPrivateNetworkPattern(undefined as unknown as string), false);
  });

  it("should return true for URLs containing private networking substrings", () => {
    assert.strictEqual(
      containsPrivateNetworkPattern(
        `${TEST_CCLOUD_KAFKA_CLUSTER.id}-ap123.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.accesspoint.glb.confluent.cloud`,
      ),
      true,
    );
    assert.strictEqual(
      containsPrivateNetworkPattern(
        `${TEST_CCLOUD_KAFKA_CLUSTER.id}-abc123.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.glb.confluent.cloud`,
      ),
      true,
    );
    assert.strictEqual(
      containsPrivateNetworkPattern(
        `${TEST_CCLOUD_KAFKA_CLUSTER.id}.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.private.confluent.cloud"`,
      ),
      true,
    );
    assert.strictEqual(
      containsPrivateNetworkPattern(
        `${TEST_CCLOUD_KAFKA_CLUSTER.id}.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.intranet.confluent.cloud`,
      ),
      true,
    );
  });

  it("should return true for URLs matching private networking regex patterns", () => {
    assert.strictEqual(
      containsPrivateNetworkPattern(
        `${TEST_CCLOUD_KAFKA_CLUSTER.id}.dom123456.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.confluent.cloud`,
      ),
      true,
    );
    assert.strictEqual(
      containsPrivateNetworkPattern(
        `${TEST_CCLOUD_KAFKA_CLUSTER.id}.doma1b2c3.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.confluent.cloud`,
      ),
      true,
    );
    assert.strictEqual(
      containsPrivateNetworkPattern(
        `${TEST_CCLOUD_KAFKA_CLUSTER.id}.domzzzzzz.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.confluent.cloud`,
      ),
      true,
    );
  });

  it("should return false for URLs that don't match private networking substrings or regex patterns", () => {
    // test fixtures use public URLs by default
    assert.strictEqual(
      containsPrivateNetworkPattern(TEST_CCLOUD_KAFKA_CLUSTER.bootstrapServers),
      false,
    );
    assert.strictEqual(containsPrivateNetworkPattern(TEST_CCLOUD_SCHEMA_REGISTRY.uri), false);
    // intranet or private are fine, but not superprivateinternet
    assert.strictEqual(
      containsPrivateNetworkPattern(
        `${TEST_CCLOUD_KAFKA_CLUSTER.id}.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.superprivateinternet.confluent.cloud`,
      ),
      false,
    );
    // no captialization
    assert.strictEqual(
      containsPrivateNetworkPattern(
        `${TEST_CCLOUD_KAFKA_CLUSTER.id}.domABABAB.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.confluent.cloud`,
      ),
      false,
    );
    // too long
    assert.strictEqual(
      containsPrivateNetworkPattern(
        `${TEST_CCLOUD_KAFKA_CLUSTER.id}.domfoobarbaz.${TEST_CCLOUD_REGION}.${TEST_CCLOUD_PROVIDER}.confluent.cloud`,
      ),
      false,
    );
  });
});

describe("utils/privateNetworking.ts showPrivateNetworkingHelpNotification()", () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it("should show a notification with default values when no options provided", () => {
    const showErrorStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");
    const openExternalStub = sandbox.stub(ccloudStateHandling, "openExternal");

    showPrivateNetworkingHelpNotification();

    sinon.assert.calledOnce(showErrorStub);
    const message = showErrorStub.firstCall.args[0];
    const buttons: notifications.NotificationButtons | undefined = showErrorStub.firstCall.args[1];

    assert.strictEqual(
      message,
      "Unable to connect to resource: undefined. This appears to be a private networking configuration issue. Verify your network settings and VPN configuration to access private Confluent resources.",
    );

    assert.ok(buttons);
    assert.ok("View Docs" in buttons, "Should have a 'View Docs' button");

    // Call the button callback and verify it opens the docs URL
    buttons["View Docs"]();
    sinon.assert.calledOnce(openExternalStub);
    sinon.assert.calledWith(
      openExternalStub,
      Uri.parse("https://docs.confluent.io/cloud/current/networking/overview.html"),
    );
  });

  it("should format message with resource name and type when provided", () => {
    const showErrorStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");

    showPrivateNetworkingHelpNotification({
      resourceName: "test-cluster",
      resourceType: "Kafka cluster",
      resourceUrl: "kafka.private.confluent.cloud",
    });

    sinon.assert.calledOnce(showErrorStub);
    const message = showErrorStub.firstCall.args[0];

    assert.strictEqual(
      message,
      'Unable to connect to Kafka cluster "test-cluster": kafka.private.confluent.cloud. This appears to be a private networking configuration issue. Verify your network settings and VPN configuration to access private Confluent resources.',
    );
  });

  it("should include default error notification buttons", () => {
    sandbox.stub(notifications, "DEFAULT_ERROR_NOTIFICATION_BUTTONS").value({
      "Open Logs": sinon.stub(),
      "File Issue": sinon.stub(),
    });

    const showErrorStub = sandbox.stub(notifications, "showErrorNotificationWithButtons");

    showPrivateNetworkingHelpNotification();

    sinon.assert.calledOnce(showErrorStub);
    const buttons: notifications.NotificationButtons | undefined = showErrorStub.firstCall.args[1];

    assert.ok(buttons);
    assert.ok("Open Logs" in buttons, "Should include 'Open Logs' button");
    assert.ok("File Issue" in buttons, "Should include 'File Issue' button");
  });
});
