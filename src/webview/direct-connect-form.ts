import { ObservableScope } from "inertial";
import { ConnectedState } from "../clients/sidecar";
import { FormConnectionType, SupportedAuthTypes } from "../directConnections/types";
import { CustomConnectionSpec } from "../storage/resourceManager";
import { AuthCredentials } from "./auth-credentials";
import { applyBindings } from "./bindings/bindings";
import { ViewModel } from "./bindings/view-model";
import { sendWebviewMessage } from "./comms/comms";
import { SslConfig } from "./ssl-config-inputs";
// Register the custom element
customElements.define("ssl-config", SslConfig);
customElements.define("auth-credentials", AuthCredentials);
/** Instantiate the Inertial scope, document root,
 * and a "view model", an intermediary between the view (UI: .html) and the model (data: directConnect.ts) */
addEventListener("DOMContentLoaded", () => {
  const os = ObservableScope(queueMicrotask);
  const ui = document.querySelector("main")!;
  const vm = new DirectConnectFormViewModel(os);
  applyBindings(ui, os, vm);
  vm.setupEnterKeyHandler();
});

class DirectConnectFormViewModel extends ViewModel {
  /** Load connection spec if it exists (for Edit) */
  spec = this.resolve(async () => {
    const fromHost = await post("GetConnectionSpec", {});
    return fromHost;
  }, null);

  getAuthTypes = this.resolve(async () => {
    return await post("GetAuthTypes", {});
  }, null);
  /** Form Input Values */
  platformType = this.derive<FormConnectionType>(() => {
    return this.spec()?.formConnectionType || "Apache Kafka";
  });
  otherPlatformType = this.derive(() => {
    return this.platformType() === "Other" && this.spec()?.specifiedConnectionType
      ? this.spec()?.specifiedConnectionType
      : null;
  });

  name = this.derive(() => {
    return this.spec()?.name || "";
  });

  /** Kafka */
  kafkaBootstrapServers = this.derive(() => {
    return this.spec()?.kafka_cluster?.bootstrap_servers ?? null;
  });
  kafkaCreds = this.derive(() => {
    return this.spec()?.kafka_cluster?.credentials;
  });
  kafkaAuthType = this.derive(() => {
    return this.getAuthTypes()?.kafka ?? "None";
  });

  kafkaSslEnabled = this.derive(() => {
    if (this.spec()?.kafka_cluster?.ssl?.enabled === false) return false;
    else return true;
  });
  kafkaSslConfig = this.derive(() => {
    return this.spec()?.kafka_cluster?.ssl || {};
  });

