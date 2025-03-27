This subdirectory handles making requests to the Atlassian Statuspage
[**Status API**](https://support.atlassian.com/statuspage/docs/what-are-the-different-apis-under-statuspage/).
When enabled, a poller will occasionally make requests to
https://status.confluent.cloud/api/v2/summary.json and show the status of Confluent Cloud in the
extension's contributed status bar item.
