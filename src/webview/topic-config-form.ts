import { ObservableScope } from "inertial";
import { applyBindings } from "./bindings/bindings";
import { ViewModel } from "./bindings/view-model";
import { sendWebviewMessage } from "./comms/comms";
import { type TopicConfigDataList } from "../clients/kafkaRest";

addEventListener("DOMContentLoaded", () => {
  const os = ObservableScope(queueMicrotask);
  const ui = document.querySelector("main")!;
  const vm = new ConfigFormViewModel(os);
  applyBindings(ui, os, vm);
});

class ConfigFormViewModel extends ViewModel {
  cleanupPolicy = this.resolve(async () => {
    return await post("GetCleanupPolicy", {});
  }, ""); // cc default "delete"

  retentionSize = this.resolve(async () => {
    return await post("GetRetentionSize", {});
  }, ""); // cc default -1

  retentionMs = this.resolve(async () => {
    return await post("GetRetentionMs", {});
  }, ""); //cc default = (7, 'days').asMilliseconds(),

  maxMessageBytes = this.resolve(async () => {
    return await post("GetMaxMessageBytes", {});
  }, ""); //cc defaultValue: 1 * 1000, should be text field number

  errorMessage = this.resolve(async () => {
    return await post("GetFormError", {});
  }, null);

  async validateChange(event: Event) {
    console.log("validateChange", event);
    const input = event.target as HTMLInputElement;
    await post("ValidateConfigValue", { [input.name]: input.value });
    this.errorMessage(await post("GetFormError", {}));
    switch (input.name) {
      case "cleanup.policy":
        this.cleanupPolicy(input.value);
        break;
      case "retention.bytes":
        this.retentionSize(input.value);
        break;
      case "retention.ms":
        this.retentionMs(input.value);
        break;
      case "max.message.bytes":
        this.maxMessageBytes(input.value);
        break;
      default:
        console.warn(`Unhandled key: ${input.name}`); // FIXME
    }
  }

  success = this.resolve(async () => {
    return await post("GetSubmitSuccess", {});
  }, false);

  async handleSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    console.log("formData:", formData, "data", data);
    await post("Submit", { data, validateOnly: false });
    this.success(await post("GetSubmitSuccess", {}));
    // FIXME if it's successful, show something else or close the form
  }
}
export function post(type: "GetSubmitSuccess", body: any): Promise<boolean>;
export function post(type: "GetRetentionSize", body: any): Promise<string>;
export function post(type: "GetRetentionMs", body: any): Promise<string>;
export function post(type: "GetMaxMessageBytes", body: any): Promise<string>;
export function post(type: "GetCleanupPolicy", body: any): Promise<string>;
export function post(type: "ValidateConfigValue", body: { [key: string]: unknown }): Promise<null>;
export function post(type: "GetFormError", body: any): Promise<string | null>;
export function post(type: "GetConfig", body: any): Promise<TopicConfigDataList | null>;
export function post(
  type: "Submit",
  body: { data: { [key: string]: unknown }; validateOnly: boolean },
): Promise<unknown>;
export function post(type: any, body: any): Promise<unknown> {
  return sendWebviewMessage(type, body);
}