  /** Schema Registry */
  schemaUri = this.derive(() => {
    return this.spec()?.schema_registry?.uri ?? null;
  });
  schemaCreds = this.derive(() => {
    return this.spec()?.schema_registry?.credentials;
  });
  schemaAuthType = this.derive(() => {
    return this.getAuthTypes()?.schema || "None";
  });
  schemaSslEnabled = this.derive(() => {
    if (this.spec()?.schema_registry?.ssl?.enabled === false) return false;
    else return true;
  });
  schemaSslConfig = this.derive(() => {
    return this.spec()?.schema_registry?.ssl || {};
  });
  /** Form State */
  message = this.signal("");
  success = this.signal(false);
  loading = this.signal(false);
  imported = this.derive(() => {
    return this.spec()?.id === "FILE_UPLOAD" ? true : false;
  });
  editing = this.derive(() => {
    if (this.spec()?.id && !this.imported()) return true;
    else return false;
  });
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
    return (
      this.schemaUri() != null && this.schemaState() !== undefined && this.schemaState() !== "NONE"
    );
  });

  resetTestResults() {
    this.kafkaState(undefined);
    this.kafkaErrorMessage(undefined);
    this.kafkaStatusMessage(undefined);
    this.schemaState(undefined);
    this.schemaErrorMessage(undefined);
    this.schemaStatusMessage(undefined);
  }

  async getFile(detail: { inputId: string }) {
    const newPath = await post("GetFilePath", detail);
    if (newPath) this.spec(await post("GetConnectionSpec", {}));
  }
  async updateValue(event: Event) {
    const input = event.target as HTMLInputElement;
    const value = input.type === "checkbox" ? input.checked : input.value;

    // auth_type doesn't exist in spec; used to determine which credentials to include
    if (input.name !== "kafka_cluster.auth_type" && input.name !== "schema_registry.auth_type") {
      await post("UpdateSpecValue", { inputName: input.name, inputValue: value });
    } else {
      await post("SaveFormAuthType", {
        inputName: input.name,
        inputValue: value as SupportedAuthTypes,
      });
    }
    // The switch statement performs local side effects for certain inputs
    switch (input.name) {
      case "formconnectiontype":
        this.platformType(input.value as FormConnectionType);
        if (input.value === "Confluent Cloud") {
          this.kafkaSslEnabled(true);
          this.schemaSslEnabled(true);
        }
        break;
      case "kafka_cluster.auth_type":
        this.kafkaAuthType(input.value as SupportedAuthTypes);
        break;
      case "schema_registry.auth_type":
        this.schemaAuthType(input.value as SupportedAuthTypes);
        break;
      case "kafka_cluster.ssl.enabled":
        this.kafkaSslEnabled(input.checked);
        break;
      case "schema_registry.ssl.enabled":
        this.schemaSslEnabled(input.checked);
        break;
      case "kafka_cluster.bootstrap_servers":
        this.kafkaBootstrapServers(input.value);
        break;
      case "schema_registry.uri":
        this.schemaUri(input.value);
        break;
      default:
        console.info(`No side effects for input update: ${input.name}`);
    }
  }
  /** This is a workaround for the default behavior of Enter key in forms
   * Normally Enter submits the form with the first submit button, which would be "Test"
   * We want Enter to trigger the "Save" or "Update" button instead
   */
  setupEnterKeyHandler() {
    const form = document.querySelector("form.form-container");
    if (form) {
      form.addEventListener("keydown", (e: Event) => {
        const keyEvent = e as KeyboardEvent;
        if (
          keyEvent.key === "Enter" &&
          keyEvent.target instanceof HTMLElement &&
          keyEvent.target.tagName !== "TEXTAREA"
        ) {
          e.preventDefault();
          const saveButton = Array.from(form.querySelectorAll('input[type="submit"]')).find(
            (btn) =>
              (btn as HTMLInputElement).value === "Save" ||
              (btn as HTMLInputElement).value === "Update",
          );
          if (saveButton) {
            (saveButton as HTMLInputElement).click();
          }
        }
      });
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

    if (!data["kafka_cluster.bootstrap_servers"] && !data["schema_registry.uri"]) {
      this.message("Please provide either Kafka cluster or Schema Registry details");
      this.loading(false);
      return;
    }
    // Check form validity before proceeding
    if (!form.checkValidity()) {
      form.reportValidity();
      this.message("Please fill in all required fields correctly");
      this.loading(false);
      return;
    }
    if (data["formconnectiontype"] === "Confluent Cloud") {
      // these fields are disabled when CCloud selected; add them back in form data
      data["kafka_cluster.ssl.enabled"] = "true";
      data["schema_registry.ssl.enabled"] = "true";
    }

    // checkbox fields are not sent if the user unchecks them; add them back in form data
    if (!this.kafkaSslEnabled()) {
      data["kafka_cluster.ssl.enabled"] = "false";
    }
    if (!this.schemaSslEnabled()) {
      data["schema_registry.ssl.enabled"] = "false";
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
export function post(type: "Update", body: { [key: string]: unknown }): Promise<PostResponse>;
export function post(
  type: "GetConnectionSpec",
  body: any,
): Promise<Partial<CustomConnectionSpec> | null>;
export function post(
  type: "UpdateSpecValue",
  body: { inputName: string; inputValue: string | boolean },
): Promise<null>;
export function post(
  type: "GetAuthTypes",
  body: any,
): Promise<{ kafka: SupportedAuthTypes; schema: SupportedAuthTypes }>;
export function post(type: "GetFilePath", body: { inputId: string }): Promise<string>;
export function post(
  type: "SaveFormAuthType",
  body: { inputName: string; inputValue: SupportedAuthTypes },
): Promise<null>;
export function post(type: any, body: any): Promise<unknown> {
  return sendWebviewMessage(type, body);
}
