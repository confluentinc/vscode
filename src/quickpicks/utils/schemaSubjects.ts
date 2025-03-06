import { commands, workspace, WorkspaceConfiguration } from "vscode";
import { DEFAULT_ERROR_NOTIFICATION_BUTTONS, showErrorNotificationWithButtons } from "../../errors";
import { ResourceLoader } from "../../loaders";
import { Subject } from "../../models/schema";
import { SchemaRegistry } from "../../models/schemaRegistry";
import { KafkaTopic } from "../../models/topic";
import { USE_TOPIC_NAME_STRATEGY } from "../../preferences/constants";
import { SubjectNameStrategy } from "../../schemas/produceMessageSchema";
import { schemaSubjectQuickPick, subjectNameStrategyQuickPick } from "../schemas";

/**
 * Return {@linkcode SubjectNameStrategy.TOPIC_NAME} if enabled in user settings, otherwise prompt for
 * the user to select a subject name strategy via quickpick.
 */
export async function getSubjectNameStrategy(
  topic: KafkaTopic,
  kind: "key" | "value",
): Promise<SubjectNameStrategy | undefined> {
  const config: WorkspaceConfiguration = workspace.getConfiguration();
  const useTopicNameStrategy: boolean = config.get(USE_TOPIC_NAME_STRATEGY) ?? true;
  if (useTopicNameStrategy) {
    return SubjectNameStrategy.TOPIC_NAME;
  }
  // if the user has disabled the topic name strategy, we need to prompt for the subject name
  // strategy first, which will help narrow down subjects later
  return await subjectNameStrategyQuickPick(topic, kind);
}

/**
 * Get the name of a schema subject for a given topic and {@link SubjectNameStrategy}, using the
 * provided key/value kind to help filter the schema subjects.
 *
 * - `TopicNameStrategy` will use the topic name and kind to create a subject name, and check if it
 * exists.
 * - `TopicRecordNameStrategy` will filter the schema subjects by topic name and kind before showing
 * a quickpick to the user.
 * - `RecordNameStrategy` will show all schema subjects before showing a quickpick to the user.
 */
export async function getSubjectNameForStrategy(
  strategy: SubjectNameStrategy,
  topic: KafkaTopic,
  kind: string,
  registry: SchemaRegistry,
  loader: ResourceLoader,
): Promise<string | undefined> {
  let schemaSubjectName: string | undefined;

  switch (strategy) {
    case SubjectNameStrategy.TOPIC_NAME:
      {
        // we have the topic name and the kind, so we just need to make sure the subject exists and
        // fast-track to getting the schema version
        schemaSubjectName = `${topic.name}-${kind}`;
        const schemaSubjects: Subject[] = await loader.getSubjects(registry);
        const subjectExists = schemaSubjects.some((s) => s.name === schemaSubjectName);
        if (!subjectExists) {
          const noSubjectMsg = `No "${kind}" schema subject found for topic "${topic.name}" using the ${strategy} strategy.`;
          showErrorNotificationWithButtons(noSubjectMsg, {
            "Open Settings": () => {
              commands.executeCommand(
                "workbench.action.openSettings",
                `@id:${USE_TOPIC_NAME_STRATEGY}`,
              );
            },
            ...DEFAULT_ERROR_NOTIFICATION_BUTTONS,
          });
          throw new Error(noSubjectMsg);
        }
      }
      break;
    case SubjectNameStrategy.TOPIC_RECORD_NAME:
      // filter the subject quickpick based on the topic name
      schemaSubjectName = await schemaSubjectQuickPick(
        registry,
        false,
        `Producing to ${topic.name}: ${kind} schema`,
        (s) => s.name.startsWith(topic.name),
      );
      break;
    case SubjectNameStrategy.RECORD_NAME:
      schemaSubjectName = await schemaSubjectQuickPick(
        registry,
        false,
        `Producing to ${topic.name}: ${kind} schema`,
      );
      break;
  }

  return schemaSubjectName;
}
