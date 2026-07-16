export const NOTIFICATION_QUERY_PARAM = "notification";

export function notificationActionUrl(notificationId: string) {
  return `/?${NOTIFICATION_QUERY_PARAM}=${encodeURIComponent(notificationId)}`;
}
