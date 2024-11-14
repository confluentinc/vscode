import { ObservableScope } from "inertial";
import { applyBindings } from "./bindings/bindings";
import { ViewModel } from "./bindings/view-model";
import { sendWebviewMessage } from "./comms/comms";

/** Instantiate the Inertial scope, document root,
 * and a "view model", an intermediary between the view (UI: .html) and the model (data: topics.ts) */
addEventListener("DOMContentLoaded", () => {
  const os = ObservableScope(queueMicrotask);
  const ui = document.querySelector("main")!;
  const vm = new ConfigFormViewModel(os);
  applyBindings(ui, os, vm);
});

class ConfigFormViewModel extends ViewModel {
  topicName = this.resolve(async () => {
    return await post("GetTopicName", {});
  }, "");

  // Individual form fields that keep up-to-date with user changes in HTML
  cleanupPolicy = this.resolve(async () => {
    return await post("GetCleanupPolicy", {});
  }, "");

  retentionSize = this.resolve(async () => {
    return await post("GetRetentionSize", {});
  }, "");

  retentionMs = this.resolve(async () => {
    return await post("GetRetentionMs", {});
  }, "");

  maxMessageBytes = this.resolve(async () => {
    return await post("GetMaxMessageBytes", {});
  }, "");

  hasChanges = this.signal(false);
  validationError = this.signal("");
  errorOnSubmit = this.signal("");
  success = this.signal(false);

  handleChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.hasChanges(true);
    this.updateLocalValue(input.name, input.value);
    this.validateChange(event);
  }

  /** Validate changes one input at a time on blur or ui change
   * Checks that the change is valid using the API
   * If the change is valid, remove any existing errors
   * If the change is invalid, highlight input + add error msg
   */
  async validateChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const res = await post("ValidateConfigValue", {
      [input.name]: input.value,
    });
    if (res.success) {
      this.validationError("");
      input.classList.remove("error");
      const errorMsgElement = input.previousElementSibling;
      if (errorMsgElement && errorMsgElement.classList.contains("error")) {
        errorMsgElement.remove();
      }
    } else {
      this.validationError(res.message ?? "Unknown error occurred");
      input.classList.add("error");
      const errorMsgElement = document.createElement("div");
      errorMsgElement.className = "info error";
      errorMsgElement.textContent = this.validationError();
      input.insertAdjacentElement("beforebegin", errorMsgElement);
    }
  }

  resetFormErrors() {
    this.validationError("");
    this.errorOnSubmit("");
    const errorInputs = document.querySelectorAll(".input.error");
    errorInputs.forEach((input) => {
      input.classList.remove("error");
      const errorMsgElement = input.previousElementSibling;
      if (errorMsgElement && errorMsgElement.classList.contains("error")) {
        errorMsgElement.remove();
      }
    });
  }

  async resetChanges() {
    this.hasChanges(false);
    this.resetFormErrors();
    this.cleanupPolicy(await post("GetCleanupPolicy", {}));
    this.retentionSize(await post("GetRetentionSize", {}));
    this.retentionMs(await post("GetRetentionMs", {}));
    this.maxMessageBytes(await post("GetMaxMessageBytes", {}));
  }

  updateLocalValue(name: string, value: string) {
    switch (name) {
      case "cleanup.policy":
        this.cleanupPolicy(value);
        break;
      case "retention.bytes":
        this.retentionSize(value);
        break;
      case "retention.ms":
        this.retentionMs(value);
        break;
      case "max.message.bytes":
        this.maxMessageBytes(value);
        break;
      default:
        console.warn(`Unhandled key: ${name}`);
    }
  }

  /** Submit all form data updates to the API
   * If the API returns success, show a success message
   * If the API returns an error, show the error message at the top of the form
   * We can't individually highlight errors easily because the API doesn't return the field name, just strings
   */
  async handleSubmit(event: Event) {
    event.preventDefault();
    this.success(false);
    this.errorOnSubmit("");
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const result = await post("Submit", data);
    if (result !== undefined) {
      if (result.success) this.success(true);
      else this.errorOnSubmit(result.message ?? "Unknown error occurred");
    }
  }
}

export function post(type: "GetTopicName", body: any): Promise<string>;
export function post(type: "GetRetentionSize", body: any): Promise<string>;
export function post(type: "GetRetentionMs", body: any): Promise<string>;
export function post(type: "GetMaxMessageBytes", body: any): Promise<string>;
export function post(type: "GetCleanupPolicy", body: any): Promise<string>;
export function post(
  type: "ValidateConfigValue",
  body: { [key: string]: unknown },
): Promise<{ success: boolean; message: string | null }>;
export function post(
  type: "Submit",
  body: { [key: string]: unknown },
): Promise<{ success: boolean; message: string | null }>;
export function post(type: any, body: any): Promise<unknown> {
  return sendWebviewMessage(type, body);
}
