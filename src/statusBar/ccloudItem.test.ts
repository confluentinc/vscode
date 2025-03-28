import * as assert from "assert";
import sinon from "sinon";
import { StatusBarItem, ThemeColor, window } from "vscode";
import {
  TEST_CCLOUD_INCIDENT,
  TEST_CCLOUD_SCHEDULED_MAINTENANCE,
  TEST_CCLOUD_STATUS_SUMMARY,
} from "../../tests/unit/testResources/ccloudStatus";
import { CCloudStatusSummary, Incident, ScheduledMaintenance } from "../ccloudStatus/types";
import { IconNames } from "../constants";
import {
  determineStatusBarColor,
  disposeCCloudStatusBarItem,
  getCCloudStatusBarItem,
  updateCCloudStatus,
} from "./ccloudItem";
import { ERROR_BACKGROUND_COLOR_ID, WARNING_BACKGROUND_COLOR_ID } from "./constants";

describe("statusBar/ccloudItem.ts", () => {
  let sandbox: sinon.SinonSandbox;
  let createStatusBarItemSpy: sinon.SinonSpy;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    createStatusBarItemSpy = sandbox.spy(window, "createStatusBarItem");
    // reset status bar item before each test
    disposeCCloudStatusBarItem();
  });

  afterEach(() => {
    // reset status bar item after each test
    disposeCCloudStatusBarItem();
    sandbox.restore();
  });

  it("getCCloudStatusBarItem() should create a new status bar item when called for the first time", () => {
    const statusBarItem = getCCloudStatusBarItem();

    sinon.assert.calledOnce(createStatusBarItemSpy);
    assert.strictEqual(statusBarItem.name, "Confluent Cloud Notices");
    assert.strictEqual(statusBarItem.text, `$(${IconNames.CONFLUENT_LOGO})`);
  });

  it("getCCloudStatusBarItem() should return the existing status bar item on subsequent calls", () => {
    const firstCall: StatusBarItem = getCCloudStatusBarItem();
    const secondCall: StatusBarItem = getCCloudStatusBarItem();

    // only actually created once
    sinon.assert.calledOnce(createStatusBarItemSpy);
    assert.strictEqual(firstCall, secondCall);
  });

  it("updateCCloudStatus() should reset the status bar when no active incidents or maintenances are passed", () => {
    const statusBarItem = getCCloudStatusBarItem();

    // no incidents or scheduled maintenances by default
    updateCCloudStatus(TEST_CCLOUD_STATUS_SUMMARY);

    assert.strictEqual(statusBarItem.text, `$(${IconNames.CONFLUENT_LOGO})`);
    assert.strictEqual(statusBarItem.backgroundColor, undefined);
    assert.ok(statusBarItem.tooltip);
  });

  it("updateCCloudStatus() should update the status bar with active incidents", () => {
    const incidents = [{ ...TEST_CCLOUD_INCIDENT, status: "investigating" }] as Incident[];
    const activeIncidentSummary: CCloudStatusSummary = {
      ...TEST_CCLOUD_STATUS_SUMMARY,
      incidents,
    };

    const statusBarItem = getCCloudStatusBarItem();
    updateCCloudStatus(activeIncidentSummary);

    assert.strictEqual(statusBarItem.text, `$(${IconNames.CONFLUENT_LOGO}) ${incidents.length}`);
    assert.ok(statusBarItem.backgroundColor instanceof ThemeColor);
    // @ts-expect-error - update vscode types so ThemeColor exposes .id
    assert.strictEqual(statusBarItem.backgroundColor.id, ERROR_BACKGROUND_COLOR_ID);
  });

  it("updateCCloudStatus() should update the status bar with scheduled maintenances", () => {
    const scheduled_maintenances = [
      { ...TEST_CCLOUD_SCHEDULED_MAINTENANCE, status: "scheduled" },
    ] as ScheduledMaintenance[];
    const scheduledMaintenanceSummary: CCloudStatusSummary = {
      ...TEST_CCLOUD_STATUS_SUMMARY,
      scheduled_maintenances,
    };

    const statusBarItem = getCCloudStatusBarItem();
    updateCCloudStatus(scheduledMaintenanceSummary);

    assert.strictEqual(
      statusBarItem.text,
      `$(${IconNames.CONFLUENT_LOGO}) ${scheduled_maintenances.length}`,
    );
    assert.ok(statusBarItem.backgroundColor instanceof ThemeColor);
    assert.strictEqual(
      // @ts-expect-error - update vscode types so ThemeColor exposes .id
      statusBarItem.backgroundColor.id,
      WARNING_BACKGROUND_COLOR_ID,
    );
  });

  it("updateCCloudStatus() should update the status bar with multiple notices", () => {
    const multipleSummary: CCloudStatusSummary = {
      ...TEST_CCLOUD_STATUS_SUMMARY,
      incidents: [{ ...TEST_CCLOUD_INCIDENT, status: "investigating" }],
      scheduled_maintenances: [{ ...TEST_CCLOUD_SCHEDULED_MAINTENANCE, status: "scheduled" }],
    };

    const statusBarItem = getCCloudStatusBarItem();
    updateCCloudStatus(multipleSummary);

    assert.strictEqual(statusBarItem.text, "$(confluent-logo) 2");
    assert.ok(statusBarItem.backgroundColor instanceof ThemeColor);
    assert.strictEqual(
      // @ts-expect-error - update vscode types so ThemeColor exposes .id
      statusBarItem.backgroundColor.id,
      ERROR_BACKGROUND_COLOR_ID,
    );
  });

  it("determineStatusBarColor() should return undefined when there are no incidents or maintenances", () => {
    // no incidents or scheduled maintenances by default
    const color = determineStatusBarColor(TEST_CCLOUD_STATUS_SUMMARY);

    assert.strictEqual(color, undefined);
  });

  it("determineStatusBarColor() should return the error color when there is at least one active incident", () => {
    const activeIncidentSummary: CCloudStatusSummary = {
      ...TEST_CCLOUD_STATUS_SUMMARY,
      incidents: [{ ...TEST_CCLOUD_INCIDENT, status: "investigating" }],
    };

    const color = determineStatusBarColor(activeIncidentSummary);

    assert.ok(color instanceof ThemeColor);
    // @ts-expect-error - update vscode types so ThemeColor exposes .id
    assert.strictEqual(color.id, ERROR_BACKGROUND_COLOR_ID);
  });

  it("determineStatusBarColor() should return the warning color when there is at least one not-completed maintenance window", () => {
    const scheduledMaintenanceSummary: CCloudStatusSummary = {
      ...TEST_CCLOUD_STATUS_SUMMARY,
      scheduled_maintenances: [{ ...TEST_CCLOUD_SCHEDULED_MAINTENANCE, status: "scheduled" }],
    };

    const color = determineStatusBarColor(scheduledMaintenanceSummary);

    assert.ok(color instanceof ThemeColor);
    // @ts-expect-error - update vscode types so ThemeColor exposes .id
    assert.strictEqual(color.id, WARNING_BACKGROUND_COLOR_ID);
  });

  it("determineStatusBarColor() should prioritize coloring incidents over scheduled maintenance", () => {
    const bothSummary: CCloudStatusSummary = {
      ...TEST_CCLOUD_STATUS_SUMMARY,
      incidents: [{ ...TEST_CCLOUD_INCIDENT, status: "investigating" }],
      scheduled_maintenances: [{ ...TEST_CCLOUD_SCHEDULED_MAINTENANCE, status: "scheduled" }],
    };

    const color = determineStatusBarColor(bothSummary);

    assert.ok(color instanceof ThemeColor);
    // @ts-expect-error - update vscode types so ThemeColor exposes .id
    assert.strictEqual(color.id, ERROR_BACKGROUND_COLOR_ID);
  });

  it("determineStatusBarColor() should ignore resolved incidents", () => {
    const resolvedIncidentSummary: CCloudStatusSummary = {
      ...TEST_CCLOUD_STATUS_SUMMARY,
      incidents: [{ ...TEST_CCLOUD_INCIDENT, status: "resolved" }],
    };

    const color = determineStatusBarColor(resolvedIncidentSummary);

    assert.strictEqual(color, undefined);
  });
});
