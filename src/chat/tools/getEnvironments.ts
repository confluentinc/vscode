import {
  CancellationToken,
  ChatRequest,
  ChatResponseStream,
  LanguageModelTextPart,
  LanguageModelToolCallPart,
  LanguageModelToolConfirmationMessages,
  LanguageModelToolInvocationOptions,
  LanguageModelToolInvocationPrepareOptions,
  LanguageModelToolResult,
  MarkdownString,
  PreparedToolInvocation,
  ProviderResult,
} from "vscode";
import { ResourceLoader } from "../../loaders";
import { Logger } from "../../logging";
import { Environment } from "../../models/environment";
import { ConnectionId } from "../../models/resource";
import { summarizeEnvironment } from "../summarizers/environments";
import { BaseLanguageModelTool, TextOnlyToolResultPart } from "./base";

const logger = new Logger("chat.tools.getEnvironments");

export const NO_RESULTS: string = "No environments found.";

export interface IGetEnvironmentsParameters {
  connectionId: ConnectionId;
}

export class GetEnvironmentsTool extends BaseLanguageModelTool<IGetEnvironmentsParameters> {
  readonly name = "get_environments";

  prepareInvocation(
    options: LanguageModelToolInvocationPrepareOptions<IGetEnvironmentsParameters>,
  ): ProviderResult<PreparedToolInvocation> {
    const { input } = options;
    let invocationMessage: string;
    let confirmationMessage: MarkdownString;

    if (input.connectionId) {
      invocationMessage = `Get all environments for connection ID: ${input.connectionId}`;
      confirmationMessage = new MarkdownString()
        .appendMarkdown(`## Environments Lookup\n`)
        .appendMarkdown(
          `This tool will look up all environments associated with connection ID **${input.connectionId}**. Results will show the environment ID and name. Do you want to proceed?`,
        );
    } else {
      invocationMessage = "No connection ID provided for environments lookup.";
      confirmationMessage = new MarkdownString()
        .appendMarkdown(`## Missing Connection ID\n`)
        .appendMarkdown(
          `No connection ID was provided. Please provide a valid connection ID from the 'get_connections' tool and try again.`,
        );
    }

    const confirmationMessages: LanguageModelToolConfirmationMessages = {
      title: "Get Environments",
      message: confirmationMessage,
    };

    return {
      invocationMessage,
      confirmationMessages,
    };
  }

  async invoke(
    options: LanguageModelToolInvocationOptions<IGetEnvironmentsParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;

    if (!params.connectionId) {
      logger.debug("No connection ID provided");
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          "No connection ID provided. Provide a valid connection ID from the 'get_connections' tool and try again.",
        ),
      ]);
    }

    const loader = ResourceLoader.getInstance(params.connectionId);
    const environments: Environment[] = await loader.getEnvironments();
    if (!environments.length) {
      logger.debug("No environments found");
      // TODO: add hinting? the user shouldn't get here if they have at least one connection
      return new LanguageModelToolResult([new LanguageModelTextPart(NO_RESULTS)]);
    }

    const environmentStrings: LanguageModelTextPart[] = [];
    for (const env of environments) {
      const envString: string = summarizeEnvironment(env);
      environmentStrings.push(new LanguageModelTextPart(`\n${envString}`));
    }

    if (token.isCancellationRequested) {
      logger.debug("Tool invocation cancelled");
      return new LanguageModelToolResult([]);
    }
    return new LanguageModelToolResult(environmentStrings);
  }

  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<TextOnlyToolResultPart> {
    const parameters = toolCall.input as IGetEnvironmentsParameters;

    stream.progress(
      `Retrieving available environments with parameters: ${JSON.stringify(parameters)}...`,
    );
    // handle the core tool invocation
    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );

    stream.progress(`Found ${result.content.length} environments.`);
    if (!result.content.length) {
      return new TextOnlyToolResultPart(toolCall.callId, []);
    }

    const resultParts: LanguageModelTextPart[] = [];
    const contents = result.content as LanguageModelTextPart[];

    if (contents.length === 1 && contents[0].value === NO_RESULTS) {
      const resultsHeader = new LanguageModelTextPart("No environments found.");
      resultParts.push(resultsHeader);
    } else {
      const resultsHeader = new LanguageModelTextPart("Here are your available environments:");
      resultParts.push(resultsHeader);
      resultParts.push(...contents);
      const footerHint = new LanguageModelTextPart(
        "\nTo interact with these environments, use their IDs in follow-up tool calls, such as 'list_topics'.",
      );
      resultParts.push(footerHint);
    }

    return new TextOnlyToolResultPart(toolCall.callId, resultParts);
  }
}
