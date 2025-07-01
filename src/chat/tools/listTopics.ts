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
import { KafkaCluster } from "../../models/kafkaCluster";
import { ConnectionId, EnvironmentId } from "../../models/resource";
import { KafkaTopic } from "../../models/topic";
import { summarizeTopic } from "../summarizers/topics";
import { BaseLanguageModelTool, TextOnlyToolResultPart } from "./base";

const logger = new Logger("chat.tools.listTopics");

export interface IListTopicsParameters {
  kafkaClusterId: string;
  environmentId: string;
  topicNameSubstring?: string;
  connectionId: string;
}

export class ListTopicsTool extends BaseLanguageModelTool<IListTopicsParameters> {
  readonly name = "list_topics";

  prepareInvocation(
    options: LanguageModelToolInvocationPrepareOptions<IListTopicsParameters>,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    token: CancellationToken,
  ): ProviderResult<PreparedToolInvocation> {
    const { input } = options;
    let invocationMessage: string;
    let confirmationMessage: MarkdownString;

    // Build invocation message based on parameters
    const messageParts = ["Get topics"];
    if (input.kafkaClusterId) {
      messageParts.push(`from Kafka cluster ${input.kafkaClusterId}`);
    }
    if (input.topicNameSubstring) {
      messageParts.push(`filtered by "${input.topicNameSubstring}"`);
    }
    invocationMessage = messageParts.join(" ");

    // Build confirmation message with multiple options on separate lines
    confirmationMessage = new MarkdownString()
      .appendMarkdown(`## List Kafka Topics\n`)
      .appendMarkdown(`This tool will retrieve topics with the following criteria:\n`);

    const criteria = [
      { label: 'Kafka Cluster ID', value: input.kafkaClusterId },
      { label: 'Environment ID', value: input.environmentId },
      { label: 'Connection ID', value: input.connectionId },
      { label: 'Topic Name Filter', value: input.topicNameSubstring, quoted: true },
    ];

    criteria.forEach(({ label, value, quoted }) => {
      if (value) {
        const displayValue = quoted ? `"${value}"` : value;
        confirmationMessage.appendMarkdown(`\n- **${label}**: ${displayValue}`);
      }
    });

    confirmationMessage
      .appendMarkdown(`\n\n**Additional Information:**`)
      .appendMarkdown(`\n- Results will be limited to 30 topics maximum`)
      .appendMarkdown(`\n- Topic summaries will include partition count and configuration details`)
      .appendMarkdown(`\n- Filtering is case-sensitive when using topic name substring`)
      .appendMarkdown(`\n\nDo you want to proceed?`);

    const confirmationMessages: LanguageModelToolConfirmationMessages = {
      title: "List Topics",
      message: confirmationMessage,
    };

    return {
      invocationMessage,
      confirmationMessages,
    };
  }

  async invoke(
    options: LanguageModelToolInvocationOptions<IListTopicsParameters>,
    token: CancellationToken,
  ): Promise<LanguageModelToolResult> {
    const params = options.input;

    const connectionId = params.connectionId as ConnectionId;
    if (!connectionId) {
      return new LanguageModelToolResult([new LanguageModelTextPart("No connection ID provided.")]);
    }

    let environmentId = params.environmentId as EnvironmentId;
    if (!environmentId) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart("No environment ID provided."),
      ]);
    }

    let kafkaClusterId = params.kafkaClusterId;
    if (!kafkaClusterId) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart("No Kafka cluster ID provided."),
      ]);
    }

    // Handle cases where all IDs are the same (local setup)
    if (kafkaClusterId === environmentId) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          `Kafka cluster ID and environment ID are the same (${kafkaClusterId}). Please use get_environments to retrieve the Kafka cluster ID.`,
        ),
      ]);
    }

    const loader = ResourceLoader.getInstance(connectionId);

    const kafkaClusters: KafkaCluster[] =
      await loader.getKafkaClustersForEnvironmentId(environmentId);

    if (!(Array.isArray(kafkaClusters) && kafkaClusters.length)) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart("No Kafka clusters found for the given environment ID."),
      ]);
    }

    const kafkaCluster = kafkaClusters.find((cluster) => cluster.id === kafkaClusterId);
    if (!kafkaCluster) {
      return new LanguageModelToolResult([
        new LanguageModelTextPart(
          `No Kafka cluster found for the given ID (${kafkaClusterId}). Available clusters: ${kafkaClusters
            .map((c) => c.id)
            .join(", ")}`,
        ),
      ]);
    }

    const topics = await loader.getTopicsForCluster(kafkaCluster);
    if (!(Array.isArray(topics) && topics.length)) {
      logger.debug(`No topics found for cluster ${kafkaClusterId}`);
      return new LanguageModelToolResult([
        new LanguageModelTextPart("No topics found for the given Kafka cluster."),
      ]);
    }

    let sampleTopics: KafkaTopic[] = [...topics]; // Create a copy of the topics array
    const topicNameSubstring = params.topicNameSubstring;

    if (topicNameSubstring) {
      sampleTopics = sampleTopics.filter((topic) => topic.name.includes(topicNameSubstring));
      logger.debug(
        `Filtered topics by substring "${topicNameSubstring}": ${sampleTopics.length} matches`,
      );
    }

    // if sample topics is more than 30, slice it to 30
    if (sampleTopics.length > 30) {
      sampleTopics = sampleTopics.slice(0, 30);
      logger.debug(`Limited topics to 30 samples`);
    }

    if (token.isCancellationRequested) {
      logger.debug("Tool invocation cancelled");
      return new LanguageModelToolResult([]);
    }

    logger.debug(`Summarizing ${sampleTopics.length} topics`);
    const topicTextParts: LanguageModelTextPart[] = sampleTopics.map((topic) => {
      const topicSummary = summarizeTopic(topic);
      return new LanguageModelTextPart(topicSummary);
    });
    return new LanguageModelToolResult(topicTextParts);
  }
  async processInvocation(
    request: ChatRequest,
    stream: ChatResponseStream,
    toolCall: LanguageModelToolCallPart,
    token: CancellationToken,
  ): Promise<TextOnlyToolResultPart> {
    const parameters = toolCall.input as IListTopicsParameters;
    const progressMessage = [
      `Retrieving available topics for Cluster ID: ${parameters.kafkaClusterId}`,
    ];

    if (parameters.topicNameSubstring) {
      progressMessage.push(`- Filter: "${parameters.topicNameSubstring}"`);
    }

    stream.progress(progressMessage.join("\n"));

    // handle the core tool invocation
    const result: LanguageModelToolResult = await this.invoke(
      {
        input: parameters,
        toolInvocationToken: request.toolInvocationToken,
      },
      token,
    );

    // format the results before sending them back to the model
    const resultParts: LanguageModelTextPart[] = [];

    if (!result.content.length) {
      return new TextOnlyToolResultPart(toolCall.callId, []);
    }

    stream.progress(`Found ${result.content.length} topics.`);

    // Add header for successful results
    const resultsHeader = new LanguageModelTextPart(
      `Found ${result.content.length} topics in cluster ${parameters.kafkaClusterId}:\n`,
    );
    resultParts.push(resultsHeader);
    // Add content
    resultParts.push(...(result.content as LanguageModelTextPart[]));

    return new TextOnlyToolResultPart(toolCall.callId, resultParts);
  }
}
}
