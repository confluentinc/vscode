import * as assert from "assert";
import {
  ConnectedState,
  ConnectionType,
  isConnectedStateInProgress,
  isConnectedStateTerminal,
  isConnectedStateUsable,
} from "./types";

describe("connections/types", function () {
  describe("ConnectionType enum", function () {
    it("should have CCLOUD value", function () {
      assert.strictEqual(ConnectionType.CCLOUD, "CCLOUD");
    });

    it("should have LOCAL value", function () {
      assert.strictEqual(ConnectionType.LOCAL, "LOCAL");
    });

    it("should have DIRECT value", function () {
      assert.strictEqual(ConnectionType.DIRECT, "DIRECT");
    });
  });

  describe("ConnectedState enum", function () {
    it("should have all expected states", function () {
      assert.strictEqual(ConnectedState.NONE, "NONE");
      assert.strictEqual(ConnectedState.ATTEMPTING, "ATTEMPTING");
      assert.strictEqual(ConnectedState.SUCCESS, "SUCCESS");
      assert.strictEqual(ConnectedState.EXPIRED, "EXPIRED");
      assert.strictEqual(ConnectedState.FAILED, "FAILED");
    });
  });

  describe("isConnectedStateUsable", function () {
    it("should return true only for SUCCESS", function () {
      assert.strictEqual(isConnectedStateUsable(ConnectedState.SUCCESS), true);
      assert.strictEqual(isConnectedStateUsable(ConnectedState.NONE), false);
      assert.strictEqual(isConnectedStateUsable(ConnectedState.ATTEMPTING), false);
      assert.strictEqual(isConnectedStateUsable(ConnectedState.EXPIRED), false);
      assert.strictEqual(isConnectedStateUsable(ConnectedState.FAILED), false);
    });
  });

  describe("isConnectedStateTerminal", function () {
    it("should return true for FAILED and EXPIRED", function () {
      assert.strictEqual(isConnectedStateTerminal(ConnectedState.FAILED), true);
      assert.strictEqual(isConnectedStateTerminal(ConnectedState.EXPIRED), true);
    });

    it("should return false for non-terminal states", function () {
      assert.strictEqual(isConnectedStateTerminal(ConnectedState.SUCCESS), false);
      assert.strictEqual(isConnectedStateTerminal(ConnectedState.NONE), false);
      assert.strictEqual(isConnectedStateTerminal(ConnectedState.ATTEMPTING), false);
    });
  });

  describe("isConnectedStateInProgress", function () {
    it("should return true only for ATTEMPTING", function () {
      assert.strictEqual(isConnectedStateInProgress(ConnectedState.ATTEMPTING), true);
      assert.strictEqual(isConnectedStateInProgress(ConnectedState.SUCCESS), false);
      assert.strictEqual(isConnectedStateInProgress(ConnectedState.NONE), false);
      assert.strictEqual(isConnectedStateInProgress(ConnectedState.FAILED), false);
      assert.strictEqual(isConnectedStateInProgress(ConnectedState.EXPIRED), false);
    });
  });
});
