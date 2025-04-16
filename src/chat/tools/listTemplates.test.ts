import * as assert from "assert";
import { inputTagsMatchSpecTags } from "./listTemplates";

describe("chat/tools/listTemplates.ts inputTagsMatchSpecTags()", () => {
  it("should return true if an input tag directly matches a spec tag", () => {
    const inputTags = ["tag1"];
    const specTags = ["tag1", "tag2"];

    const result = inputTagsMatchSpecTags(inputTags, specTags);

    assert.ok(result);
  });

  it("should return true if an input tag is contained within a spec tag", () => {
    const inputTags = ["tag1"];
    const specTags = ["tag2", "tag1-tag3"];

    const result = inputTagsMatchSpecTags(inputTags, specTags);

    assert.ok(result);
  });

  it("should return false if an input tag does not match any spec tags", () => {
    const inputTags = ["tag1"];
    const specTags = ["tag2", "tag3"];

    const result = inputTagsMatchSpecTags(inputTags, specTags);

    assert.ok(!result);
  });

  it("should return false if spec tags are not provided", () => {
    const inputTags = ["tag1"];
    const specTags = undefined;

    const result = inputTagsMatchSpecTags(inputTags, specTags);

    assert.ok(!result);
  });
});
