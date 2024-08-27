declare module "*.html" {
  /**
   * A function that returns generated HTML from imported template.
   */
  export default function template(variables: Record<string, unknown>): string;
}
