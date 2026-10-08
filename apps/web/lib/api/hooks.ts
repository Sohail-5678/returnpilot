"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approvalDetailSchema,
  approvalListSchema,
  createThreadSchema,
  memoryListSchema,
  metricsSchema,
  meSchema,
  orderDetailSchema,
  orderListSchema,
  profileInfoSchema,
  policySchema,
  runDetailSchema,
  runListSchema,
  threadListSchema,
  threadSchema,
  type ApprovalDetail,
  type DecisionInput,
  type Memory,
} from "@/lib/schemas";
import { api } from "./client";

export const qk = {
  me: ["me"] as const,
  threads: ["threads"] as const,
  thread: (id: string) => ["thread", id] as const,
  orders: (status?: string) => ["orders", status ?? "all"] as const,
  order: (id: string) => ["order", id] as const,
  memories: ["memories"] as const,
  approvals: (status: "pending" | "decided") => ["approvals", status] as const,
  approval: (id: string) => ["approval", id] as const,
  runs: ["runs"] as const,
  run: (id: string) => ["run", id] as const,
  metrics: (days: number) => ["metrics", days] as const,
  policy: (id: string) => ["policy", id] as const,
};

/** GET /v1/me — also provisions this browser's demo workspace on the backend (API_CONTRACT §3). */
export const useMe = () =>
  useQuery({ queryKey: qk.me, queryFn: () => api("me", { schema: meSchema }), staleTime: Infinity });

export const useThreads = (enabled = true) =>
  useQuery({
    queryKey: qk.threads,
    queryFn: () => api("threads", { schema: threadListSchema }).then((d) => d.threads),
    enabled,
  });

export const useThread = (id: string) =>
  useQuery({
    queryKey: qk.thread(id),
    queryFn: () => api(`threads/${encodeURIComponent(id)}`, { schema: threadSchema }),
    enabled: !!id,
  });

export function useCreateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("threads", { method: "POST", body: {}, schema: createThreadSchema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.threads }),
  });
}

export function useDeleteThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`threads/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.threads }),
  });
}

export const useOrders = (status?: string) =>
  useQuery({
    queryKey: qk.orders(status),
    queryFn: () =>
      api(`orders${status ? `?status=${encodeURIComponent(status)}` : ""}`, { schema: orderListSchema }).then(
        (d) => d.orders,
      ),
  });

export const useOrder = (id: string) =>
  useQuery({
    queryKey: qk.order(id),
    queryFn: () => api(`orders/${encodeURIComponent(id)}`, { schema: orderDetailSchema }),
    enabled: !!id,
  });

export const useMemories = () =>
  useQuery({
    queryKey: qk.memories,
    queryFn: () => api("memories", { schema: memoryListSchema }).then((d) => d.memories),
  });

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api(`memories/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.memories });
      const prev = qc.getQueryData<Memory[]>(qk.memories);
      qc.setQueryData<Memory[]>(qk.memories, (old) => old?.filter((m) => m.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.memories, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.memories }),
  });
}

export const useApprovals = (status: "pending" | "decided", enabled = true) =>
  useQuery({
    queryKey: qk.approvals(status),
    queryFn: () => api(`approvals?status=${status}`, { schema: approvalListSchema }).then((d) => d.approvals),
    refetchInterval: status === "pending" ? 15_000 : false,
    enabled,
  });

export const useApproval = (id: string) =>
  useQuery({
    queryKey: qk.approval(id),
    queryFn: () => api(`approvals/${encodeURIComponent(id)}`, { schema: approvalDetailSchema }),
    enabled: !!id,
  });

export function useDecide(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: DecisionInput) =>
      api<ApprovalDetail>(`approvals/${encodeURIComponent(id)}/decision`, {
        method: "POST",
        body: input,
        schema: approvalDetailSchema,
      }),
    onSuccess: (data) => {
      qc.setQueryData(qk.approval(id), data);
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
  });
}

export const useRuns = () =>
  useQuery({
    queryKey: qk.runs,
    queryFn: () => api("runs?limit=50", { schema: runListSchema }).then((d) => d.runs),
  });

export const useRun = (id: string) =>
  useQuery({
    queryKey: qk.run(id),
    queryFn: () => api(`runs/${encodeURIComponent(id)}`, { schema: runDetailSchema }),
    enabled: !!id,
  });

export const useMetrics = (days: number) =>
  useQuery({
    queryKey: qk.metrics(days),
    queryFn: () => api(`admin/metrics?days=${days}`, { schema: metricsSchema }),
  });

export const usePolicy = (sectionId: string | null) =>
  useQuery({
    queryKey: qk.policy(sectionId ?? ""),
    queryFn: () => api(`policies/${encodeURIComponent(sectionId!)}`, { schema: policySchema }),
    enabled: !!sectionId,
    staleTime: 60 * 60 * 1000,
  });

export const useProfileInfo = () =>
  useQuery({ queryKey: ["profile"], queryFn: () => api("admin/profile", { schema: profileInfoSchema }) });

/** Thumbs up/down on a reply → stored on the run and forwarded to AgentForge (SPEC §18.1). */
export function useFeedback(runId: string) {
  return useMutation({
    mutationFn: (thumbs: 1 | -1) => api(`runs/${encodeURIComponent(runId)}/feedback`, { method: "POST", body: { thumbs } }),
  });
}
