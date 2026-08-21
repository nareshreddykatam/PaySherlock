"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { InvestigationResult } from "@paysherlock/types";
import { postInvestigation } from "@/lib/api/investigations";
import { addInvestigationHistoryEntry } from "@/lib/history/sessionHistory";
import { QuestionForm } from "@/components/investigation/QuestionForm";
import { ProgressView } from "@/components/investigation/ProgressView";
import { ResultView } from "@/components/investigation/ResultView";
import { ErrorState } from "@/components/ui/ErrorState";

type ViewState =
  | { kind: "idle" }
  | { kind: "loading"; question: string }
  | { kind: "result"; result: InvestigationResult }
  | { kind: "error"; question: string; message: string; investigationHint?: string };

function InvestigatePageInner() {
  const searchParams = useSearchParams();
  const initialQuestion = searchParams.get("q") ?? "";
  const [state, setState] = useState<ViewState>({ kind: "idle" });

  async function runInvestigation(question: string) {
    setState({ kind: "loading", question });
    try {
      const result = await postInvestigation(question);
      addInvestigationHistoryEntry(question, result);
      setState({ kind: "result", result });
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
          onSubmit={runInvestigation}
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
        <ResultView result={state.result} onFollowUp={runInvestigation} />
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
