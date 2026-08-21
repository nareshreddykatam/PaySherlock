import { OverviewResponseSchema, type OverviewResponse } from "@paysherlock/types";
import { apiFetch } from "./client";

export async function getOverview(): Promise<OverviewResponse> {
  const raw = await apiFetch<unknown>("/overview");
  const parsed = OverviewResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The overview service returned an unexpected response shape.");
  }
  return parsed.data;
}
