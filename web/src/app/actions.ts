"use server";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import { invalidateUser } from "@/lib/cache";

/**
 * "Refresh now" — drops every cached upstream payload for the current user
 * and tells Next to re-render all of the visible app routes. The next page
 * paint will hit KS Fit cold.
 */
export async function refreshAll() {
  const s = await getSession();
  if (s) invalidateUser(s.xjid);
  // App-shell routes that pull from `fetchAll`/`fetchSessions` need their
  // server-rendered output discarded.
  revalidatePath("/", "layout");
}
