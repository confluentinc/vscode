import { ObservableScope } from "inertial";
import { ScaffoldV1TemplateOption, ScaffoldV1TemplateSpec } from "../clients/scaffoldingService";
import { applyBindings } from "./bindings/bindings";
import { ViewModel } from "./bindings/view-model";
import { sendWebviewMessage } from "./comms/comms";

addEventListener("DOMContentLoaded", () => {
  const os = ObservableScope(queueMicrotask);
  const ui = document.querySelector("main")!;
  const vm = new ScaffoldFormViewModel(os);
  applyBindings(ui, os, vm);
});

class ScaffoldFormViewModel extends ViewModel {
  spec = this.resolve(async () => {
    return await post("GetTemplateSpec", {});
  }, null);

  displayName = this.derive(() => {
    return this.spec()?.display_name;
  });

  description = this.derive(() => {
    return this.spec()?.description;
  });

  options = this.derive(() => {
    return Object.entries(this.spec()?.options ?? {});
  });

  optionValues = this.resolve(async () => {
    return await post("GetOptionValues", {});
  }, {});

  getFieldValue = (key: string) => {
    return this.optionValues()[key] ?? "";
  };

  noOptions = this.derive(() => {
    for (const key in this.spec()?.options) return false;
    return true;
  });

  // Updated in validateInput & submit handler checks
  hasValidationErrors = this.signal(false);

  isEnumField(field: [string, ScaffoldV1TemplateOption]) {
    return field[1]._enum;
  }

  handleInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const key = input.name;
    const value = input.value;
    input.classList.remove("error"); // reset error state, will be re-evaluated on blur
    post("SetOptionValue", { key, value });
  }

  validateInput(event: Event) {
    console.log("validateInput");
    const input = event.target as HTMLInputElement;
    const key = input.name;
    const value = input.value;
    const minLength = this.spec()?.options?.[key]?.min_length;
    const required = minLength !== undefined && minLength > 0;
    const pattern = this.spec()?.options?.[key]?.pattern;
    const inputContainer = input.closest(".input-container");
    if (required && value.length < minLength) {
      console.log(input.name, "not long enough");
      inputContainer?.classList.add("error");
    } else if (value !== "" && pattern && !new RegExp(pattern).test(value)) {
      console.log(input.name, "not valid");
      inputContainer?.classList.add("error");
    } else {
      console.log(input.name, "ok");
      inputContainer?.classList.remove("error");
    }
    this.hasValidationErrors(document.querySelectorAll(".input-container.error").length > 0);
  }

  handleSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    this.hasValidationErrors(
      document.querySelectorAll(".input-container.error").length > 0 || !form.checkValidity(),
    );
    if (this.hasValidationErrors()) return;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    post("Submit", { data });
  }
}

export function post(
  type: "SetOptionValue",
  body: { key: string; value: string },
): Promise<unknown>;
export function post(type: "GetOptionValues", body: any): Promise<{ [key: string]: unknown }>;
export function post(type: "GetTemplateSpec", body: any): Promise<ScaffoldV1TemplateSpec | null>;
export function post(type: "Submit", body: { data: { [key: string]: unknown } }): Promise<unknown>;
export function post(type: any, body: any): Promise<unknown> {
  return sendWebviewMessage(type, body);
}
