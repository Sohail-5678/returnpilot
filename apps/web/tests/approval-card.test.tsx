import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApprovalCard, approvalCopy } from "@/components/chat/approval-card";

describe("ApprovalCard", () => {
  it("pending: waiting for a human reviewer, with the amount", () => {
    render(<ApprovalCard status="pending" amount={129} />);
    const card = screen.getByTestId("approval-card");
    expect(card).toHaveAttribute("data-status", "pending");
    expect(card).toHaveAttribute("role", "status");
    expect(screen.getByText("Waiting for a human reviewer")).toBeInTheDocument();
    expect(card).toHaveTextContent("Refund of $129.00 is waiting for a team member");
  });

  it("approved: names the outcome and shows the note", () => {
    render(<ApprovalCard status="approved" amount={100} note="Partial refund for wear" />);
    expect(screen.getByText("Approved by a team member")).toBeInTheDocument();
    expect(screen.getByTestId("approval-card")).toHaveTextContent("$100.00");
    expect(screen.getByTestId("approval-card")).toHaveTextContent("Partial refund for wear");
  });

  it("rejected: includes the reviewer note (SPEC §2.5 wording)", () => {
    render(<ApprovalCard status="rejected" amount={129} note="Outside the return window" />);
    expect(screen.getByText("Not approved")).toBeInTheDocument();
    expect(screen.getByTestId("approval-card")).toHaveTextContent(
      "A team member couldn't approve this refund: Outside the return window",
    );
  });

  it("expired: grey state explains what happens next", () => {
    render(<ApprovalCard status="expired" amount={58} />);
    expect(screen.getByText("Request expired")).toBeInTheDocument();
    expect(screen.getByTestId("approval-card")).toHaveAttribute("data-status", "expired");
  });

  it("never relies on color alone: every state has a distinct title and icon", () => {
    const states = ["pending", "approved", "rejected", "expired"] as const;
    const titles = states.map((s) => approvalCopy(s, 10).title);
    const icons = states.map((s) => approvalCopy(s, 10).icon);
    expect(new Set(titles).size).toBe(4);
    expect(new Set(icons).size).toBe(4);
  });
});
