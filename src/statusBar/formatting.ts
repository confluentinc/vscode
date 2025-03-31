import { MarkdownString } from "vscode";
import {
  CCloudStatusSummary,
  ImpactIndicator,
  Incident,
  IncidentStatus,
  MaintenanceStatus,
  ScheduledMaintenance,
} from "../ccloudStatus/types";
import { IconNames } from "../constants";
import { CustomMarkdownString } from "../models/main";
import { titleCase } from "../utils";

/** Number of Incident/ScheduledMaintenance items to show, per status, in the CCloud status bar
 * item tooltip. */
export const MAX_ITEMS_PER_GROUP = 2;

/** The order the "active" incidents will be displayed, per status group. */
export const ACTIVE_INCIDENT_STATUS_ORDER: IncidentStatus[] = [
  "investigating",
  "identified",
  "monitoring",
] as IncidentStatus[];

/** Statuses that will be under the "Last resolved" group. */
export const COMPLETED_INCIDENT_STATUSES: IncidentStatus[] = [
  "resolved",
  "postmortem",
] as IncidentStatus[];

/** The order the "active" maintenances will be displayed, per status group. */
export const ACTIVE_MAINTENANCE_STATUS_ORDER: MaintenanceStatus[] = [
  "in_progress",
  "verifying",
  "scheduled",
] as MaintenanceStatus[];

/** Statuses that will be under the "Last completed" group. */
export const COMPLETED_MAINTENANCE_STATUSES: MaintenanceStatus[] = [
  "completed",
] as MaintenanceStatus[];

/** Header (size) to use for "Active incidents"/"Scheduled maintenance" sections */
export const SECTION_HEADER = "###";
/** Header (size) to use for status group subsections */
export const GROUP_HEADER = "####";

/**
 * Creates a {@link MarkdownString} for the status bar item tooltip based on the provided
 * {@link CCloudStatusSummary}.
 */
export function createStatusSummaryMarkdown(status: CCloudStatusSummary): MarkdownString {
  // header section
  let tooltipMarkdown: MarkdownString = new CustomMarkdownString(
    `**$(${IconNames.CONFLUENT_LOGO}) Confluent Cloud Status** [$(link-external)](https://status.confluent.cloud/)`,
  ).appendMarkdown("\n\n---\n\n");

  if (!status.incidents.length && !status.scheduled_maintenances.length) {
    tooltipMarkdown.appendMarkdown("No notices for Confluent Cloud at this time.");
    return tooltipMarkdown;
  }

  if (status.incidents.length) {
    const incidentMarkdown: string = formatIncidentOrMaintenanceSection(
      status.incidents,
      "Active Incidents",
      ACTIVE_INCIDENT_STATUS_ORDER,
      "Last resolved",
      COMPLETED_INCIDENT_STATUSES,
    );
    tooltipMarkdown.appendMarkdown(incidentMarkdown);
  }
  if (status.incidents.length && status.scheduled_maintenances.length) {
    // add a separator between incidents and maintenances
    tooltipMarkdown.appendMarkdown("\n\n---\n\n");
  }
  if (status.scheduled_maintenances.length) {
    const maintenanceMarkdown: string = formatIncidentOrMaintenanceSection(
      status.scheduled_maintenances,
      "Scheduled Maintenance",
      ACTIVE_MAINTENANCE_STATUS_ORDER,
      "Last completed",
      COMPLETED_MAINTENANCE_STATUSES,
    );
    tooltipMarkdown.appendMarkdown(maintenanceMarkdown);
  }

  return tooltipMarkdown;
}

type IncidentOrMaintenance = Incident | ScheduledMaintenance;
type IncidentOrMaintenanceStatus = IncidentStatus | MaintenanceStatus;

/**
 * Formats the {@link IncidentOrMaintenance} array into a Markdown string.
 *
 */
export function formatIncidentOrMaintenanceSection(
  items: IncidentOrMaintenance[],
  sectionHeaderString: string,
  activeStatuses: IncidentOrMaintenanceStatus[],
  completedHeaderString: string,
  completedStatuses: IncidentOrMaintenanceStatus[],
): string {
  const sectionMarkdown: MarkdownString = new CustomMarkdownString();

  // show active items by status group subsections first
  const activeItems: IncidentOrMaintenance[] = items.filter((item) =>
    activeStatuses.includes(item.status),
  );
  // if we have more than {MAX_ITEMS_PER_GROUP} active items, show a clickable link to the status page
  let activeDetail: string = "";
  if (activeItems.length > MAX_ITEMS_PER_GROUP) {
    activeDetail = ` ([${activeItems.length}](https://status.confluent.cloud/))`;
  }
  sectionMarkdown.appendMarkdown(`${SECTION_HEADER} ${sectionHeaderString}${activeDetail}`);

  const statusGroups: Map<IncidentOrMaintenanceStatus, IncidentOrMaintenance[]> = new Map();
  activeItems.forEach((item) => {
    if (!statusGroups.has(item.status)) {
      statusGroups.set(item.status, []);
    }
    statusGroups.get(item.status)?.push(item);
  });
  for (const status of activeStatuses) {
    if (!statusGroups.has(status)) {
      continue;
    }
    const statusGroupItems: IncidentOrMaintenance[] | undefined = statusGroups.get(status);
    if (!statusGroupItems) {
      // should never happen since we won't add to the map if it doesn't exist
      continue;
    }
    const statusGroupMarkdown: string = formatStatusGroup(status, statusGroupItems);
    sectionMarkdown.appendMarkdown(statusGroupMarkdown);
  }

  // then show completed items in their own section at the bottom
  const completedItems: IncidentOrMaintenance[] = items.filter((item) =>
    completedStatuses.includes(item.status),
  );
  if (completedItems.length) {
    const completedGroupMarkdown: string = formatStatusGroup(completedHeaderString, completedItems);
    sectionMarkdown.appendMarkdown(completedGroupMarkdown);
  }

  return sectionMarkdown.value;
}

/**
 * Formats the {@link IncidentOrMaintenance} array for a given {@link IncidentOrMaintenanceStatus}
 * group into a Markdown string.
 */
export function formatStatusGroup(
  status: IncidentOrMaintenanceStatus | string,
  items: IncidentOrMaintenance[],
): string {
  if (!items.length) {
    return "";
  }

  const groupMarkdown: MarkdownString = new CustomMarkdownString(
    `\n\n${GROUP_HEADER} ${titleCase(status)}`,
  );

  // show only the last MAX_ITEMS_PER_GROUP items sorted by updated_at (newest->oldest)
  const recentItems: IncidentOrMaintenance[] = items
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, MAX_ITEMS_PER_GROUP);

  // and style with their ImpactStatus icon and local date/time suffix
  recentItems.forEach((item) => {
    const iconSymbol: string = getIconForImpact(item.impact);
    const updatedDate: string = formatDate(item.updated_at);
    groupMarkdown.appendMarkdown(
      `\n\n **${iconSymbol} [${item.name}](${item.shortlink})** (${updatedDate})`,
    );
  });

  return groupMarkdown.value;
}

/** Returns the codicon ID for the given {@link ImpactIndicator}. */
export function getIconForImpact(impact: ImpactIndicator): string {
  switch (impact) {
    case "critical":
      return "$(error)";
    case "major":
      return "$(warning)";
    case "minor":
    case "none":
      return "$(info)";
    case "maintenance":
      // only for scheduled maintenance
      return "$(tools)";
    default:
      return "";
  }
}

/** Formats the given date string to match date/time shown in https://status.confluent.cloud/. */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return "Unknown date/time";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
}
