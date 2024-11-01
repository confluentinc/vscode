import * as assert from "assert";
import * as vscode from "vscode";

import { IconNames } from "../constants";
import { getSubjectIcon } from "./schemas";

describe("getSubjectIcon", () => {
  for (const [subject, expected] of [
    ["test-key", IconNames.KEY_SUBJECT],
    ["test-value", IconNames.VALUE_SUBJECT],
    ["test-other", IconNames.OTHER_SUBJECT],
  ]) {
    it(`should return ${expected} icon for subject '${subject}'`, () => {
      const icon = getSubjectIcon(subject);
      assert.deepEqual(icon, new vscode.ThemeIcon(expected));
    });
  }
});
