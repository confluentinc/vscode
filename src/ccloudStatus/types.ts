/**
 * A Statuspage page object.
 * @see https://status.confluent.cloud/api/v2
 */
export interface StatusPage {
  id: string;
  name: string;
  url: string;
  time_zone: string;
  updated_at: string;
}

export function StatusPageFromJSON(obj: any): StatusPage {
  return {
    id: obj.id,
    name: obj.name,
    url: obj.url,
    time_zone: obj.time_zone,
    updated_at: obj.updated_at,
  };
}

/**
 * A Statuspage component object.
 * @see https://status.confluent.cloud/api/v2/components.json
 */
export interface StatusComponent {
  id: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
  position: number;
  description: string;
  showcase: boolean;
  start_date: string;
  group_id: string | null;
  page_id: string;
  group: boolean;
  only_show_if_degraded: boolean;
}

export function StatusComponentFromJSON(obj: any): StatusComponent {
  return {
    id: obj.id,
    name: obj.name,
    status: obj.status,
    created_at: obj.created_at,
    updated_at: obj.updated_at,
    position: obj.position,
    description: obj.description,
    showcase: obj.showcase,
    start_date: obj.start_date,
    group_id: obj.group_id,
    page_id: obj.page_id,
    group: obj.group,
    only_show_if_degraded: obj.only_show_if_degraded,
  };
}

export type AffectedComponentStatus =
  | "operational"
  | "partial_outage"
  | "major_outage"
  | "degraded_performance";

/**
 * A Statuspage affected component object.
 * @see https://status.confluent.cloud/api/v2/incidents.json
 */
export interface AffectedComponent {
  code: string;
  name: string;
  old_status: AffectedComponentStatus;
  new_status: AffectedComponentStatus;
}

export function AffectedComponentFromJSON(obj: any): AffectedComponent {
  return {
    code: obj.code,
    name: obj.name,
    old_status: obj.old_status,
    new_status: obj.new_status,
  };
}

/**
 * A Statuspage status update object.
 * @see https://status.confluent.cloud/api/v2/status-updates.json
 */
export interface StatusUpdate {
  id: string;
  status: string;
  body: string;
  incident_id: string;
  created_at: string;
  updated_at: string;
  display_at: string;
  affected_components: AffectedComponent[];
  deliver_notifications: boolean;
  custom_tweet: string | null;
  tweet_id: string | null;
}

export function StatusUpdateFromJSON(obj: any): StatusUpdate {
  return {
    id: obj.id,
    status: obj.status,
    body: obj.body,
    incident_id: obj.incident_id,
    created_at: obj.created_at,
    updated_at: obj.updated_at,
    display_at: obj.display_at,
    affected_components: (Array.isArray(obj.affected_components)
      ? obj.affected_components
      : []
    ).map((component: any) => AffectedComponentFromJSON(component)),
    deliver_notifications: obj.deliver_notifications,
    custom_tweet: obj.custom_tweet,
    tweet_id: obj.tweet_id,
  };
}

export type ImpactIndicator = "none" | "minor" | "major" | "critical";

export type IncidentStatus =
  | "investigating"
  | "identified"
  | "monitoring"
  | "resolved"
  | "postmortem";

/** A Statuspage incident. @see https://status.confluent.cloud/api/v2/incidents.json */
export interface Incident {
  id: string;
  name: string;
  status: IncidentStatus;
  created_at: string;
  updated_at: string;
  monitoring_at: string | null;
  resolved_at: string | null;
  impact: ImpactIndicator;
  shortlink: string;
  started_at: string;
  page_id: string;
  incident_updates: StatusUpdate[];
  components: StatusComponent[];
  reminder_intervals: string | null;
}

/** Converts a JSON object to an {@link Incident} object. */
export function IncidentFromJSON(obj: any): Incident {
  return {
    id: obj.id,
    name: obj.name,
    status: obj.status,
    created_at: obj.created_at,
    updated_at: obj.updated_at,
    monitoring_at: obj.monitoring_at,
    resolved_at: obj.resolved_at,
    impact: obj.impact,
    shortlink: obj.shortlink,
    started_at: obj.started_at,
    page_id: obj.page_id,
    incident_updates: (Array.isArray(obj.incident_updates) ? obj.incident_updates : []).map(
      (update: any) => StatusUpdateFromJSON(update),
    ),
    components: (Array.isArray(obj.components) ? obj.components : []).map((component: any) =>
      StatusComponentFromJSON(component),
    ),
    reminder_intervals: obj.reminder_intervals,
  };
}

export type MaintenanceStatus = "scheduled" | "in_progress" | "verifying" | "completed";

/**
 * A Statuspage scheduled maintenance object.
 * @see https://status.confluent.cloud/api/v2/scheduled-maintenances.json
 */
export interface ScheduledMaintenance {
  id: string;
  name: string;
  status: MaintenanceStatus;
  created_at: string;
  updated_at: string;
  monitoring_at: string | null;
  resolved_at: string | null;
  impact: "maintenance";
  shortlink: string;
  started_at: string;
  page_id: string;
  incident_updates: StatusUpdate[];
  components: StatusComponent[];
  scheduled_for: string;
  scheduled_until: string;
}

export function ScheduledMaintenanceFromJSON(obj: any): ScheduledMaintenance {
  return {
    id: obj.id,
    name: obj.name,
    status: obj.status,
    created_at: obj.created_at,
    updated_at: obj.updated_at,
    monitoring_at: obj.monitoring_at,
    resolved_at: obj.resolved_at,
    impact: "maintenance",
    shortlink: obj.shortlink,
    started_at: obj.started_at,
    page_id: obj.page_id,
    incident_updates: (Array.isArray(obj.incident_updates) ? obj.incident_updates : []).map(
      (update: any) => StatusUpdateFromJSON(update),
    ),
    components: (Array.isArray(obj.components) ? obj.components : []).map((component: any) =>
      StatusComponentFromJSON(component),
    ),
    scheduled_for: obj.scheduled_for,
    scheduled_until: obj.scheduled_until,
  };
}

/**
 * A Statuspage summary object.
 * @see https://status.confluent.cloud/api/v2/summary.json
 */
export interface CCloudStatusSummary {
  page: StatusPage;
  components: StatusComponent[];
  incidents: Incident[];
  scheduled_maintenances: ScheduledMaintenance[];
  status: {
    description: string;
    indicator: ImpactIndicator;
  };
}

export function CCloudStatusSummaryFromJSON(obj: any): CCloudStatusSummary {
  return {
    page: StatusPageFromJSON(obj.page),
    components: (Array.isArray(obj.components) ? obj.components : []).map((component: any) =>
      StatusComponentFromJSON(component),
    ),
    incidents: (Array.isArray(obj.incidents) ? obj.incidents : []).map((incident: any) =>
      IncidentFromJSON(incident),
    ),
    scheduled_maintenances: (Array.isArray(obj.scheduled_maintenances)
      ? obj.scheduled_maintenances
      : []
    ).map((maintenance: any) => ScheduledMaintenanceFromJSON(maintenance)),
    status: {
      description: obj.status.description,
      indicator: obj.status.indicator,
    },
  };
}
