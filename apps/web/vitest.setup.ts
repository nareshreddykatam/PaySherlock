import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// @testing-library/react's auto-cleanup relies on detecting Vitest's global
// afterEach; this config runs with globals:false (consistent with the rest
// of the monorepo, which always imports test functions explicitly), so
// cleanup is registered explicitly here instead.
afterEach(() => {
  cleanup();
});
