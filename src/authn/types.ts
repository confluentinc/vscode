/** Query parameters passed in the UriHandler's /authCallback path. */
export interface AuthCallbackEvent {
  success: boolean;
  resetPassword: boolean;
}
