import * as assert from "assert";
import * as vscode from "vscode";
import { isDesktopEnvironment, isWebEnvironment } from "./environment";

describe("kafka/environment", function () {
  describe("isDesktopEnvironment", function () {
    it("should return true when vscode.env.uiKind is Desktop", function () {
      // Tests run in VS Code desktop, so this should return true
      const result = isDesktopEnvironment();
      assert.strictEqual(result, vscode.env.uiKind === vscode.UIKind.Desktop);
    });

    it("should return consistent results", function () {
      const first = isDesktopEnvironment();
      const second = isDesktopEnvironment();
      assert.strictEqual(first, second);
    });
  });

  describe("isWebEnvironment", function () {
    it("should return true when vscode.env.uiKind is Web", function () {
      const result = isWebEnvironment();
      assert.strictEqual(result, vscode.env.uiKind === vscode.UIKind.Web);
    });

    it("should be the inverse of isDesktopEnvironment", function () {
      const desktop = isDesktopEnvironment();
      const web = isWebEnvironment();
      assert.strictEqual(desktop, !web);
    });
  });
});
