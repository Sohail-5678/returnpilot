import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ToolChip, ToolChipGroup } from "@/components/chat/tool-chip";
import type { ToolCall } from "@/lib/schemas";

const base: ToolCall = {
  id: "call_1",
  name: "check_return_eligibility",
  label: "Checked return eligibility (#1042)",
  status: "ok",
  duration_ms: 198,
  args: { order_item_id: "item-1", item_condition: "unopened" },
  result_preview: "eligible · R-WINDOW-30",
};

function renderChip(tool: ToolCall) {
  return render(
    <ul>
      <ToolChip tool={tool} />
    </ul>,
  );
}

describe("ToolChip", () => {
  it("shows the human label and a success icon with an accessible name", () => {
    renderChip(base);
    expect(screen.getByText("Checked return eligibility (#1042)")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Succeeded" })).toBeInTheDocument();
    expect(screen.getByText("198 ms")).toBeInTheDocument();
  });

  it("shows a failure state", () => {
    renderChip({ ...base, status: "error", label: "Couldn't open order #9999" });
    expect(screen.getByRole("img", { name: "Failed" })).toBeInTheDocument();
    expect(screen.getByTestId("tool-chip")).toHaveAttribute("data-status", "error");
  });

  it("shows a spinner while running and hides the duration", () => {
    renderChip({ ...base, status: "running", label: "Checking return eligibility (#1042)", duration_ms: null });
    expect(screen.getByRole("img", { name: "Running" })).toBeInTheDocument();
    expect(screen.queryByText(/ms$/)).not.toBeInTheDocument();
  });

  it("keeps raw args and results behind 'details'", async () => {
    renderChip(base);
    const toggle = screen.getByRole("button", { name: /details/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/item_condition/)).not.toBeInTheDocument();

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/"item_condition": "unopened"/)).toBeInTheDocument();
    expect(screen.getByText(/eligible · R-WINDOW-30/)).toBeInTheDocument();
  });

  it("has no details toggle when there is nothing to show", () => {
    renderChip({ ...base, args: null, result_preview: null });
    expect(screen.queryByRole("button", { name: /details/i })).not.toBeInTheDocument();
  });
});

describe("ToolChipGroup", () => {
  it("renders every tool in order and nothing when empty", () => {
    const { container, rerender } = render(
      <ToolChipGroup tools={[base, { ...base, id: "call_2", label: "Read policy: Returns › 30-day window" }]} />,
    );
    const chips = screen.getAllByTestId("tool-chip");
    expect(chips).toHaveLength(2);
    expect(chips[1]).toHaveTextContent("Read policy: Returns › 30-day window");
    rerender(<ToolChipGroup tools={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
