"use client";

import { useState, useId } from "react";
import type { FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils/cn";

const SUGGESTIONS = [
  "Why did revenue drop?",
  "Are payment failures increasing?",
  "What's causing failed payments?",
];

export interface QuestionFormProps {
  initialValue?: string;
  disabled?: boolean;
  onSubmit: (question: string) => void;
  label?: string;
}

export function QuestionForm({
  initialValue = "",
  disabled = false,
  onSubmit,
  label = "What would you like me to investigate?",
}: QuestionFormProps) {
  const [value, setValue] = useState(initialValue);
  const inputId = useId();

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor={inputId} className="text-sm font-medium text-ink-muted">
        {label}
      </label>
      <div
        className={cn(
          "flex flex-col gap-3 rounded-lg border border-border-strong bg-surface-2 p-3 transition-colors",
          "focus-within:border-emerald-strong",
        )}
      >
        <Textarea
          id={inputId}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              handleSubmit(event);
            }
          }}
          placeholder="Why did my successful payments drop yesterday?"
          rows={2}
          disabled={disabled}
          className="border-none bg-transparent p-0 focus-visible:ring-0"
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={disabled || value.trim().length === 0}>
            Investigate
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink-faint">Try:</span>
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            disabled={disabled}
            onClick={() => setValue(suggestion)}
            className="rounded-full border border-border-strong bg-surface-2 px-3 py-1 text-xs text-ink-muted transition-colors hover:text-ink hover:border-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong disabled:cursor-not-allowed disabled:opacity-60"
          >
            {suggestion}
          </button>
        ))}
      </div>
    </form>
  );
}
