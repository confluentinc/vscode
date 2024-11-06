import { window } from "vscode";
import { getLocalKafkaImageName, getLocalSchemaRegistryImageName } from "../configs";
import { LocalResourceWorkflow } from "./base";
import { ConfluentLocalWorkflow } from "./confluent-local";
import { ConfluentPlatformSchemaRegistryWorkflow } from "./cp-schema-registry";

/** Determine which Kafka workflow to use based on the user-selected configuration. */
export function getKafkaWorkflow(): LocalResourceWorkflow {
  const imageRepo: string = getLocalKafkaImageName();
  let workflow: LocalResourceWorkflow;
  switch (imageRepo) {
    case ConfluentLocalWorkflow.imageRepo:
      workflow = ConfluentLocalWorkflow.getInstance();
      break;
    // TODO: add support for other images here (apache/kafka, etc.)
    default: {
      const errorMsg = `Unsupported Kafka image repo: ${imageRepo}`;
      window.showErrorMessage(errorMsg);
      throw new Error(errorMsg);
    }
  }
  return workflow;
}

/** Determine which Schema Registry workflow to use based on the user-selected configuration. */
export function getSchemaRegistryWorkflow(): LocalResourceWorkflow {
  const imageRepo: string = getLocalSchemaRegistryImageName();
  let workflow: LocalResourceWorkflow;
  switch (imageRepo) {
    case ConfluentPlatformSchemaRegistryWorkflow.imageRepo:
      workflow = ConfluentPlatformSchemaRegistryWorkflow.getInstance();
      break;
    default: {
      const errorMsg = `Unsupported Schema Registry image repo: ${imageRepo}`;
      window.showErrorMessage(errorMsg);
      throw new Error(errorMsg);
    }
  }
  return workflow;
}
