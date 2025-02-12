import { ResourceLoader } from "../loaders";
import { Logger } from "../logging";
import { ContainerTreeItem } from "../models/main";
import { Schema, Subject } from "../models/schema";

const logger = new Logger("commands.schemaUtils");

/**
 * Some commands will be invoked using either depending on if invoked from
 * the schema registry view or the kafka cluster / topics view.
 */
export type SubjectishArgument = Subject | ContainerTreeItem<Schema>;

/**
 * Convert a SubjectishArgument to its corresponding Subject.
 */
export function determineSubject(callpoint: string, subjectish: SubjectishArgument): Subject {
  if (!(subjectish instanceof Subject) && !(subjectish instanceof ContainerTreeItem)) {
    const msg = `${callpoint} called with invalid argument type`;
    logger.error(msg, subjectish);
    throw new Error(msg);
  }

  if (subjectish instanceof ContainerTreeItem) {
    // The subjectish is a ContainerTreeItem<Schema>, so the subject can be extracted from first Schema child
    return subjectish.children[0].subjectObject();
  } else {
    return subjectish;
  }
}

/**
 * Convert a SubjectishArgument to its corresponding latest Schema.
 * @param subjectish
 * @returns
 */
export async function determineLatestSchema(
  callpoint: string,
  subjectish: SubjectishArgument,
): Promise<Schema> {
  if (!(subjectish instanceof Subject) && !(subjectish instanceof ContainerTreeItem)) {
    const msg = `${callpoint} called with invalid argument type`;
    logger.error(msg, subjectish);
    throw new Error(msg);
  }

  if (subjectish instanceof ContainerTreeItem) {
    // The subjectish is a ContainerTreeItem<Schema>, so the latest schema is the first child.
    return subjectish.children[0];
  } else {
    // Must promote the subject to its subject group, then get the first (latest) schema.
    const loader = ResourceLoader.getInstance(subjectish.connectionId);
    const schemaGroup = await loader.getSchemaSubjectGroup(
      subjectish.environmentId,
      subjectish.name,
    );
    return schemaGroup[0];
  }
}
