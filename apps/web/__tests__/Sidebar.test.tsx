import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Sidebar } from "@/components/layout/Sidebar";

vi.mock("next/navigation", () => ({
  usePathname: () => "/investigate",
}));

// ConnectionStatus pings the real API on mount — mock it so tests never
// depend on network access.
vi.mock("@/lib/api/health", () => ({
  getHealth: () => new Promise(() => {}),
}));

describe("Sidebar", () => {
  it("renders every primary navigation item as an accessible link", () => {
    render(<Sidebar />);

    for (const label of ["Overview", "Investigate", "Payments", "Issues", "History"]) {
      expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
    }
  });

  it("marks the current page's link with aria-current, and only that one", () => {
    render(<Sidebar />);

    const activeLink = screen.getByRole("link", { name: "Investigate" });
    expect(activeLink).toHaveAttribute("aria-current", "page");

    const otherLink = screen.getByRole("link", { name: "Payments" });
    expect(otherLink).not.toHaveAttribute("aria-current");
  });

  it("shows Settings as a disabled, non-interactive placeholder (Phase 3 brief section 8)", () => {
    render(<Sidebar />);

    const settings = screen.getByText("Settings");
    expect(settings.closest("[aria-disabled='true']")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });
});
