import {
  IssueListResponseSchema,
  IssueSchema,
  type Issue,
  type IssueListResponse,
} from "@paysherlock/types";
import { apiFetch } from "./client";

export interface GetIssuesParams {
  cursor?: string;
  limit?: number;
}

export async function getIssues(params: GetIssuesParams = {}): Promise<IssueListResponse> {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  const qs = query.toString();

  const raw = await apiFetch<unknown>(`/issues${qs ? `?${qs}` : ""}`);
  const parsed = IssueListResponseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The issues service returned an unexpected response shape.");
  }
  return parsed.data;
}

export async function getIssue(id: string): Promise<Issue> {
  const raw = await apiFetch<unknown>(`/issues/${encodeURIComponent(id)}`);
  const parsed = IssueSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The issues service returned an unexpected response shape.");
  }
  return parsed.data;
}
