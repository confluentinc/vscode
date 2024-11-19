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

  /** Validate changes one input at a time on blur or ui change
   * Checks that the change is valid using the API
   * If the change is valid, update the value in the view model
   * If the change is invalid, highlight input, add error msg
   */
  async validateChanges(event: Event) {
    console.log("validateChanges", event);
    const input = event.target as HTMLInputElement;
    input.classList.remove("error");
    console.log("validate", event);
    // const res = await post("ValidateInput", {
    //   [input.name]: input.value,
    // });

    // if (res.success) {
    //   console.log("success", res);
    //   this.updateValue(input.name, input.value);
    // } else {
    //   this.errorMessage(res.message ?? "Unknown error occurred");
    //   // this.revertValue(input.name); // FIXME
    //   input.classList.add("error");
    //   console.log("error", res);
    // }
  }

  updateValue(name: string, value: string) {
    switch (name) {
      default:
        console.warn(`Unhandled key: ${name}`); // FIXME
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
    const result = await post("TestConnection", data);
    if (result.success) {
      console.log("success", result);
    } else {
      this.errorMessage(result.message ?? "Unknown error occurred");
      console.log("error", result);
    }
  }

  /** Submit all form data to the extension
   */
  async handleSubmit(event: Event) {
    event.preventDefault();
    this.success(false);
    this.errorMessage("");
    const form = event.target as HTMLFormElement;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    console.log("formData:", formData, "data", data);
    // const result = await post("Submit", data);
    // if (result !== undefined) {
    //   if (result.success) this.success(true);
    //   else this.errorMessage(result.message ?? "Unknown error occurred");
    // }
  }
}

export function post(
  type: "ValidateInput",
  body: { [key: string]: unknown },
): Promise<{ success: boolean; message: string | null }>;
export function post(
  type: "TestConnection",
  body: { [key: string]: unknown },
): Promise<{ success: boolean; message: string | null }>;
export function post(
  type: "Submit",
  body: { [key: string]: unknown },
): Promise<{ success: boolean; message: string | null }>;
export function post(type: any, body: any): Promise<unknown> {
  return sendWebviewMessage(type, body);
}
