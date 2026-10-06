import type {
  Action,
  ApprovalDetail,
  Memory,
  Message,
  OrderItem,
  Run,
  RunStep,
} from "@/lib/schemas";

export type MockPersona = "maya" | "arjun" | "lena";

export interface MockCustomer {
  id: string;
  persona: MockPersona | null;
  name: string;
  short: string;
  email: string;
  loyalty_tier: "standard" | "silver" | "gold";
  shipping_pref: string;
  country: string;
  refunds_90d: number;
}

export interface MockOrder {
  id: string;
  order_number: number;
  customer_id: string;
  status: "processing" | "shipped" | "delivered" | "cancelled";
  placed_at: string;
  delivered_at: string | null;
  shipping_country: string;
  shipping_cost: number;
  total: number;
  customer_note: string | null;
  items: OrderItem[];
}

export interface MockThread {
  id: string;
  customer_id: string;
  title: string;
  status: "active" | "escalated" | "waiting_approval";
  created_at: string;
  updated_at: string;
  messages: Message[];
  actions: Action[];
  /** Facts the scripted agent has established in this thread. */
  facts: { checkedBoots?: boolean; checkedMug?: boolean; checkedBeanie?: boolean };
}

export interface MockApproval extends ApprovalDetail {
  customer_id: string;
  item_id: string | null;
  refund_action_id: string | null;
}

export interface MockRun {
  run: Run;
  steps: RunStep[];
  customer_id: string | null;
}

export interface MockMemory extends Memory {
  customer_id: string;
}

export type BusListener = (event: string, data: unknown) => void;

export interface Workspace {
  id: string;
  createdAt: number;
  customers: MockCustomer[];
  orders: MockOrder[];
  threads: Map<string, MockThread>;
  approvals: Map<string, MockApproval>;
  runs: Map<string, MockRun>;
  memories: MockMemory[];
  listeners: Map<string, Set<BusListener>>;
}
