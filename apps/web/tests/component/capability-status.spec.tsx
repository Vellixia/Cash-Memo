// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import "../setup.js";

import {
  CapabilityStatus,
  type CapabilityStatusKind,
} from "../../src/features/degraded/CapabilityStatus.js";

describe("degraded capability status", () => {
  it.each([
    ["assisted_capture_unavailable", "Structured manual entry remains available"],
    ["voice_unavailable", "Typed and structured manual entry remain available"],
    ["calculation_unavailable", "Journal capture and history remain available"],
  ] as const)("keeps unaffected product areas explicit for %s", (kind, copy) => {
    render(<CapabilityStatus kind={kind} />);
    expect(screen.getByRole("status")).toHaveTextContent(copy);
  });

  it.each(["core_storage_unavailable", "auth_unavailable"] as const)(
    "marks %s as a fail-closed core failure",
    (kind) => {
      render(<CapabilityStatus kind={kind} />);
      expect(screen.getByRole("alert")).toHaveAttribute("data-capability-class", "core");
    },
  );

  it("uses no raw provider or infrastructure internals", () => {
    const kinds: CapabilityStatusKind[] = [
      "assisted_capture_unavailable",
      "auth_unavailable",
      "calculation_unavailable",
      "core_storage_unavailable",
      "voice_unavailable",
    ];
    for (const kind of kinds) {
      const rendered = render(<CapabilityStatus kind={kind} />);
      expect(rendered.container).not.toHaveTextContent(/OpenAI|PostgreSQL|SQLSTATE|stack trace/iu);
      rendered.unmount();
    }
  });
});
