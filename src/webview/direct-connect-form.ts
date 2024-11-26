import { ObservableScope } from "inertial";
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
  errorMessage = this.signal("");
  success = this.signal(false);
  platformType = this.signal<PlatformOptions>("Other");

  updateValue(event: Event) {
    const input = event.target as HTMLInputElement;
    switch (input.name) {
      case "platform":
        this.platformType(input.value as PlatformOptions);
        break;
      default:
        console.warn(`Unhandled key: ${input.name}`);
    }
  }

  async testConnection(event: Event) {
    event.preventDefault();
    this.success(false);
    this.errorMessage("");
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    console.log("formData:", formData, "data", data);
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
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    console.log("formData:", formData, "data", data);
    const result = await post("Submit", data);
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
