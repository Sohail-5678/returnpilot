"use client";

import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ListChecks, MessagesSquare, RefreshCw } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ErrorState } from "@/components/states/states";
import { ConversationList } from "@/components/shell/sidebar";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { qk, useCreateThread, useThread } from "@/lib/api/hooks";
import { useChatStream } from "@/lib/chat/use-chat-stream";
import { useThreadEvents } from "@/lib/chat/use-thread-events";
import type { Action, Message } from "@/lib/schemas";
import { cn } from "@/lib/utils";
import { ActionsList, ActionsPanel } from "./actions-panel";
import { CitationSheet } from "./citation-sheet";
import { Composer, type ComposerHandle } from "./composer";
import { EmptyChat } from "./empty-chat";
import { AssistantMessage, SystemNote, TypingIndicator, UserBubble } from "./message";

function nearBottom() {
  return window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 240;
}

export function ChatView({ initialThreadId }: { initialThreadId: string | null }) {
  const qc = useQueryClient();
  const params = useSearchParams();
  const [threadId, setThreadId] = useState<string | null>(initialThreadId);
  const thread = useThread(threadId ?? "");
  const createThread = useCreateThread();
  const { turn: anyTurn, liveTurn: turn, runs: runByMessage, error, send, stop, streaming, clearError } = useChatStream();
  const [cite, setCite] = useState<string | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [threadsOpen, setThreadsOpen] = useState(false);
  const composer = useRef<ComposerHandle>(null);
  const streamingRef = useRef(false);
  useEffect(() => {
    streamingRef.current = streaming;
  }, [streaming]);

  // Prefill from "Ask ReturnPilot about this order".
  const prefillOrder = params.get("order");
  const initialText = prefillOrder && /^\d{1,8}$/.test(prefillOrder) ? `I have a question about order #${prefillOrder}: ` : "";


  // Live updates after approval decisions / job progress.
  useThreadEvents(
    threadId,
    useCallback(
      (name: string, data: unknown) => {
        if (!threadId) return;
        if (name === "approval") {
          const d = data as { status?: string; amount?: number; note?: string };
          if (d.status === "approved") toast.success("A team member approved your refund");
          else if (d.status === "rejected") toast("A team member couldn't approve the refund", { description: d.note ?? undefined });
          else if (d.status === "expired") toast("The approval request expired");
        }
        if (name === "action") {
          const a = data as Action;
          if (a?.status === "succeeded" && a.kind === "refund") toast.success(a.detail ?? "Refund issued (simulated)");
        }
        // The stream's own completion refetches; avoid mid-stream refetches that would duplicate the live turn.
        if (!streamingRef.current) {
          qc.invalidateQueries({ queryKey: qk.thread(threadId) });
          qc.invalidateQueries({ queryKey: qk.threads });
        }
      },
      [qc, threadId],
    ),
  );

  const handleSend = useCallback(
    async (text: string) => {
      clearError();
      let id = threadId;
      if (!id) {
        try {
          const res = await createThread.mutateAsync();
          id = res.thread_id;
        } catch (e) {
          toast.error((e as Error).message || "Couldn't start a conversation.");
          return;
        }
        setThreadId(id);
        qc.setQueryData(qk.thread(id), {
          id,
          title: "New conversation",
          status: "active",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          messages: [],
          pending_approval: null,
          actions: [],
        });
        // Keep this component mounted (stream continues) while the URL becomes /chat/<id>.
        window.history.replaceState(null, "", `/chat/${id}`);
      }
      const base = qc.getQueryData<{ messages: Message[] }>(qk.thread(id))?.messages.length ?? 0;
      void send(id, text, base);
    },
    [threadId, createThread, send, qc, clearError],
  );

  // Auto-scroll while streaming, unless the reader scrolled up.
  const stick = useRef(true);
  useEffect(() => {
    const onScroll = () => (stick.current = nearBottom());
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const contentKey = `${thread.data?.messages.length ?? 0}:${turn?.segments.map((s) => s.text.length + s.tools.length).join(",") ?? ""}:${turn?.status?.label ?? ""}`;
  useLayoutEffect(() => {
    if (stick.current) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: streaming ? "auto" : "smooth" });
  }, [contentKey, streaming]);

  const allMessages: Message[] = useMemo(() => thread.data?.messages ?? [], [thread.data]);
  // While a turn is live, show only the messages that existed before it (the live view covers the rest).
  const messages = turn ? allMessages.slice(0, turn.baseCount) : allMessages;
  // Server copies of a just-finished turn replace the live view without replaying the enter animation.
  const quietFrom = anyTurn?.synced ? anyTurn.baseCount : Infinity;
  const quietTo = anyTurn?.synced ? anyTurn.baseCount + 1 + anyTurn.segments.length : -1;
  const actions = useMemo(() => {
    const map = new Map<string, Action>();
    for (const a of thread.data?.actions ?? []) map.set(a.id, a);
    for (const a of turn?.actions ?? []) map.set(a.id, a);
    return [...map.values()];
  }, [thread.data, turn?.actions]);

  const hasContent = messages.length > 0 || !!turn;
  const title = thread.data?.title && thread.data.title !== "New conversation" ? thread.data.title : hasContent ? "New conversation" : null;
  const showTyping = !!turn && !turn.done && (turn.segments.length === 0 || turn.segments[turn.segments.length - 1]!.closed || turn.status?.stage === "tools");

  if (threadId && thread.isError && !turn) {
    return (
      <div className="pt-6">
        <ErrorState error={thread.error} onRetry={() => thread.refetch()} />
      </div>
    );
  }

  return (
    <div className="flex gap-6 wide:gap-8">
      <div className="flex min-h-[calc(100dvh-8.5rem)] min-w-0 flex-1 flex-col md:min-h-[calc(100dvh-3rem)]">
        {/* Header */}
        {hasContent || (threadId && thread.isLoading) ? (
          <div className="glass-light sticky top-[76px] z-30 mt-3 flex items-center gap-3 rounded-full py-1.5 pl-5 pr-1.5 shadow-raised-sm md:top-3 md:mt-5">
            <div className="min-w-0 flex-1">
              {title ? (
                <h1 className="truncate text-[15.5px] font-bold tracking-tight text-ink">{title}</h1>
              ) : (
                <Skeleton className="h-4 w-40 rounded-full" />
              )}
            </div>
            {thread.data?.status === "waiting_approval" ? <StatusBadge status="waiting_approval" size="sm" className="hidden sm:inline-flex" /> : null}
            <Button variant="ghost" size="sm" className="xl:hidden" onClick={() => setThreadsOpen(true)} aria-label="Conversations">
              <MessagesSquare size={17} aria-hidden />
              <span className="hidden sm:inline">Chats</span>
            </Button>
            <Button variant="neu" size="sm" className="wide:hidden" onClick={() => setActionsOpen(true)}>
              <ListChecks size={17} aria-hidden />
              Actions
              {actions.length ? (
                <span className="grid min-w-5 place-items-center rounded-full bg-button-gradient px-1.5 text-[11px] font-bold text-white">{actions.length}</span>
              ) : null}
            </Button>
          </div>
        ) : null}

        {/* Messages */}
        <div className="flex-1">
          {!hasContent && !(threadId && thread.isLoading) ? (
            <EmptyChat onPick={(p) => handleSend(p)} disabled={streaming || createThread.isPending} />
          ) : threadId && thread.isLoading && !turn ? (
            <div className="space-y-6 pt-8" aria-label="Loading conversation">
              <Skeleton className="ml-auto h-12 w-2/3 max-w-sm rounded-[22px]" />
              <Skeleton className="h-28 w-5/6 max-w-xl rounded-[22px]" />
              <Skeleton className="ml-auto h-12 w-1/2 max-w-xs rounded-[22px]" />
            </div>
          ) : (
            <div
              className="flex flex-col gap-6 pb-6 pt-7"
              aria-live="polite"
              aria-busy={streaming}
              aria-relevant="additions text"
            >
              {messages.map((m, i) => {
                const quiet = i >= quietFrom && i < quietTo;
                if (m.role === "user") return <UserBubble key={m.id} text={m.text} at={m.created_at} quiet={quiet} />;
                if (m.role === "system") return <SystemNote key={m.id} text={m.text} at={m.created_at} />;
                const prev = messages[i - 1];
                return (
                  <AssistantMessage
                    key={m.id}
                    quiet={quiet}
                    text={m.text}
                    tools={m.tools}
                    citations={m.citations}
                    approval={m.approval}
                    replaced={!!m.flags?.guard_replaced}
                    at={m.created_at}
                    runId={runByMessage[m.id]}
                    onCite={setCite}
                    showAvatar={prev?.role !== "assistant"}
                  />
                );
              })}

              {turn ? (
                <>
                  <UserBubble text={turn.userText} at={turn.startedAt} />
                  {turn.segments.map((s, i) => (
                    <AssistantMessage
                      key={s.key}
                      text={s.text}
                      tools={s.tools}
                      citations={s.closed ? s.citations : []}
                      approval={s.approval}
                      streaming={!s.closed && !turn.done}
                      replaced={s.replaced}
                      runId={turn.done && i === turn.segments.length - 1 ? turn.runId : undefined}
                      onCite={setCite}
                      showAvatar={i === 0}
                    />
                  ))}
                  <AnimatePresence>{showTyping ? <TypingIndicator key="typing" label={turn.status?.label} /> : null}</AnimatePresence>
                </>
              ) : null}

              {error ? (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  role="alert"
                  className={cn(
                    "flex flex-col gap-3 rounded-[22px] px-4 py-3.5 shadow-raised-sm sm:flex-row sm:items-center",
                    error.code === "quota_exhausted" ? "bg-pending-bg text-pending-ink" : "bg-rejected-bg text-rejected-ink",
                  )}
                >
                  <AlertTriangle size={18} className="shrink-0" aria-hidden />
                  <p className="flex-1 text-[14px] font-medium leading-relaxed">
                    {error.code === "quota_exhausted"
                      ? "The demo's free AI quota for today is used up. You can still explore orders, the review queue and recorded runs."
                      : error.message || "Something went wrong while answering."}
                  </p>
                  {error.code !== "quota_exhausted" ? (
                    <Button variant="neu" size="sm" onClick={() => threadId && handleSend(error.text)}>
                      <RefreshCw size={15} aria-hidden /> Retry
                    </Button>
                  ) : null}
                </motion.div>
              ) : null}
            </div>
          )}
        </div>

        {/* Composer */}
        <div className="sticky bottom-0 z-20 -mx-1 bg-gradient-to-t from-bg via-bg/90 to-transparent px-1 pb-3 pt-6 md:pb-5">
          <Composer
            ref={composer}
            onSend={handleSend}
            onStop={stop}
            busy={streaming || createThread.isPending}
            initialText={initialText}
          />
        </div>
      </div>

      {/* Actions column on wide screens */}
      {hasContent ? (
        <aside className="hidden w-[300px] shrink-0 wide:block" aria-label="Actions in this conversation">
          <div className="sticky top-5 pt-5">
            <ActionsPanel actions={actions} />
          </div>
        </aside>
      ) : null}

      <Sheet open={actionsOpen} onOpenChange={setActionsOpen} title="Actions" description="Refunds and returns from this conversation, with live status.">
        <ActionsList actions={actions} className="pt-2" />
      </Sheet>
      <Sheet open={threadsOpen} onOpenChange={setThreadsOpen} side="left" title="Conversations">
        <div className="flex h-full flex-col pt-2">
          <ConversationList onNavigate={() => setThreadsOpen(false)} />
        </div>
      </Sheet>
      <CitationSheet sectionId={cite} onClose={() => setCite(null)} />
    </div>
  );
}
