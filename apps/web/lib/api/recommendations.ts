import {
  RecommendationListResponseSchema,
  RecommendationSchema,
  type Recommendation,
} from "@paysherlock/types";
import { apiFetch } from "./client";

export interface GetRecommendationsParams {
  cursor?: string;
  limit?: number;
  /** Track 03: fetch only the recommendations belonging to one recovery
   * batch (grouped by the issue that triggered it). */
  issueId?: string;
}

export async function getRecommendations(params: GetRecommendationsParams = {}) {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.issueId) query.set("issueId", params.issueId);
  const qs = query.toString();

  const raw = await apiFetch<unknown>(`/recommendations${qs ? `?${qs}` : ""}`);
  const parsed = RecommendationListResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The recommendations service returned an unexpected response shape.");
  }
  return parsed.data;
}

export async function getRecommendation(id: string): Promise<Recommendation> {
  const raw = await apiFetch<unknown>(`/recommendations/${encodeURIComponent(id)}`);
  const parsed = RecommendationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The recommendations service returned an unexpected response shape.");
  }
  return parsed.data;
}

/**
 * Explicit merchant approval — the ONLY path that ever causes a Razorpay
 * refund to be executed. No amount, payment id, or risk level is ever
 * sent in this request; the server derives everything from the persisted
 * recommendation. See docs/decisions.
 */
export async function approveRecommendation(id: string): Promise<Recommendation> {
  const raw = await apiFetch<unknown>(`/recommendations/${encodeURIComponent(id)}/approve`, {
    method: "POST",
  });
  const parsed = RecommendationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The recommendations service returned an unexpected response shape.");
  }
  return parsed.data;
}

export async function rejectRecommendation(id: string): Promise<Recommendation> {
  const raw = await apiFetch<unknown>(`/recommendations/${encodeURIComponent(id)}/reject`, {
    method: "POST",
  });
  const parsed = RecommendationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The recommendations service returned an unexpected response shape.");
  }
  return parsed.data;
}

export async function retryRecommendation(id: string): Promise<Recommendation> {
  const raw = await apiFetch<unknown>(`/recommendations/${encodeURIComponent(id)}/retry`, {
    method: "POST",
  });
  const parsed = RecommendationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The recommendations service returned an unexpected response shape.");
  }
  return parsed.data;
}
