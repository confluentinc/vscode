import * as assert from "assert";
import sinon from "sinon";
import * as projectGenModule from ".";
import { ConnectionType } from "../clients/sidecar/models/ConnectionType";
import { ResourceLoader } from "../loaders";
import { ConnectionId, EnvironmentId } from "../models/resource";
import { Schema, Subject } from "../models/schema";
import { SchemaRegistry } from "../models/schemaRegistry";
import { KafkaTopic } from "../models/topic";
import * as notificationsModule from "../notifications";
import { resourceScaffoldProjectRequest } from "./commands";

describe.only("resourceScaffoldProjectRequest", function () {
  let sandbox: sinon.SinonSandbox;
  let scaffoldProjectRequestStub: sinon.SinonStub;
  let showErrorNotificationWithButtonsStub: sinon.SinonStub;

  beforeEach(function () {
    sandbox = sinon.createSandbox();
    scaffoldProjectRequestStub = sandbox.stub(projectGenModule, "scaffoldProjectRequest");
    showErrorNotificationWithButtonsStub = sandbox.stub(
      notificationsModule,
      "showErrorNotificationWithButtons",
    );
  });

  afterEach(function () {
    sandbox.restore();
  });

  it("should handle KafkaCluster resource", async function () {
  
  });

  it("should handle KafkaTopic resource", async function () {
  
  });

  it("should handle CCloudFlinkComputePool resource", async function () {
    });
  });

  it("should show error for unsupported resource type", async function () {
  });
});
