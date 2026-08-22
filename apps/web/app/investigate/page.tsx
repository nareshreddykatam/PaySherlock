"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { InvestigationResponse } from "@paysherlock/types";
import { postInvestigation } from "@/lib/api/investigations";
import { addInvestigationHistoryEntry } from "@/lib/history/sessionHistory";
import { QuestionForm } from "@/components/investigation/QuestionForm";
import { ProgressView } from "@/components/investigation/ProgressView";
import { ResultView } from "@/components/investigation/ResultView";
import { ErrorState } from "@/components/ui/ErrorState";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; question: string }
  | { kind: "result"; response: InvestigationResponse }
  | { kind: "error"; question: string; message: string; investigationHint?: string };

function InvestigatePageInner() {
  const searchParams = useSearchParams();
  const initialQuestion = searchParams.get("q") ?? "";
  // Set only when arriving from a specific payment (e.g. "Investigate this
  // payment" on the Payments page) — carried through once, on the first
  // submit; a follow-up question after that is a fresh, general
  // investigation (see docs/decisions on why there's no multi-turn state).
  const targetPaymentId = searchParams.get("paymentId") ?? undefined;
  const [state, setState] = useState<ViewState>({ kind: "idle" });

  async function runInvestigation(question: string, paymentId?: string) {
    setState({ kind: "loading", question });
    try {
      const response = await postInvestigation(question, paymentId);
      addInvestigationHistoryEntry(question, response);
      setState({ kind: "result", response });
    } catch (error) {
      setState({
        kind: "error",
        question,
        message:
          error instanceof Error ? error.message : "The investigation service didn't respond.",
      });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Investigate</h1>
      </header>

      {state.kind === "idle" || state.kind === "error" ? (
        <QuestionForm
          initialValue={state.kind === "error" ? state.question : initialQuestion}
          onSubmit={(question) =>
            runInvestigation(question, state.kind === "idle" ? targetPaymentId : undefined)
          }
        />
      ) : null}

      {state.kind === "loading" ? <ProgressView /> : null}

      {state.kind === "error" ? (
        <ErrorState
          title="We couldn't complete the investigation."
          description={state.message}
          onRetry={() => runInvestigation(state.question)}
        />
      ) : null}

      {state.kind === "result" ? (
        <ResultView
          result={state.response}
          recommendation={state.response.recommendation}
          onFollowUp={(question) => runInvestigation(question)}
        />
      ) : null}
    </div>
  );
}

export default function InvestigatePage() {
  return (
    <Suspense>
      <InvestigatePageInner />
    </Suspense>
  );
}
