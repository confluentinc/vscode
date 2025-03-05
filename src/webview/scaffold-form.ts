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

/** XXXX: We uncovered an issue in the way our OpenAPI spec is generated in the Scaffold Service
 * and it means the reserved word in our options templates no longer gets converted from `enum` to `_enum`,
 * causing a TypeScript error. To workaround it *temporarily* we have this special type interface for the form.
 * TODO we should either patch the OpenAPI generator or push for template spec changes.
 */
export interface ScaffoldV1TemplateOptionAlt extends ScaffoldV1TemplateOption {
  enum?: string[];
  _enum?: string[];
}
export interface ScaffoldV1TemplateSpecAlt extends ScaffoldV1TemplateSpec {
  options: Record<string, ScaffoldV1TemplateOptionAlt>;
}

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
    const allOptions = Object.entries(this.spec()?.options ?? {});
    const orderedOptions = allOptions.filter(([_, details]) => details.order !== undefined);
    const unorderedOptions = allOptions.filter(([_, details]) => details.order === undefined);
    orderedOptions.sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0));
    return [...orderedOptions, ...unorderedOptions];
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

  hasValidationErrors = this.signal(false); // updated in validateInput & submit handler checks
  success = this.signal(true); // only false if submission fails
  message = this.signal("");

  getEnumField(field: [string, ScaffoldV1TemplateOptionAlt]) {
    return field[1].enum ?? field[1]._enum;
  }

  handleInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const key = input.name;
    const value = input.value;
    input.classList.remove("error"); // reset error state, will be re-evaluated on blur
    post("SetOptionValue", { key, value });
  }

  validateInput(event: Event) {
    const input = event.target as HTMLInputElement;
    const key = input.name;
    const value = input.value;
    const minLength = this.spec()?.options?.[key]?.min_length;
    const required = minLength !== undefined && minLength > 0;
    const pattern = this.spec()?.options?.[key]?.pattern;
    const inputContainer = input.closest(".input-container");
    if (required && value.length < minLength) {
      inputContainer?.classList.add("error");
    } else if (value !== "" && pattern && !new RegExp(pattern).test(value)) {
      inputContainer?.classList.add("error");
    } else {
      inputContainer?.classList.remove("error");
    }
    this.hasValidationErrors(document.querySelectorAll(".input-container.error").length > 0);
  }
  async handleSubmit(event: Event) {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    this.hasValidationErrors(
      document.querySelectorAll(".input-container.error").length > 0 || !form.checkValidity(),
    );
    if (this.hasValidationErrors()) return;
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    const result = await post("Submit", { data });
    this.success(result.success);
    this.message(result.message ? result.message : "");
  }
}

export type PostResponse = { success: boolean; message: string | null };

export function post(
  type: "SetOptionValue",
  body: { key: string; value: string },
): Promise<unknown>;
export function post(type: "GetOptionValues", body: any): Promise<{ [key: string]: unknown }>;
export function post(type: "GetTemplateSpec", body: any): Promise<ScaffoldV1TemplateSpec | null>;
export function post(
  type: "Submit",
  body: { data: { [key: string]: unknown } },
): Promise<PostResponse>;
export function post(type: any, body: any): Promise<unknown> {
  return sendWebviewMessage(type, body);
}
