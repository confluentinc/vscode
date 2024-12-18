import { ObservableScope } from "inertial";
import { applyBindings } from "./bindings/bindings";
import { ViewModel } from "./bindings/view-model";
import { sendWebviewMessage } from "./comms/comms";
import { ConnectedState } from "../clients/sidecar";
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
    return await post("GetConnectionSpec", {});
  }, null);

  /** Form Input Values */
  platformType = this.signal<FormConnectionType>("Apache Kafka");
  name = this.derive(() => {
    return this.spec()?.name || "";
  });
  kafkaBootstrapServers = this.derive(() => {
    return this.spec()?.kafka_cluster?.bootstrap_servers || "";
  });
  kafkaAuthType = this.derive(() => {
    let authType = "None";
    // @ts-expect-error the types don't specify credentials beyond Object
    if (this.spec()?.kafka_cluster?.credentials?.api_key) {
      console.log("credentials", this.spec()?.kafka_cluster?.credentials);
      // FIXME this is kinda dumb
      authType = "API";
      // @ts-expect-error the types don't specify credentials beyond Object
    } else if (this.spec()?.kafka_cluster?.credentials?.username) {
      authType = "Basic";
    }
    return authType;
  });
  kafkaUsername = this.derive(() => {
    // @ts-expect-error the types don't specify credentials
    return this.spec()?.kafka_cluster?.credentials?.username || "";
  });
  kafkaApiKey = this.derive(() => {
    // @ts-expect-error the types don't specify credentials
    return this.spec()?.kafka_cluster?.credentials?.api_key || "";
  });
  kafkaSecret = this.derive(() => {
    return this.spec()?.kafka_cluster?.credentials ? "fakeplaceholdersecrethere" : "";
  });
  schemaUri = this.derive(() => {
    return this.spec()?.schema_registry?.uri || "";
  });
  schemaAuthType = this.derive(() => {
    let authType = "None";
    // @ts-expect-error the types don't specify credentials beyond Object
    if (this.spec()?.schema_registry?.credentials?.api_key) {
      console.log("credentials", this.spec()?.schema_registry?.credentials);
      // FIXME this is kinda dumb
      authType = "API";
      // @ts-expect-error the types don't specify credentials beyond Object
    } else if (this.spec()?.schema_registry?.credentials?.username) {
      authType = "Basic";
    }
    return authType;
  });
  schemaUsername = this.derive(() => {
    // @ts-expect-error the types don't specify credentials
    return this.spec()?.schema_registry?.credentials?.username || "";
  });
  schemaApikey = this.derive(() => {
    // @ts-expect-error the types don't specify credentials
    return this.spec()?.schema_registry?.credentials?.api_key || "";
  });

  /** Form State */
  message = this.signal("");
  success = this.signal(false);
  loading = this.signal(false);

  /** Connection state & errors (seen after testing) */
  kafkaState = this.signal<ConnectedState | undefined>(undefined);
  kafkaErrorMessage = this.signal<string | undefined>(undefined);
  kafkaStatusMessage = this.derive(() => {
    if (this.kafkaState() === "FAILED") {
      return this.kafkaErrorMessage();
    } else if (this.kafkaState()) return "Connection test succeeded";
    else return undefined;
  });
  schemaState = this.signal<ConnectedState | undefined>(undefined);
  schemaErrorMessage = this.signal<string | undefined>(undefined);
  schemaStatusMessage = this.derive(() => {
    if (this.schemaState() === "FAILED") {
      return this.schemaErrorMessage();
    } else if (this.schemaState()) return "Connection test succeeded";
    else return undefined;
  });

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
      case "name":
        this.name(input.value);
        break;
      default:
        console.warn(`Unhandled input update: ${input.name}`);
    }
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
    if (submitter.value === "Test Connection") {
      result = await post("Test", data);
    } else if (submitter.value === "Update Connection") {
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
