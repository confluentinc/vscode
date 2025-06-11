import { ScaffoldV1Template, ScaffoldV1TemplateOption } from "../clients/scaffoldingService";

export function filterSensitiveKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sensitiveKeys = ["password", "secret", "token", "key"];
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.some((sensitiveKey) => key.toLowerCase().includes(sensitiveKey))) {
      result[key] = "********";
    } else if (typeof value === "object" && value !== null) {
      result[key] = filterSensitiveKeys(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function filterSensitiveTemplateOptions(options: { [key: string]: ScaffoldV1TemplateOption }): {
  [key: string]: ScaffoldV1TemplateOption;
} {
  const sensitiveKeys = ["password", "secret", "token", "key"];
  const result: { [key: string]: ScaffoldV1TemplateOption } = {};

  for (const [key, option] of Object.entries(options)) {
    if (sensitiveKeys.some((sensitiveKey) => key.toLowerCase().includes(sensitiveKey))) {
      result[key] = {
        ...option,
        initial_value: "********",
      };
    } else {
      result[key] = option;
    }
  }

  return result;
}

export function sanitizeTemplateOptions(template: ScaffoldV1Template): ScaffoldV1Template {
  if (!template.spec?.options) {
    return template;
  }

  // First ensure all options have default values
  const optionsWithDefaults = Object.fromEntries(
    Object.entries(template.spec.options).map(([key, option]) => [
      key,
      { ...option, initial_value: option.initial_value || "" },
    ]),
  );

  // Then filter out sensitive keys
  const sanitizedOptions = filterSensitiveTemplateOptions(optionsWithDefaults);

  return {
    ...template,
    spec: {
      ...template.spec,
      options: sanitizedOptions,
    },
  };
}

export function parseErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "An unknown error occurred";
}
