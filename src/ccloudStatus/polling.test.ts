import { randomUUID } from "crypto";
import {
  AffectedComponent,
  AffectedComponentFromJSON,
  CCloudStatusSummary,
  CCloudStatusSummaryFromJSON,
  Incident,
  IncidentFromJSON,
  ScheduledMaintenance,
  ScheduledMaintenanceFromJSON,
  StatusComponent,
  StatusComponentFromJSON,
  StatusPage,
  StatusPageFromJSON,
  StatusUpdate,
  StatusUpdateFromJSON,
} from "./types";

export const TEST_CCLOUD_COMPONENT_NAME = "Confluent Cloud";

export const TEST_CCLOUD_STATUS_PAGE_ID = randomUUID();

/** @see https://status.confluent.cloud/api/v2/summary.json */
export const TEST_CCLOUD_STATUS_PAGE: StatusPage = StatusPageFromJSON({
  id: TEST_CCLOUD_STATUS_PAGE_ID,
  name: TEST_CCLOUD_COMPONENT_NAME,
  url: "https://status.confluent.cloud",
  time_zone: "Etc/UTC",
  updated_at: new Date(Date.now()).toISOString(),
} as StatusPage);

export const TEST_CCLOUD_STATUS_COMPONENT_ID = randomUUID();

/** @see https://status.confluent.cloud/api/v2/summary.json */
export const TEST_CCLOUD_STATUS_COMPONENT: StatusComponent = StatusComponentFromJSON({
  id: TEST_CCLOUD_STATUS_COMPONENT_ID,
  name: TEST_CCLOUD_COMPONENT_NAME,
  status: "operational",
  created_at: new Date(Date.now()).toISOString(),
  updated_at: new Date(Date.now()).toISOString(),
  position: 1,
  description: "Our systems for creating and using Confluent Clusters for setting data in motion.",
  showcase: false,
  start_date: new Date(Date.now()).toISOString(),
  group_id: null,
  page_id: TEST_CCLOUD_STATUS_PAGE_ID,
  group: false,
  only_show_if_degraded: false,
} as StatusComponent);

export const TEST_CCLOUD_INCIDENT_ID = randomUUID();

export const TEST_CCLOUD_AFFECTED_COMPONENT: AffectedComponent = AffectedComponentFromJSON({
  code: randomUUID(),
  name: TEST_CCLOUD_COMPONENT_NAME,
  old_status: "operational",
  new_status: "operational",
} as AffectedComponent);

export const TEST_CCLOUD_INCIDENT_UPDATE: StatusUpdate = StatusUpdateFromJSON({
  id: randomUUID(),
  status: "resolved",
  body: "TEST This incident has been resolved. TEST",
  incident_id: TEST_CCLOUD_INCIDENT_ID,
  created_at: new Date(Date.now()).toISOString(),
  updated_at: new Date(Date.now()).toISOString(),
  display_at: new Date(Date.now()).toISOString(),
  affected_components: [TEST_CCLOUD_AFFECTED_COMPONENT],
  deliver_notifications: false,
  custom_tweet: null,
  tweet_id: null,
} as StatusUpdate);

/** @see https://status.confluent.cloud/api/v2/summary.json */
export const TEST_CCLOUD_INCIDENT: Incident = IncidentFromJSON({
  id: TEST_CCLOUD_INCIDENT_ID,
  name: "TEST Incident for Confluent Cloud TEST",
  status: "resolved",
  created_at: new Date(Date.now()).toISOString(),
  updated_at: new Date(Date.now()).toISOString(),
  monitoring_at: null,
  resolved_at: null,
  impact: "major",
  shortlink: "https://status.confluent.cloud/incidents/" + TEST_CCLOUD_INCIDENT_ID,
  started_at: new Date(Date.now()).toISOString(),
  page_id: TEST_CCLOUD_STATUS_PAGE_ID,
  incident_updates: [TEST_CCLOUD_INCIDENT_UPDATE],
  components: [TEST_CCLOUD_STATUS_COMPONENT],
  reminder_intervals: null,
} as Incident);

export const TEST_CCLOUD_SCHEDULED_MAINTENANCE_ID = randomUUID();

export const TEST_CCLOUD_SCHEDULED_MAINTENANCE_UPDATE: StatusUpdate = StatusUpdateFromJSON({
  id: randomUUID(),
  status: "resolved",
  body: "TEST This scheduled maintenance has been resolved. TEST",
  incident_id: TEST_CCLOUD_SCHEDULED_MAINTENANCE_ID,
  created_at: new Date(Date.now()).toISOString(),
  updated_at: new Date(Date.now()).toISOString(),
  display_at: new Date(Date.now()).toISOString(),
  affected_components: [TEST_CCLOUD_AFFECTED_COMPONENT],
  deliver_notifications: false,
  custom_tweet: null,
  tweet_id: null,
} as StatusUpdate);

/** @see https://status.confluent.cloud/api/v2/summary.json */
export const TEST_CCLOUD_SCHEDULED_MAINTENANCE: ScheduledMaintenance = ScheduledMaintenanceFromJSON(
  {
    id: TEST_CCLOUD_SCHEDULED_MAINTENANCE_ID,
    name: "TEST Scheduled Maintenance for Confluent Cloud TEST",
    status: "scheduled",
    created_at: new Date(Date.now()).toISOString(),
    updated_at: new Date(Date.now()).toISOString(),
    monitoring_at: null,
    resolved_at: null,
    impact: "maintenance",
    shortlink: "https://status.confluent.cloud/maintenance/" + TEST_CCLOUD_SCHEDULED_MAINTENANCE_ID,
    started_at: new Date(Date.now()).toISOString(),
    page_id: TEST_CCLOUD_STATUS_PAGE_ID,
    incident_updates: [TEST_CCLOUD_SCHEDULED_MAINTENANCE_UPDATE],
    components: [TEST_CCLOUD_STATUS_COMPONENT],
    scheduled_for: new Date(Date.now()).toISOString(),
    scheduled_until: new Date(Date.now()).toISOString(),
  } as ScheduledMaintenance,
);

/** @see https://status.confluent.cloud/api/v2/summary.json */
export const TEST_CCLOUD_STATUS_SUMMARY: CCloudStatusSummary = CCloudStatusSummaryFromJSON({
  page: TEST_CCLOUD_STATUS_PAGE,
  components: [TEST_CCLOUD_STATUS_COMPONENT],
  incidents: [],
  scheduled_maintenances: [],
  status: {
    description: "All Systems Operational",
    indicator: "none",
  },
} as CCloudStatusSummary);
