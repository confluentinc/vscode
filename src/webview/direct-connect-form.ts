import { ObservableScope } from "inertial";
import { applyBindings } from "./bindings/bindings";
import { ViewModel } from "./bindings/view-model";
import { sendWebviewMessage } from "./comms/comms";
import {
  ConnectedState,
  instanceOfApiKeyAndSecret,
  instanceOfBasicCredentials,
} from "../clients/sidecar";
import { CustomConnectionSpec } from "../storage/resourceManager";

/** Instantiate the Inertial scope, document root,
 * and a "view model", an intermediary between the view (UI: .html) and the model (data: directConnect.ts) */
addEventListener("DOMContentLoaded", () => {
  const os = ObservableScope(queueMicrotask);
  const ui = document.querySelector("main")!;
  const vm = new DirectConnectFormViewModel(os);
  applyBindings(ui, os, vm);
});

class DirectConnectFormViewModel extends ViewModel {
  /** Load connection spec if it exists (for Edit) */
  spec = this.resolve(async () => {
    const fromHost = await post("GetConnectionSpec", {});
    return fromHost;
  }, null);

  /** Form Input Values */
  platformType = this.derive<FormConnectionType>(() => {
    return this.spec()?.formConnectionType || "Apache Kafka";
  });
  // TODO this is not used anywhere but could be extra metadata for telemetry. We'll have to save it in the spec.
  // otherPlatformType = this.signal<string | undefined>(undefined);
  name = this.derive(() => {
    return this.spec()?.name || "";
  });

  /** Kafka */
  kafkaBootstrapServers = this.derive(() => {
    return this.spec()?.kafka_cluster?.bootstrap_servers || "";
  });
  kafkaCreds = this.derive(() => {
    return this.spec()?.kafka_cluster?.credentials;
  });
  kafkaAuthType = this.derive(() => {
    return this.getCredentialsType(this.kafkaCreds());
  });
  kafkaUsername = this.derive(() => {
    // @ts-expect-error the types don't know which credentials are present
    return this.kafkaCreds()?.username || "";
  });
  kafkaApiKey = this.derive(() => {
    // @ts-expect-error the types don't know which credentials are present
    return this.kafkaCreds()?.api_key || "";
  });
  kafkaSecret = this.derive(() => {
    // if credentials are there it means there is a secret. We handle the secrets in directConnect.ts
    return this.kafkaCreds() ? "fakeplaceholdersecrethere" : "";
  });
  kafkaSslEnabled = this.derive(() => {
    return this.spec()?.kafka_cluster?.ssl?.enabled || this.platformType() === "Confluent Cloud";
  });

  /** Schema Registry */
  schemaUri = this.derive(() => {
    return this.spec()?.schema_registry?.uri || "";
  });
  schemaCreds = this.derive(() => {
    return this.spec()?.schema_registry?.credentials;
  });
  schemaAuthType = this.derive(() => {
    return this.getCredentialsType(this.schemaCreds());
  });
  schemaUsername = this.derive(() => {
    // @ts-expect-error the types don't know which credentials are present
    return this.schemaCreds()?.username || "";
  });
  schemaApiKey = this.derive(() => {
    // @ts-expect-error the types don't know which credentials are present
    return this.schemaCreds()?.api_key || "";
  });
  schemaSecret = this.derive(() => {
    // if credentials are there it means there is a secret. We handle the secrets in directConnect.ts
    return this.schemaCreds() ? "fakeplaceholdersecrethere" : "";
  });
  schemaSslEnabled = this.derive(() => {
    return this.spec()?.schema_registry?.ssl?.enabled || this.platformType() === "Confluent Cloud";
  });

  /** Form State */
  message = this.signal("");
  success = this.signal(false);
  loading = this.signal(false);

  /** Connection state & errors (displayed in UI after Test) */
  kafkaState = this.signal<ConnectedState | undefined>(undefined);
  kafkaErrorMessage = this.signal<string | undefined>(undefined);
  kafkaStatusMessage = this.derive(() => {
    if (this.kafkaState() === "FAILED") return this.kafkaErrorMessage();
    else if (this.kafkaState() === "SUCCESS") return "Connection test succeeded";
    else return `Kafka Cluster state: ${this.kafkaState()}`;
  });
  showKafkaStatus = this.derive(() => {
    return (
      this.kafkaBootstrapServers() != null &&
      this.kafkaState() !== undefined &&
      this.kafkaState() !== "NONE"
    );
  });

