import * as assert from "assert";
import { LocalResourceKind } from "../constants";
import { LocalResourceWorkflow } from "./base";
import { registerLocalResourceWorkflows } from "./workflowInitialization";

describe("docker/workflows/workflowInitialization.ts registerLocalResourceWorkflows()", () => {
  // clear the registry before and after tests
  beforeEach(() => {
    LocalResourceWorkflow["workflowRegistry"].clear();
  });
  afterEach(() => {
    LocalResourceWorkflow["workflowRegistry"].clear();
  });

  it("should register all local resource workflows", () => {
    // nothing should be available at first
    assert.strictEqual(LocalResourceWorkflow["workflowRegistry"].size, 0);
    assert.throws(() => LocalResourceWorkflow.getKafkaWorkflow(), /Unsupported Kafka image repo/);
    assert.throws(
      () => LocalResourceWorkflow.getSchemaRegistryWorkflow(),
      /Unsupported Schema Registry image repo/,
    );

    // register the workflows
    registerLocalResourceWorkflows();

    // check that the workflows are registered
    assert.doesNotThrow(
      () => LocalResourceWorkflow.getKafkaWorkflow(),
      /Unsupported Kafka image repo/,
    );
    assert.doesNotThrow(
      () => LocalResourceWorkflow.getSchemaRegistryWorkflow(),
      /Unsupported Schema Registry image repo/,
    );

    // just check some basics of the registered workflows; other tests handle the details for the
    // workflow properties themselves
    const kafkaWorkflow = LocalResourceWorkflow.getKafkaWorkflow();
    assert.strictEqual(kafkaWorkflow.resourceKind, LocalResourceKind.Kafka);
    const schemaRegistryWorkflow = LocalResourceWorkflow.getSchemaRegistryWorkflow();
    assert.strictEqual(schemaRegistryWorkflow.resourceKind, LocalResourceKind.SchemaRegistry);
  });
});
