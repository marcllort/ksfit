/**
 * /v1/exercises — Fitbit-detected + manual workouts for a day, and one
 * exercise's detail. /v1/profile — read/update the user profile (age, sex,
 * height, waist) that drives HRmax + fitness-age. Profile persistence is the
 * DB users repo (Phase 2 wires the encrypted store + session→user mapping);
 * for now reads come from the provider and updates are accepted but the DB
 * write is a TODO until the session→user id is available on the request.
 */
import { Hono } from "hono";
import { NotConnectedError } from "@stride/health-core";
import { fitbitForRequest } from "../lib/fitbit/store.ts";
import { apiError } from "../lib/errors.ts";

type Env = { Variables: { requestId: string } };
export const exerciseRoutes = new Hono<Env>();
export const profileRoutes = new Hono<Env>();

function dateOf(c: { req: { query: (k: string) => string | undefined } }): string {
  return c.req.query("date") ?? new Date().toISOString().slice(0, 10);
}

exerciseRoutes.get("/", async (c) => {
  try {
    const list = await (await fitbitForRequest(c)).getExercises(dateOf(c));
    return c.json({
      items: list.map((e) => ({
        id: e.id,
        type: e.type,
        startTime: e.startTime.getTime(),
        durationSec: e.durationSec,
        distanceKm: e.distanceM != null ? e.distanceM / 1000 : undefined,
        calories: e.calories,
        avgHr: e.avgHr,
        autoDetected: e.source === "auto",
      })),
    });
  } catch (e) {
    if (e instanceof NotConnectedError) {
      return apiError(c, "provider_not_connected", "Connect Fitbit to see workouts.");
    }
    return apiError(c, "provider_error", "Couldn't load workouts.");
  }
});

exerciseRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  try {
    // Exercises are keyed by day on the Fitbit list endpoint; find within the
    // requested day (the client passes ?date= from the list item).
    const list = await (await fitbitForRequest(c)).getExercises(dateOf(c));
    const e = list.find((x) => x.id === id);
    if (!e) return apiError(c, "not_found", "Exercise not found.");
    return c.json({
      id: e.id,
      type: e.type,
      startTime: e.startTime.getTime(),
      durationSec: e.durationSec,
      distanceKm: e.distanceM != null ? e.distanceM / 1000 : undefined,
      calories: e.calories,
      avgHr: e.avgHr,
      hrZones: e.hrZones ?? [],
      autoDetected: e.source === "auto",
    });
  } catch (e) {
    if (e instanceof NotConnectedError) {
      return apiError(c, "provider_not_connected", "Connect Fitbit to see this workout.");
    }
    return apiError(c, "provider_error", "Couldn't load the workout.");
  }
});

profileRoutes.get("/", async (c) => {
  try {
    const p = await (await fitbitForRequest(c)).getProfile();
    return c.json(p ?? {});
  } catch (e) {
    if (e instanceof NotConnectedError) {
      return apiError(c, "provider_not_connected", "Connect Fitbit to load your profile.");
    }
    return apiError(c, "provider_error", "Couldn't load your profile.");
  }
});
