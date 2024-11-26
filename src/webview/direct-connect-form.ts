import { ObservableScope } from "inertial";
import { applyBindings } from "./bindings/bindings";
import { ViewModel } from "./bindings/view-model";
import { sendWebviewMessage } from "./comms/comms";
import { KafkaClusterConfig, SchemaRegistryConfig } from "../clients/sidecar";

/** Instantiate the Inertial scope, document root,
 * and a "view model", an intermediary between the view (UI: .html) and the model (data: directConnect.ts) */
addEventListener("DOMContentLoaded", () => {
  const os = ObservableScope(queueMicrotask);
  const ui = document.querySelector("main")!;
  const vm = new DirectConnectFormViewModel(os);
  applyBindings(ui, os, vm);
});

class DirectConnectFormViewModel extends ViewModel {
  errorMessage = this.signal("");
  success = this.signal(false);
  platformType = this.signal<PlatformOptions>("Other");
  kafkaAuthType = this.signal<SupportedAuthTypes>("None");
  schemaAuthType = this.signal<SupportedAuthTypes>("None");

  updateValue(event: Event) {
    const input = event.target as HTMLInputElement;
    switch (input.name) {
      case "platform":
        this.platformType(input.value as PlatformOptions);
        break;
      case "kafka_auth_type":
        this.kafkaAuthType(input.value as SupportedAuthTypes);
        break;
      case "schema_auth_type":
        this.schemaAuthType(input.value as SupportedAuthTypes);
        break;
      default:
        console.warn(`Unhandled key: ${input.name}`);
    }
  }

  async testConnection(event: Event) {
    event.preventDefault();
    this.success(false);
    this.errorMessage("");
    // const form = event.target as HTMLFormElement;
    // const formData = new FormData(form);
    // const data = Object.fromEntries(formData.entries());
    // TODO not implemented yet
    // const result = await post("TestConnection", data);
    // if (result.success) {
    //   console.log("success", result);
    // } else {
    //   this.errorMessage(result.message ?? "Unknown error occurred");
    //   console.log("error", result);
    // }
  }

  /** Submit all form data to the extension */
  async handleSubmit(event: Event) {
    event.preventDefault();
    this.success(false);
    this.errorMessage("");
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    if (!data["bootstrap_servers"] && !data["uri"]) {
      return this.errorMessage("Please provide either Kafka cluster or Schema Registry details");
    }
    let clusterConfig: KafkaClusterConfig | undefined = undefined;
    let schemaConfig: SchemaRegistryConfig | undefined = undefined;
    if (data["bootstrap_servers"]) {
      clusterConfig = transformFormDataToKafkaConfig(data);
    }
    if (data["uri"]) {
      schemaConfig = transformFormDataToSchemaRegistryConfig(data);
    }
    const result = await post("Submit", {
      name: data.name,
      platform: data.platform,
      clusterConfig,
      schemaConfig,
    });
    this.success(result.success);
    if (!result.success) {
      this.errorMessage(result.message ?? "Unknown error occurred");
    }
  }
}

export type PostResponse = { success: boolean; message: string | null };

export function post(
  type: "TestConnection",
  body: { [key: string]: unknown },
): Promise<PostResponse>;
export function post(type: "Submit", body: { [key: string]: unknown }): Promise<PostResponse>;
export function post(type: any, body: any): Promise<unknown> {
  return sendWebviewMessage(type, body);
}

type PlatformOptions =
  | "Apache Kafka"
  | "Confluent Cloud"
  | "Confluent Platform"
  | "Local"
  | "Other";

type SupportedAuthTypes = "None" | "Basic" | "API";

function transformFormDataToKafkaConfig(formData: any): KafkaClusterConfig {
  let kafkaClusterConfig: KafkaClusterConfig = { bootstrap_servers: "" };
  if (formData.bootstrap_servers) {
    kafkaClusterConfig["bootstrap_servers"] = formData.bootstrap_servers;
  }
  if (formData.kafka_auth_type === "Basic") {
    kafkaClusterConfig = {
      ...kafkaClusterConfig,
      credentials: {
        username: formData.kafka_username,
        password: formData.kafka_password,
      },
    };
  } else if (formData.kafka_auth_type === "API") {
    kafkaClusterConfig = {
      ...kafkaClusterConfig,
      credentials: {
        api_key: formData.kafka_api_key,
        api_secret: formData.kafka_api_secret,
      },
    };
  }

  return kafkaClusterConfig;
}

function transformFormDataToSchemaRegistryConfig(formData: any) {
  let schemaRegistryConfig: SchemaRegistryConfig = { uri: "" };
  if (formData.uri) {
    schemaRegistryConfig["uri"] = formData.uri;
  }
  if (formData.schema_auth_type === "Basic") {
    schemaRegistryConfig = {
      ...schemaRegistryConfig,
      credentials: {
        username: formData.schema_username,
        password: formData.schema_password,
      },
    };
  } else if (formData.schema_auth_type === "API") {
    schemaRegistryConfig = {
      ...schemaRegistryConfig,
      credentials: {
        api_key: formData.schema_api_key,
        api_secret: formData.schema_api_secret,
      },
    };
  }

  return schemaRegistryConfig;
}
