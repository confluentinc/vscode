import { ObservableScope } from "inertial";
import { applyBindings } from "./bindings/bindings";
import { ViewModel } from "./bindings/view-model";
import { sendWebviewMessage } from "./comms/comms";
import { ConnectedState } from "../clients/sidecar";

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

  kafkaState = this.signal<ConnectedState | undefined>(undefined);
  schemaState = this.signal<ConnectedState | undefined>(undefined);
  kafkaErrorMessage = this.signal<string | undefined>(undefined);
  schemaErrorMessage = this.signal<string | undefined>(undefined);

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

  /** Submit all form data to the extension host */
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
      this.message("Please provide either Kafka cluster or Schema Registry details");
      this.loading(false);
      return;
    }

    let result: PostResponse | TestResponse;
    if (submitter.value === "Test Connection") {
      result = await post("Test", data);
    } else result = await post("Submit", data);
    this.success(result.success);
    this.message(result.message ? result.message : "");
    if ("testResults" in result) {
      this.kafkaState(result.testResults.kafkaState);
      this.schemaState(result.testResults.schemaState);
      this.kafkaErrorMessage(result.testResults.kafkaErrorMessage);
      this.schemaErrorMessage(result.testResults.schemaErrorMessage);
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
