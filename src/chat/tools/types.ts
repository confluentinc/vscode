// NOTE: property descriptions below taken from package.json help text, not currently available at
// https://code.visualstudio.com/api/references/contribution-points
/** An object in the package.json `languageModelTools`. */
export interface LanguageModelToolContribution {
  /**
   * A unique name for this tool. This name must be a globally unique identifier, and is also used
   * as a name when presenting this tool to a language model.
   * @see https://code.visualstudio.com/api/extension-guides/tools#guidelines
   */
  name: string;
  /**
   * Condition which must be true for this tool to be enabled. Note that a tool may still be invoked
   * by another extension even when its `when` condition is false.
   * @see https://code.visualstudio.com/api/references/when-clause-contexts
   */
  when: string;
  /** A human-readable name for this tool that may be used to describe it in the UI. */
  displayName: string;
  /** An icon that represents this tool. Either a file path, an object with file paths for dark and
   * light themes, or a theme icon reference, like `$(zap)`. */
  icon: string;
  /**
   * A set of tags that roughly describe the tool's capabilities. A tool user may use these to
   * filter the set of tools to just ones that are relevant for the task at hand, or they may want
   * to pick a tag that can be used to identify just the tools contributed by this extension.
   */
  tags?: string[];
  /** If true, this tool shows up as an attachment that the user can add manually to their request.
   * Chat participants will receive the tool in `ChatRequest#toolReferences`. */
  canBeReferencedInPrompt: boolean;
  /**
   * If `canBeReferencedInPrompt` is enabled for this tool, the user may use '#' with this name to
   * invoke the tool in a query. Otherwise, the name is not required. Name must not contain
   * whitespace.
   */
  toolReferenceName: string;
  /** A description of this tool that may be used by a language model to select it. */
  modelDescription: string;
  /** A JSON schema for the input this tool accepts. The input must be an object at the top level.
   * A particular language model may not support all JSON schema features. See the documentation
   * for the language model family you are using for more information. */
  inputSchema: object;
}
