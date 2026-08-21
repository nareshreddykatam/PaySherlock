import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "@/components/ui/EmptyState";
import { LinkButton } from "@/components/ui/Button";

describe("EmptyState", () => {
  it("renders the title, description, and an honest call to action — never fabricated metrics", () => {
    render(
      <EmptyState
        title="Your payment intelligence starts here."
        description="Connect Razorpay Test Mode and run your first investigation."
        action={<LinkButton href="/investigate">Start investigation</LinkButton>}
      />,
    );

    expect(screen.getByText("Your payment intelligence starts here.")).toBeInTheDocument();
    expect(
      screen.getByText("Connect Razorpay Test Mode and run your first investigation."),
    ).toBeInTheDocument();
    const action = screen.getByRole("link", { name: "Start investigation" });
    expect(action).toHaveAttribute("href", "/investigate");
  });
});
