import { z } from "zod";

/**
 * Push-notification schemas — §7 of docs/architecture/02-API-CONTRACT.md.
 *
 * One subscription model backs Web Push (VAPID) now and APNs (iOS) in Phase 5.
 * Delivery (the weekly "update your weight" nudge fired when
 * `GET /v1/metrics/weight` reports `stale:true`) runs on a backend cron, not a
 * client endpoint; this file also carries the user-facing config for that
 * reminder.
 */

/* -------------------------------------------------------------------------- */
/* VAPID                                                                      */
/* -------------------------------------------------------------------------- */

/** `GET /v1/push/vapid-key` response. */
export const VapidKeyResponse = z.object({
  /** Public key for the web client's PushManager.subscribe. */
  publicKey: z.string(),
});
export type VapidKeyResponse = z.infer<typeof VapidKeyResponse>;

/* -------------------------------------------------------------------------- */
/* Subscription register / unregister                                         */
/* -------------------------------------------------------------------------- */

/** Browser PushSubscription JSON (the `keys` carry p256dh + auth for VAPID). */
export const WebPushSubscriptionJson = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
});
export type WebPushSubscriptionJson = z.infer<typeof WebPushSubscriptionJson>;

/** Web Push registration body. */
export const WebPushRegisterRequest = z.object({
  kind: z.literal("web"),
  subscription: WebPushSubscriptionJson,
});
export type WebPushRegisterRequest = z.infer<typeof WebPushRegisterRequest>;

/** APNs (iOS, Phase 5) registration body. */
export const ApnsRegisterRequest = z.object({
  kind: z.literal("apns"),
  deviceToken: z.string(),
});
export type ApnsRegisterRequest = z.infer<typeof ApnsRegisterRequest>;

/** `POST /v1/push/subscriptions` request (web or apns). */
export const PushSubscriptionRegisterRequest = z.discriminatedUnion("kind", [
  WebPushRegisterRequest,
  ApnsRegisterRequest,
]);
export type PushSubscriptionRegisterRequest = z.infer<
  typeof PushSubscriptionRegisterRequest
>;

/** `POST /v1/push/subscriptions` response. */
export const PushSubscriptionRegisterResponse = z.object({
  id: z.string(),
});
export type PushSubscriptionRegisterResponse = z.infer<
  typeof PushSubscriptionRegisterResponse
>;

/** Path params for `DELETE /v1/push/subscriptions/:id`. */
export const PushSubscriptionDeleteParams = z.object({
  id: z.string(),
});
export type PushSubscriptionDeleteParams = z.infer<
  typeof PushSubscriptionDeleteParams
>;

/* -------------------------------------------------------------------------- */
/* Weekly weight-reminder config                                             */
/* -------------------------------------------------------------------------- */

/** Day of week the weekly weight nudge fires on. */
export const Weekday = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);
export type Weekday = z.infer<typeof Weekday>;

/** User-facing config for the weekly weight reminder. */
export const WeeklyWeightReminderConfig = z.object({
  enabled: z.boolean(),
  /** Day of week to fire the nudge. */
  dayOfWeek: Weekday,
  /** Local time-of-day, `HH:MM` 24h. */
  timeOfDay: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM (24h)"),
  /** IANA timezone the time is interpreted in, e.g. "Europe/Madrid". */
  timezone: z.string(),
});
export type WeeklyWeightReminderConfig = z.infer<
  typeof WeeklyWeightReminderConfig
>;

/** `GET /v1/push/weight-reminder` response. */
export const WeeklyWeightReminderResponse = WeeklyWeightReminderConfig;
export type WeeklyWeightReminderResponse = z.infer<
  typeof WeeklyWeightReminderResponse
>;

/** `PUT /v1/push/weight-reminder` request (partial update of the config). */
export const WeeklyWeightReminderUpdateRequest = WeeklyWeightReminderConfig.partial();
export type WeeklyWeightReminderUpdateRequest = z.infer<
  typeof WeeklyWeightReminderUpdateRequest
>;
