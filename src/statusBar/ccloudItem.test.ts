import * as assert from "assert";
import sinon from "sinon";
import { MarkdownString, StatusBarItem, window } from "vscode";
import {
  TEST_CCLOUD_INCIDENT,
  TEST_CCLOUD_SCHEDULED_MAINTENANCE,
  TEST_CCLOUD_STATUS_SUMMARY,
} from "../../tests/unit/testResources/ccloudStatus";
import { CCloudStatusSummary, Incident } from "../ccloudStatus/types";
import { IconNames } from "../constants";
import {
  disposeCCloudStatusBarItem,
  getCCloudStatusBarItem,
  updateCCloudStatus,
} from "./ccloudItem";
import {
  ACTIVE_INCIDENT_STATUS_ORDER,
  ACTIVE_MAINTENANCE_STATUS_ORDER,
  COMPLETED_INCIDENT_STATUSES,
  COMPLETED_MAINTENANCE_STATUSES,
} from "./formatting";

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
    const tooltip = statusBarItem.tooltip as MarkdownString;
    assert.ok(tooltip.value.includes(`**$(${IconNames.CONFLUENT_LOGO}) Confluent Cloud Status**`));
    assert.ok(tooltip.value.includes("No notices for Confluent Cloud at this time"));
  });

  for (const status of ACTIVE_INCIDENT_STATUS_ORDER) {
    it(`updateCCloudStatus() should update the status bar with active incidents (status=${status})`, () => {
      const incidents = [{ ...TEST_CCLOUD_INCIDENT, status }] as Incident[];
      const activeIncidentSummary: CCloudStatusSummary = {
        ...TEST_CCLOUD_STATUS_SUMMARY,
        incidents,
      };

      const statusBarItem = getCCloudStatusBarItem();
      updateCCloudStatus(activeIncidentSummary);

      assert.strictEqual(statusBarItem.text, `$(${IconNames.CONFLUENT_LOGO}) ${incidents.length}`);
    });
  }

  for (const status of ACTIVE_MAINTENANCE_STATUS_ORDER) {
    it(`updateCCloudStatus() should update the status bar with active scheduled maintenances (status=${status})`, () => {
      const maintenances = [{ ...TEST_CCLOUD_SCHEDULED_MAINTENANCE, status }];
      const scheduledMaintenanceSummary: CCloudStatusSummary = {
        ...TEST_CCLOUD_STATUS_SUMMARY,
        scheduled_maintenances: maintenances,
      };

      const statusBarItem = getCCloudStatusBarItem();
      updateCCloudStatus(scheduledMaintenanceSummary);

      assert.strictEqual(
        statusBarItem.text,
        `$(${IconNames.CONFLUENT_LOGO}) ${maintenances.length}`,
      );
    });
  }

  it("updateCCloudStatus() should update the status bar with active incidents and scheduled maintenances", () => {
    const multipleSummary: CCloudStatusSummary = {
      ...TEST_CCLOUD_STATUS_SUMMARY,
      incidents: [{ ...TEST_CCLOUD_INCIDENT, status: "investigating" }],
      scheduled_maintenances: [{ ...TEST_CCLOUD_SCHEDULED_MAINTENANCE, status: "scheduled" }],
    };

    const statusBarItem = getCCloudStatusBarItem();
    updateCCloudStatus(multipleSummary);

    assert.strictEqual(statusBarItem.text, "$(confluent-logo) 2");
  });

  for (const status of COMPLETED_INCIDENT_STATUSES) {
    it(`updateCCloudStatus() should not include '${status}' incidents when determining the status bar text and color`, () => {
      const activeIncidentSummary: CCloudStatusSummary = {
        ...TEST_CCLOUD_STATUS_SUMMARY,
        incidents: [{ ...TEST_CCLOUD_INCIDENT, status }],
      };

      const statusBarItem = getCCloudStatusBarItem();
      updateCCloudStatus(activeIncidentSummary);

      assert.strictEqual(statusBarItem.text, `$(${IconNames.CONFLUENT_LOGO})`);
    });
  }

  for (const status of COMPLETED_MAINTENANCE_STATUSES) {
    it(`updateCCloudStatus() should not include '${status}' scheduled maintenances when determining the status bar text and color`, () => {
      const activeMaintenanceSummary: CCloudStatusSummary = {
        ...TEST_CCLOUD_STATUS_SUMMARY,
        scheduled_maintenances: [{ ...TEST_CCLOUD_SCHEDULED_MAINTENANCE, status }],
      };

      const statusBarItem = getCCloudStatusBarItem();
      updateCCloudStatus(activeMaintenanceSummary);

      assert.strictEqual(statusBarItem.text, `$(${IconNames.CONFLUENT_LOGO})`);
    });
  }
});
