import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QuestionForm } from "@/components/investigation/QuestionForm";

describe("QuestionForm", () => {
  it("has a labeled textarea and disables submit until there's input", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<QuestionForm onSubmit={onSubmit} />);

    const textarea = screen.getByLabelText("What would you like me to investigate?");
    const submit = screen.getByRole("button", { name: /investigate/i });
    expect(submit).toBeDisabled();

    await user.type(textarea, "Why did revenue drop?");
    expect(submit).toBeEnabled();
  });

  it("calls onSubmit with the trimmed question when submitted", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<QuestionForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/investigate/i), "  Why did revenue drop?  ");
    await user.click(screen.getByRole("button", { name: /investigate/i }));

    expect(onSubmit).toHaveBeenCalledWith("Why did revenue drop?");
  });

  it("submits on Enter without requiring Shift+Enter (which inserts a newline instead)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<QuestionForm onSubmit={onSubmit} />);

    const textarea = screen.getByLabelText(/investigate/i);
    await user.type(textarea, "Are payment failures increasing?");
    await user.keyboard("{Enter}");

    expect(onSubmit).toHaveBeenCalledWith("Are payment failures increasing?");
  });

  it("fills the question when a suggestion chip is clicked", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<QuestionForm onSubmit={onSubmit} />);

    await user.click(screen.getByRole("button", { name: "Why did revenue drop?" }));
    expect(screen.getByLabelText(/investigate/i)).toHaveValue("Why did revenue drop?");
  });

  it("disables the form while an investigation is in flight", () => {
    render(<QuestionForm onSubmit={vi.fn()} disabled initialValue="Why did revenue drop?" />);

    expect(screen.getByLabelText(/investigate/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: /investigate/i })).toBeDisabled();
  });
});
