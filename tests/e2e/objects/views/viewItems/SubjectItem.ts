import { ViewItem } from "./ViewItem";

export class SubjectItem extends ViewItem {
  /** Click the "View Latest Schema" inline action. */
  async clickViewLatestSchema(): Promise<void> {
    await this.clickInlineAction("View Latest Schema");
  }

  /** Click the "Evolve Latest Schema" inline action to open the schema evolution workflow. */
  async clickEvolveLatestSchema(): Promise<void> {
    await this.clickInlineAction("Evolve Latest Schema");
  }

  /** Click the "Upload Schema to Schema Registry for Subject" inline action. */
  async uploadSchemaForSubject(): Promise<void> {
    await this.clickInlineAction("Upload Schema to Schema Registry for Subject");
  }
}
