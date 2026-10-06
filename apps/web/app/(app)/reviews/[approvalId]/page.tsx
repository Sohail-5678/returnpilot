"use client";

import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  BadgeCheck,
  BookOpen,
  CircleCheck,
  CircleX,
  History,
  PackageCheck,
  PencilLine,
  ShieldAlert,
  Timer,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { use, useState } from "react";
import { toast } from "sonner";
import { LogoMark } from "@/components/brand/logo";
import { CitationSheet } from "@/components/chat/citation-sheet";
import { useAppUser } from "@/components/session-context";
import { BackLink } from "@/components/shell/page-header";
import { ErrorState } from "@/components/states/states";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/field";
import { GlyphTile, type Tone } from "@/components/ui/glyph-tile";
import { InkChip, InkPanel } from "@/components/ui/ink-panel";
import { Eyebrow } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/overlay";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge, statusMeta } from "@/components/ui/status-badge";
import { ApiError } from "@/lib/api/client";
import { qk, useApproval, useDecide } from "@/lib/api/hooks";
import type { ApprovalDetail, DecisionInput } from "@/lib/schemas";
import { useNow } from "@/lib/use-now";
import { countdown, formatDate, formatDateTime, formatMoney, relativeTime } from "@/lib/utils";

type Pending = { input: DecisionInput; title: string; body: string; label: string; tone: "primary" | "danger" | "success" };

