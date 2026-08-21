import { forwardRef } from "react";
import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-md border border-border-strong bg-surface-2 px-3 text-sm text-ink placeholder:text-ink-faint",
          "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong focus-visible:border-emerald-strong",
          "disabled:cursor-not-allowed disabled:opacity-60",
          className,
        )}
        {...props}
      />
    );
  },
);

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-none rounded-md border border-border-strong bg-surface-2 px-3 py-2.5 text-sm text-ink placeholder:text-ink-faint",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong focus-visible:border-emerald-strong",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
});
