import { ObservableScope } from "inertial";
import { KafkaClusterConfig, SchemaRegistryConfig } from "../clients/sidecar";
import { applyBindings } from "./bindings/bindings";
import { ViewModel } from "./bindings/view-model";
import { sendWebviewMessage } from "./comms/comms";

/** Instantiate the Inertial scope, document root,
 * and a "view model", an intermediary between the view (UI: .html) and the model (data: directConnect.ts) */
addEventListener("DOMContentLoaded", () => {
  const os = ObservableScope(queueMicrotask);
  const ui = document.querySelector("main")!;
  const vm = new DirectConnectFormViewModel(os);
  applyBindings(ui, os, vm);
});

class DirectConnectFormViewModel extends ViewModel {
  /** Form Input Values */
  platformType = this.signal<FormConnectionType>("Apache Kafka");
  kafkaAuthType = this.signal<SupportedAuthTypes>("None");
  schemaAuthType = this.signal<SupportedAuthTypes>("None");
  schemaUri = this.signal("");
  kafkaBootstrapServers = this.signal("");

  /** Form State */
  message = this.signal("");
  success = this.signal(false);
  loading = this.signal(false);

  updateValue(event: Event) {
    const input = event.target as HTMLInputElement;
    switch (input.name) {
      case "platform":
        this.platformType(input.value as FormConnectionType);
        if (input.value === "Confluent Cloud") {
          this.kafkaAuthType("API");
          this.schemaAuthType("API");
        } else {
          this.kafkaAuthType("None");
          this.schemaAuthType("None");
        }
        break;
      case "kafka_auth_type":
        this.kafkaAuthType(input.value as SupportedAuthTypes);
        break;
      case "schema_auth_type":
        this.schemaAuthType(input.value as SupportedAuthTypes);
        break;
      case "uri":
        this.schemaUri(input.value);
        break;
      case "bootstrap_servers":
        this.kafkaBootstrapServers(input.value);
        break;
      default:
        console.warn(`Unhandled key: ${input.name}`);
    }
  }

  /** Submit all form data to the extension */
  async handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    this.success(false);
    this.message("");
    this.loading(true);
    const form = event.target as HTMLFormElement;
    const submitter = event.submitter as HTMLInputElement;
    const formData = new FormData(form);

    const data = Object.fromEntries(formData.entries());
    if (!data["bootstrap_servers"] && !data["uri"]) {
      return this.message("Please provide either Kafka cluster or Schema Registry details");
    }

    let clusterConfig: KafkaClusterConfig | undefined = undefined;
    let schemaConfig: SchemaRegistryConfig | undefined = undefined;
    if (data["bootstrap_servers"]) {
      clusterConfig = transformFormDataToKafkaConfig(data);
    }
    if (data["uri"]) {
      schemaConfig = transformFormDataToSchemaRegistryConfig(data);
    }

    let result;
    if (submitter.value === "Test Connection") {
      result = await post("TestConnection", {
        name: data.name,
        platform: data.platform,
        clusterConfig,
        schemaConfig,
        dryRun: true,
      });
    } else {
      result = await post("Submit", {
        name: data.name,
        platform: data.platform,
        clusterConfig,
        schemaConfig,
        dryRun: false,
      });
    }
    this.success(result.success);
    this.message(result.message ?? "");
    this.loading(false);
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

/** Similar to {@link ConnectionType}, but only used for telemetry purposes. */
export type FormConnectionType =
  | "Apache Kafka"
  | "Confluent Cloud"
  | "Confluent Platform"
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
