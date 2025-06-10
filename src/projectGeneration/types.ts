export interface PrefilledTemplateOptions {
  templateCollection?: string;
  templateName?: string;
  templateType?: string;
  [key: string]: string | undefined;
}

export interface TemplateOptionValues {
  [key: string]: string | boolean;
}

export interface TemplateOptions {
  [key: string]: {
    type: string;
    description?: string;
    default?: string | boolean;
  };
}
