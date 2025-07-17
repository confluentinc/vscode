import { SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS } from "../../extensionSettings/constants";

/** Check if the user has enabled notifications for new or updated extension activations. */
export function canShowNewOrUpdatedExtensionNotifications(): boolean {
  return SHOW_NEW_INSTALL_OR_UPDATE_NOTIFICATIONS.value ?? true;
}