export default function ApprovalDetailPage({ params }: { params: Promise<{ approvalId: string }> }) {
  const { approvalId } = use(params);
  const q = useApproval(approvalId);
  const [cite, setCite] = useState<string | null>(null);
  const now = useNow(30_000);

  if (q.isError) {
    return (
      <div>
        <BackLink href="/reviews">Review queue</BackLink>
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  }
  const a = q.data;

  return (
    <div>
      <BackLink href="/reviews">Review queue</BackLink>
      <Header a={a} now={now} />
      {!a ? (
        <div className="relative z-10 -mt-16 grid grid-cols-1 gap-6 px-2 sm:px-6">
          <Skeleton className="h-36 rounded-card" />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Skeleton className="h-64 rounded-card" />
            <Skeleton className="h-64 rounded-card" />
          </div>
        </div>
      ) : (
        <div className="relative z-10 -mt-16 grid grid-cols-1 gap-6 px-2 sm:px-6">
          <ProposedAction a={a} />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Evidence a={a} onCite={setCite} />
            <AgentSummary a={a} />
          </div>
          <DecisionPanel a={a} key={`${a.id}-${a.status}`} />
        </div>
      )}
      <CitationSheet sectionId={cite} onClose={() => setCite(null)} />
    </div>
  );
}

function Header({ a, now }: { a?: ApprovalDetail; now: number }) {
  const left = a ? countdown(a.expires_at, now) : null;
  const meta = statusMeta(a?.status);
  const Icon = meta.icon;
  return (
    <InkPanel innerClassName="rounded-t-hero px-6 pb-28 pt-8 sm:px-10 sm:pt-10" className="rounded-t-hero">
      {a ? (
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <InkChip>Refund request</InkChip>
              <InkChip aria-label={`Status: ${meta.label}`}>
                <Icon size={14} aria-hidden /> {meta.label.toUpperCase()}
              </InkChip>
            </div>
            <h1 className="mt-4 text-[44px] font-extrabold leading-none tracking-[-0.04em] tabular-nums sm:text-[56px]">{formatMoney(a.amount)}</h1>
            <p className="mt-3 text-[15.5px] text-white/85">
              Order #{a.order_number} · {a.customer_name} · {a.item_name}
            </p>
          </div>
          <div className="glass rounded-[22px] px-4 py-3 text-[13.5px]">
            {a.status === "pending" ? (
              <>
                <p className="flex items-center gap-1.5 font-bold">
                  <Timer size={15} aria-hidden /> {left ? `Expires in ${left}` : "Expiring"}
                </p>
                <p className="mt-0.5 text-white/75">Requested {relativeTime(a.created_at, now)}</p>
              </>
            ) : (
              <>
                <p className="font-bold">Decided {relativeTime(a.decided_at, now)}</p>
                <p className="mt-0.5 text-white/75">Requested {formatDateTime(a.created_at)}</p>
              </>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4" aria-label="Loading request">
          <Skeleton className="h-8 w-48 rounded-full bg-white/10 shadow-none" />
          <Skeleton className="h-14 w-60 rounded-full bg-white/10 shadow-none" />
        </div>
      )}
    </InkPanel>
  );
}

function ProposedAction({ a }: { a: ApprovalDetail }) {
  const args = Object.entries(a.args ?? {})
    .map(([k, v]) => `${k}=${typeof v === "string" ? `"${k.endsWith("id") && v.length > 14 ? `${v.slice(0, 8)}…` : v}"` : typeof v === "number" ? v.toFixed(2) : JSON.stringify(v)}`)
    .join(", ");
  return (
    <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="neu rounded-card p-5 sm:p-6" aria-labelledby="proposed">
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="min-w-0">
          <Eyebrow>Proposed action</Eyebrow>
          <h2 id="proposed" className="sr-only">
            Proposed action
          </h2>
          <p className="neu-inset-sm mt-2 overflow-x-auto rounded-2xl px-4 py-3 font-mono text-[13px] leading-relaxed text-ink">
            <span className="font-semibold text-accent-ink">{a.action}</span>({args})
          </p>
        </div>
        <div className="min-w-0">
          <Eyebrow>Why it needs review</Eyebrow>
          <ul className="mt-2 space-y-1.5">
            {(a.policy?.reasons?.length ? a.policy.reasons : [a.reason ?? "Policy requires a human decision"]).map((r) => (
              <li key={r} className="flex items-start gap-2 text-[14.5px] font-semibold text-ink">
                <ShieldAlert size={16} className="mt-0.5 shrink-0 text-pending-ink dark:text-pending" aria-hidden /> {r}
              </li>
            ))}
          </ul>
          {a.policy?.rule_ids?.length ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {a.policy.rule_ids.map((r) => (
                <span key={r} className="rounded-full bg-sunken px-2.5 py-1 font-mono text-[11.5px] font-medium text-ink-soft">
                  {r}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </motion.section>
  );
}

function EvidenceRow({ icon, tone, title, children }: { icon: LucideIcon; tone: Tone; title: string; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3.5">
      <GlyphTile icon={icon} tone={tone} size="sm" />
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[14px] font-bold text-ink">{title}</p>
        <div className="mt-0.5 text-[13.5px] leading-relaxed text-ink-soft">{children}</div>
      </div>
    </li>
  );
}

function Evidence({ a, onCite }: { a: ApprovalDetail; onCite: (s: string) => void }) {
  const ev = a.evidence;
  const eligible = ev?.eligibility?.eligible;
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.06 }}
      className="neu rounded-card p-5 sm:p-6"
      aria-labelledby="evidence-title"
    >
      <h2 id="evidence-title" className="mb-5 text-[17px] font-bold tracking-tight text-ink">
        Evidence
      </h2>
      <ul className="space-y-5">
        <EvidenceRow icon={PackageCheck} tone="sunset" title={`Order #${ev?.order?.order_number ?? a.order_number}`}>
          {ev?.order?.delivered_at ? `Delivered ${formatDate(ev.order.delivered_at)}` : "Not delivered yet"} · {ev?.order?.status ?? "—"}
        </EvidenceRow>
        <EvidenceRow icon={eligible ? BadgeCheck : CircleX} tone={eligible ? "mint" : "rose"} title={`Eligibility: ${eligible ? "eligible" : "not eligible"}`}>
          <ul className="space-y-0.5">
            {(ev?.eligibility?.reasons ?? []).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </EvidenceRow>
        <EvidenceRow icon={BookOpen} tone="violet" title="Policy sections">
          <div className="mt-1 flex flex-wrap gap-1.5">
            {(ev?.policy_sections ?? []).map((p) => (
              <button
                key={p.section_id}
                type="button"
                onClick={() => onCite(p.section_id)}
                className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-surface px-3 pointer-coarse:min-h-11 text-[13px] font-semibold text-accent-ink shadow-raised-sm transition-transform hover:-translate-y-0.5"
              >
                <BookOpen size={13} aria-hidden /> {p.section_id}
                {p.heading ? <span className="font-medium text-ink-faint">{p.heading}</span> : null}
              </button>
            ))}
          </div>
        </EvidenceRow>
        <EvidenceRow icon={History} tone={ev?.prior_refunds_90d ? "amber" : "sky"} title="Prior refunds (90 days)">
          {ev?.prior_refunds_90d ? `${ev.prior_refunds_90d} refund${ev.prior_refunds_90d === 1 ? "" : "s"}` : "None"}
        </EvidenceRow>
      </ul>
    </motion.section>
  );
}

function AgentSummary({ a }: { a: ApprovalDetail }) {
  const user = useAppUser();
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12 }}
      className="neu flex flex-col rounded-card p-5 sm:p-6"
      aria-labelledby="summary-title"
    >
      <h2 id="summary-title" className="mb-5 text-[17px] font-bold tracking-tight text-ink">
        Agent summary
      </h2>
      <figure className="neu-inset-sm relative flex-1 rounded-[22px] p-5">
        <div className="mb-3 flex items-center gap-2.5">
          <LogoMark size={30} />
          <figcaption className="text-[13px] font-bold text-ink">ReturnPilot</figcaption>
        </div>
        <blockquote className="text-[15px] leading-relaxed text-ink">“{a.agent_summary ?? "No summary provided."}”</blockquote>
      </figure>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px]">
        {a.run_id ? (
          user?.role === "admin" ? (
            <Link href={`/runs/${a.run_id}`} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 font-bold text-accent-ink hover:bg-sunken">
              <Activity size={15} aria-hidden /> Open the trace
            </Link>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-ink-faint">
              <Activity size={15} aria-hidden /> Trace <code className="font-mono text-xs">{a.run_id.slice(0, 8)}</code> · visible to admins
            </span>
          )
        ) : null}
      </div>
    </motion.section>
  );
}

function DecisionPanel({ a }: { a: ApprovalDetail }) {
  const qc = useQueryClient();
  const decide = useDecide(a.id);
  const [amount, setAmount] = useState(a.amount.toFixed(2));
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const max = a.max_amount ?? a.amount;
  const parsed = Number(amount);
  const amountValid = Number.isFinite(parsed) && parsed > 0 && parsed <= max + 1e-9;
  const edited = amountValid && Math.abs(parsed - a.amount) > 0.004;

  if (a.status !== "pending") {
    const d = a.decision;
    const tint = a.status === "approved" ? "bg-approved-bg text-approved-ink" : a.status === "rejected" ? "bg-rejected-bg text-rejected-ink" : "bg-expired-bg text-expired-ink";
    return (
      <motion.section initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className={`rounded-card p-5 shadow-raised sm:p-6 ${tint}`} role="status">
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={a.status} className="bg-white/60 dark:bg-black/20" />
          <p className="text-[15px] font-bold">
            {a.status === "expired"
              ? "No one decided in time — the agent told the customer."
              : `${d?.decided_by ?? "A reviewer"} ${a.status === "approved" ? "approved" : "rejected"} this ${relativeTime(a.decided_at)}`}
          </p>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-3 text-[14px] sm:grid-cols-3">
          <div>
            <dt className="font-semibold opacity-80">Decision</dt>
            <dd className="font-bold">{d?.decision ? d.decision.replace(/_/g, " ") : a.status}</dd>
          </div>
          <div>
            <dt className="font-semibold opacity-80">Amount</dt>
            <dd className="font-bold tabular-nums">{formatMoney(d?.amount ?? a.amount)}</dd>
          </div>
          <div>
            <dt className="font-semibold opacity-80">Note to customer</dt>
            <dd className="font-bold">{d?.note || "—"}</dd>
          </div>
        </dl>
      </motion.section>
    );
  }

  const run = () => {
    if (!pending) return;
    setError(null);
    decide.mutate(pending.input, {
      onSuccess: (res) => {
        setPending(null);
        toast.success(res.status === "approved" ? `Approved ${formatMoney(res.amount)}` : "Rejected", {
          description: "The agent resumed and the customer's chat updates now.",
        });
      },
      onError: (e) => {
        setPending(null);
        if (e instanceof ApiError && e.status === 409) {
          toast("Someone already decided this request.");
          qc.invalidateQueries({ queryKey: qk.approval(a.id) });
        } else setError(e instanceof ApiError ? e.message : "Couldn't save the decision. Please try again.");
      },
    });
  };

  const trimmedNote = note.trim();
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18 }}
      className="neu-hero rounded-card p-5 sm:p-7"
      aria-labelledby="decision-title"
    >
      <h2 id="decision-title" className="text-[19px] font-bold tracking-tight text-ink">
        Your decision
      </h2>
      <p className="mt-1 text-[14px] text-ink-soft">The policy engine re-checks any edited amount before the agent resumes.</p>
      <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-[220px_minmax(0,1fr)]">
        <div>
          <Label htmlFor="amount" hint={`max ${formatMoney(max)}`}>
            Amount
          </Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-semibold text-ink-faint">$</span>
            <Input
              id="amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
              aria-invalid={!amountValid}
              aria-describedby="amount-help"
              className="pl-8 text-lg font-bold tabular-nums"
            />
          </div>
          <p id="amount-help" className={`mt-1.5 text-xs ${amountValid ? "text-ink-faint" : "font-semibold text-rejected"}`}>
            {amountValid ? (edited ? "Edited — use “Approve with edit”." : "The price paid for the item.") : `Enter between $0.01 and ${formatMoney(max)}.`}
          </p>
        </div>
        <div>
          <Label htmlFor="note" hint="Shown to the customer · required to reject">
            Note to customer
          </Label>
          <Textarea id="note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Approved — thanks for your patience." className="min-h-[52px]" rows={2} />
        </div>
      </div>
      {error ? (
        <p role="alert" className="mt-4 rounded-2xl bg-rejected-bg px-4 py-3 text-sm font-semibold text-rejected-ink">
          {error}
        </p>
      ) : null}
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:items-center">
        <Button
          variant="danger"
          disabled={!trimmedNote || decide.isPending}
          title={!trimmedNote ? "Add a note for the customer to reject" : undefined}
          onClick={() =>
            setPending({
              input: { decision: "reject", note: trimmedNote },
              title: "Reject this refund?",
              body: `The customer will see: “A team member couldn't approve this refund: ${trimmedNote}.”`,
              label: "Reject refund",
              tone: "danger",
            })
          }
        >
          <CircleX size={17} aria-hidden /> Reject
        </Button>
        <div className="flex-1" />
        <Button
          variant="neu"
          disabled={!edited || decide.isPending}
          onClick={() =>
            setPending({
              input: { decision: "approve_with_edit", amount: Math.round(parsed * 100) / 100, note: trimmedNote || undefined },
              title: `Approve ${formatMoney(parsed)} instead of ${formatMoney(a.amount)}?`,
              body: "The policy engine re-validates the new amount, then a job issues the refund (simulated).",
              label: `Approve ${formatMoney(parsed)}`,
              tone: "primary",
            })
          }
        >
          <PencilLine size={17} aria-hidden /> Approve with edit
        </Button>
        <Button
          variant="success"
          size="lg"
          disabled={decide.isPending || edited || !amountValid}
          onClick={() =>
            setPending({
              input: { decision: "approve", note: trimmedNote || undefined },
              title: `Approve the ${formatMoney(a.amount)} refund?`,
              body: `${a.customer_name} gets ${formatMoney(a.amount)} back for the ${a.item_name}. A background job issues it (simulated) and the chat updates.`,
              label: "Approve refund",
              tone: "success",
            })
          }
        >
          <CircleCheck size={18} aria-hidden /> Approve
        </Button>
      </div>
      <ConfirmDialog
        open={!!pending}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.title}
        description={pending?.body}
        confirmLabel={pending?.label ?? "Confirm"}
        tone={pending?.tone}
        onConfirm={run}
        pending={decide.isPending}
      />
    </motion.section>
  );
}
