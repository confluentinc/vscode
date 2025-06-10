import { ScaffoldV1Template } from "../clients/scaffoldingService";

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

export function sanitizeTemplateOptions(template: ScaffoldV1Template): ScaffoldV1Template {
  if (!template.spec?.options) {
    return template;
  }

  const sanitizedOptions = Object.fromEntries(
    Object.entries(template.spec.options).map(([key, option]) => [
      key,
      { ...option, initial_value: option.initial_value || "" },
    ]),
  );

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