  schemaState = this.signal<ConnectedState | undefined>(undefined);
  schemaErrorMessage = this.signal<string | undefined>(undefined);
  schemaStatusMessage = this.derive(() => {
    if (this.schemaState() === "FAILED") return this.schemaErrorMessage();
    else if (this.schemaState() === "SUCCESS") return "Connection test succeeded";
    else return `Schema Registry state: ${this.schemaState()}`;
  });
  showSchemaStatus = this.derive(() => {
    return this.schemaState() !== undefined && this.schemaState() !== "NONE";
  });

  getCredentialsType(creds: any) {
    if (!creds || typeof creds !== "object") return "None";
    if (instanceOfBasicCredentials(creds)) return "Basic";
    if (instanceOfApiKeyAndSecret(creds)) return "API";
    return "None";
  }
  resetTestResults() {
    this.kafkaState(undefined);
    this.kafkaErrorMessage(undefined);
    this.kafkaStatusMessage(undefined);
    this.schemaState(undefined);
    this.schemaErrorMessage(undefined);
    this.schemaStatusMessage(undefined);
  }

  updateValue(event: Event) {
    const input = event.target as HTMLInputElement;
    switch (input.name) {
      case "platform":
        this.platformType(input.value as FormConnectionType);
        if (input.value === "Confluent Cloud") {
          this.kafkaAuthType("API");
          this.schemaAuthType("API");
          this.kafkaSslEnabled(true);
          this.schemaSslEnabled(true);
        }
        break;
      // case "other-platform":
      //   this.otherPlatformType(input.value);
      //   break;
      case "name":
        this.name(input.value);
        break;
      case "bootstrap_servers":
        this.kafkaBootstrapServers(input.value);
        break;
      case "kafka_auth_type":
        this.kafkaAuthType(input.value as SupportedAuthTypes);
        this.clearKafkaCreds();
        break;
      case "schema_auth_type":
        this.schemaAuthType(input.value as SupportedAuthTypes);
        this.clearSchemaCreds();
        break;
      case "uri":
        this.schemaUri(input.value);
        break;
      case "kafka_username":
        this.kafkaUsername(input.value);
        break;
      case "kafka_api_key":
        this.kafkaApiKey(input.value);
        break;
      case "schema_username":
        this.schemaUsername(input.value);
        break;
      case "schema_api_key":
        this.schemaApiKey(input.value);
        break;
      case "kafka_ssl":
        this.kafkaSslEnabled(input.checked);
        break;
      case "schema_ssl":
        this.schemaSslEnabled(input.checked);
        break;
      default:
        console.warn(`Unhandled input update: ${input.name}`);
    }
  }

  clearKafkaCreds() {
    this.kafkaUsername("");
    this.kafkaApiKey("");
    this.kafkaSecret("");
  }

  clearSchemaCreds() {
    this.schemaUsername("");
    this.schemaApiKey("");
    this.schemaSecret("");
  }

  /** Submit all form data to the extension host */
  async handleSubmit(event: SubmitEvent) {
    event.preventDefault();
    this.resetTestResults();
    this.success(false);
    this.message("");
    this.loading(true);
    const form = event.target as HTMLFormElement;
    const submitter = event.submitter as HTMLInputElement;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());

    if (!data["bootstrap_servers"] && !data["uri"]) {
      this.message("Please provide either Kafka cluster or Schema Registry details");
      this.loading(false);
      return;
    }

    let result: PostResponse | TestResponse;
    if (submitter.value === "Test") {
      result = await post("Test", data);
    } else if (submitter.value === "Update") {
      result = await post("Update", data);
    } else result = await post("Submit", data);
    this.success(result.success);
    this.message(result.message ? result.message : "");
    if ("testResults" in result) {
      this.kafkaState(result.testResults.kafkaState);
      this.schemaState(result.testResults.schemaState);
      this.kafkaErrorMessage(result.testResults.kafkaErrorMessage || "");
      this.schemaErrorMessage(result.testResults.schemaErrorMessage || "");
    }
    this.loading(false);
  }
}

export type PostResponse = { success: boolean; message: string | null };
export type TestResponse = {
  success: boolean;
  message: string | null;
  testResults: {
    kafkaState?: ConnectedState;
    kafkaErrorMessage?: string;
    schemaState?: ConnectedState;
    schemaErrorMessage?: string;
  };
};

export function post(type: "Test", body: any): Promise<TestResponse>;
export function post(type: "Submit", body: any): Promise<PostResponse>;
export function post(type: "GetConnectionSpec", body: any): Promise<CustomConnectionSpec | null>;
export function post(type: "Update", body: { [key: string]: unknown }): Promise<PostResponse>;
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
