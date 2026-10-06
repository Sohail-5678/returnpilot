/** Mock policy corpus — mirrors backend/data/policies/*.md section ids used in citations. */
export interface PolicySection {
  section_id: string;
  doc: string;
  doc_title: string;
  heading: string;
  text: string;
}

export const POLICY_SECTIONS: PolicySection[] = [
  {
    section_id: "§1.1",
    doc: "returns-window",
    doc_title: "Returns Policy",
    heading: "Who this policy covers",
    text: "This policy applies to every order placed on **northwind-outfitters.example** and shipped by Northwind Outfitters. Marketplace sellers may have their own terms.",
  },
  {
    section_id: "§2.1",
    doc: "returns-window",
    doc_title: "Returns Policy",
    heading: "Standard window",
    text: "Most items can be returned within **30 days of delivery** for a full refund to the original payment method.\n\n- Items must be unused, with tags attached, in the original packaging.\n- The window is counted from the delivery date shown on the order.\n- Final-sale items are excluded (see §5.1).",
  },
  {
    section_id: "§2.2",
    doc: "returns-window",
    doc_title: "Returns Policy",
    heading: "Loyalty tiers",
    text: "Members of the **Gold** loyalty tier get an extended **60-day** return window. Standard and Silver members use the 30-day window in §2.1.",
  },
  {
    section_id: "§2.3",
    doc: "returns-window",
    doc_title: "Returns Policy",
    heading: "Return methods",
    text: "Returns can be dropped off at any partner store (free) or picked up by a carrier ($6.00, deducted from the refund). A prepaid label is emailed once the return is created.",
  },
  {
    section_id: "§3.1",
    doc: "refunds-timeline",
    doc_title: "Refunds",
    heading: "Refund timeline",
    text: "Refunds are issued to the original payment method within **5–7 business days** after the return is received, or immediately when a refund without return is approved. Banks may take a few more days to show it.",
  },
  {
    section_id: "§3.2",
    doc: "refunds-timeline",
    doc_title: "Refunds",
    heading: "Refund amount",
    text: "The refund equals the price paid for the item minus any discounts. Original shipping is refunded only when the item arrived damaged or was the wrong item.",
  },
  {
    section_id: "§3.3",
    doc: "refunds-timeline",
    doc_title: "Refunds",
    heading: "Items already refunded",
    text: "An item can be refunded **only once**. If a refund was already issued for an item, a second refund is not possible; we can help with an exchange or store credit instead.",
  },
  {
    section_id: "§3.4",
    doc: "refunds-timeline",
    doc_title: "Refunds",
    heading: "Human approval",
    text: "Refunds over **$50**, any exception to this policy, and refunds for customers with three or more refunds in the last 90 days are reviewed by a team member before they are issued. Reviews usually finish within minutes during business hours.",
  },
  {
    section_id: "§4.1",
    doc: "exchanges",
    doc_title: "Exchanges",
    heading: "Size and color exchanges",
    text: "Unused items can be exchanged for a different size or color within the return window. Exchanges ship free once the original item is scanned by the carrier.",
  },
  {
    section_id: "§4.2",
    doc: "damaged-or-wrong-item",
    doc_title: "Damaged or Wrong Items",
    heading: "Damaged or wrong item",
    text: "If an item arrives damaged or is not what you ordered, it is eligible for a refund or replacement **within 60 days**, including final-sale items. Items under $20 are refunded without needing to be sent back.",
  },
  {
    section_id: "§5.1",
    doc: "final-sale-and-exclusions",
    doc_title: "Final Sale & Exclusions",
    heading: "Final sale items",
    text: "Items marked **Final sale** cannot be returned or refunded. They can be exchanged only if they arrived damaged (see §4.2).",
  },
  {
    section_id: "§6.1",
    doc: "electronics-returns",
    doc_title: "Electronics Returns",
    heading: "Opened electronics",
    text: "Electronics can be returned only if they are **unopened**, or if they are defective or damaged. Opened electronics in working condition are not returnable, but they are covered by the manufacturer's warranty.",
  },
  {
    section_id: "§7.1",
    doc: "international-returns",
    doc_title: "International Returns",
    heading: "International returns",
    text: "Orders shipped outside the US can be returned within the same window. Return shipping is **not free** for international orders, and the refund does not include the original shipping cost.",
  },
  {
    section_id: "§8.1",
    doc: "gift-returns",
    doc_title: "Gift Returns",
    heading: "Gift returns",
    text: "Gift recipients can return items for store credit with the gift receipt. The person who placed the order is not notified.",
  },
];

export function findPolicy(sectionId: string) {
  const norm = sectionId.trim().startsWith("§") ? sectionId.trim() : `§${sectionId.trim()}`;
  return POLICY_SECTIONS.find((p) => p.section_id === norm) ?? null;
}

export function policyCitation(sectionId: string) {
  const p = findPolicy(sectionId);
  return { section_id: sectionId, doc: p?.doc ?? "returns-window", heading: p?.heading ?? "" };
}

export function policyIndex() {
  const docs = new Map<string, { doc: string; title: string; sections: { section_id: string; heading: string }[] }>();
  for (const p of POLICY_SECTIONS) {
    const d = docs.get(p.doc) ?? { doc: p.doc, title: p.doc_title, sections: [] };
    d.sections.push({ section_id: p.section_id, heading: p.heading });
    docs.set(p.doc, d);
  }
  return { docs: [...docs.values()] };
}
