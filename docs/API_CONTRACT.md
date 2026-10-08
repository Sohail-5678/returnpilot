# ReturnPilot — Web ↔ Backend Contract (v1)

This is the binding contract between `apps/web` (Next.js on Vercel) and `backend` (FastAPI on Render).
It refines SPEC §12 with exact JSON shapes. All money values are **numbers in dollars with 2 decimals** (e.g. `129.0`), all timestamps are ISO-8601 UTC strings, all ids are UUID strings unless noted.

## 1. Auth between web and backend

- The browser **never** talks to the backend directly. It calls `apps/web` routes under `/api/*`; the Next.js server proxies to `${BACKEND_URL}/v1/*`.
- For every proxied call the web server mints a JWT, **ES256**, 5-minute expiry, signed with `JWT_PRIVATE_KEY` (PKCS#8 PEM, base64-encoded in the env var). The backend verifies with the matching public key.
- Header: `Authorization: Bearer <jwt>`; also forward `X-Request-Id` (generate if missing).
- Claims:

| claim | example | notes |
|---|---|---|
| `iss` | `returnpilot-web` | |
| `aud` | `returnpilot-api` | |
| `exp`, `iat` | | 5 min lifetime |
| `sub` | `demo:maya` / `github:1234567` | stable principal id |
| `role` | `customer` \| `reviewer` \| `admin` | |
| `persona` | `maya` \| `arjun` \| `lena` \| `reviewer` \| `admin` \| `null` | demo personas only |
| `ws` | uuid | **demo workspace id** — one per browser (cookie `rp_ws`, 30 days). The backend clones demo data per workspace so every visitor gets a fresh, private demo. Reviewers/admins in demo mode only see their own workspace. |
| `name` | `Maya Patel` | display name |
| `login` | `octocat` | GitHub login, GitHub users only |
| `sid` | uuid | session id |

The backend resolves `customer_id` from (`sub`, `persona`, `ws`); the web never sends a customer id.

## 2. Error format

Non-2xx responses: `{"error": {"code": "string", "message": "human sentence"}}`.
Codes: `401 unauthorized`, `403 forbidden`, `404 not_found`, `409 already_decided`, `422 validation_error`, `429 rate_limited`, `503 quota_exhausted | backend_starting`.

## 3. Endpoints

### Health (no auth)
`GET /healthz` → `{"status":"ok"|"degraded","db":true,"redis":true,"mcp":true,"rss_mb":{"total":412,"web":198,...},"version":"git-sha"}`
The web exposes it as `GET /api/health` (no session required) for the "server waking up" screen.

### Session bootstrap
`GET /v1/me` (any role) →
```json
{"sub":"demo:maya","role":"customer","name":"Maya Patel","persona":"maya",
 "customer":{"id":"…","name":"Maya Patel","email":"maya.patel@example.com","loyalty_tier":"standard","shipping_pref":"store_dropoff","country":"US"} | null,
 "workspace_id":"…","demo_mode":true}
```
Calling `/v1/me` also provisions the per-workspace clone of a demo persona if it doesn't exist yet.

### Threads (customer, owner only)
- `POST /v1/threads` body `{}` → `201 {"thread_id":"…"}`
- `GET /v1/threads` → `{"threads":[{"id","title","status":"active"|"escalated"|"waiting_approval","updated_at","last_message_preview"}]}` newest first
- `GET /v1/threads/{id}` →
```json
{
  "id":"…","title":"Boots return","status":"active","created_at":"…","updated_at":"…",
  "messages":[ Message, … ],
  "pending_approval": Approval | null,
  "actions":[ Action, … ]
}
```
- `DELETE /v1/threads/{id}` → `204`

**Message**
```json
{"id":"msg-uuid","role":"user"|"assistant"|"system","text":"…","created_at":"…" ,
 "tools":[ToolCall,…],          // assistant only: tool calls made while producing this message, in order
 "citations":[{"section_id":"§2.1","doc":"returns-window","heading":"Standard window"}],
 "approval": {"approval_id":"…","status":"pending"|"approved"|"rejected"|"expired","amount":129.0,"note":null} | null,
 "flags":{"guard_replaced":false},
 "run_id":"…" | null}        // the run that produced this reply: feedback buttons + trace link
```
**ToolCall** `{"id":"call_…","name":"get_order","label":"Looked up order #1042","status":"ok"|"error"|"running","duration_ms":312,"args":{…},"result_preview":"short text"}`
`label` is a plain-English sentence; the UI shows it on the tool chip; `args`/`result_preview` go behind "details".

**Action** (side effects created in this thread) `{"id":"…","kind":"refund"|"return"|"ticket","status":"pending_approval"|"queued"|"running"|"succeeded"|"failed"|"rejected"|"expired","label":"Refund $129.00 · Trail Runner Boots","amount":129.0,"order_number":1042,"updated_at":"…","detail":"Refund issued (simulated)"}`

### Send a message — SSE stream
`POST /v1/threads/{id}/messages` body `{"text":"…"}` (1–2000 chars) → `200 text/event-stream`.
Events (each `event:` line + one `data:` JSON line, blank line between). A `: ping` comment is sent every 15 s.
```
event: run       data: {"run_id":"…"}
event: status    data: {"stage":"thinking"|"routing"|"tools"|"writing","label":"Checking your orders…"}
event: tool      data: {"id":"call_1","name":"get_order","status":"started","label":"Looking up order #1042"}
event: tool      data: {"id":"call_1","name":"get_order","status":"ok","label":"Looked up order #1042","duration_ms":312}
event: token     data: {"text":"Yes — "}
event: message   data: {"id":"…","text":"full assistant text","citations":[…]}      // full text of a finished assistant message (also sent for templated messages)
event: replace   data: {"id":"…","text":"safe replacement text"}                     // output guard replaced the streamed text
event: approval  data: {"approval_id":"…","status":"pending","amount":129.0,"summary":"Refund $129.00 · Trail Runner Boots","reason":"Amount is over the $50 auto-approve limit"}
event: action    data: Action
event: done      data: {"run_id":"…","message_id":"…"}
event: error     data: {"code":"quota_exhausted"|"rate_limited"|"internal","message":"…"}
```
A turn may contain several assistant text segments (e.g. a short sentence before tools run, then the final answer). Tokens always belong to the most recent assistant segment; a `message` event closes a segment.

### Thread live updates — SSE
`GET /v1/threads/{id}/events` → `text/event-stream`, closes after ~280 s (client reconnects). Events:
```
event: approval  data: {"approval_id":"…","status":"approved"|"rejected"|"expired","amount":129.0,"note":"…"}
event: action    data: Action
event: message   data: Message      // assistant/system message appended after an approval decision
```
Clients should also refetch `GET /v1/threads/{id}` after any event (source of truth).

### Orders (customer)
- `GET /v1/orders?status=` → `{"orders":[{"id","order_number":1042,"placed_at","delivered_at"|null,"status":"processing"|"shipped"|"delivered"|"cancelled","total":147.0,"items_count":2,"shipping_country":"US","thumbnail_category":"footwear"}]}`
- `GET /v1/orders/{id}` (id = uuid or order number) →
```json
{"id":"…","order_number":1042,"status":"delivered","placed_at":"…","delivered_at":"…","shipping_country":"US","shipping_cost":6.0,"total":153.0,"customer_note":null,
 "items":[{"id":"…","sku":"FW-TRAIL-01","name":"Trail Runner Boots","category":"footwear","qty":1,"unit_price":129.0,"discount":0.0,"final_sale":false,"opened":null,
           "return_status":null|"requested"|"label_created"|"received","refund_status":null|"pending_approval"|"queued"|"issued"|"rejected"}]}
```

### Memories (customer)
- `GET /v1/memories` → `{"memories":[{"id","content":"Prefers store drop-off for returns","kind":"preference"|"fact","created_at","source_thread_id"|null}]}`
- `DELETE /v1/memories/{id}` → `204`

### Approvals (reviewer, admin)
- `GET /v1/approvals?status=pending|decided` → `{"approvals":[ApprovalSummary]}`
  ApprovalSummary `{"id","status","action":"issue_refund","amount":129.0,"order_number":1042,"item_name":"Trail Runner Boots","customer_name":"Maya P.","reason":"Amount is over the $50 auto-approve limit","created_at","expires_at","decided_at"|null}`
- `GET /v1/approvals/{id}` →
```json
{"id":"…","status":"pending","action":"issue_refund","args":{"order_item_id":"…","amount":129.0,"reason":"return_within_window"},
 "amount":129.0,"max_amount":129.0,"order_number":1042,"item_name":"Trail Runner Boots","customer_name":"Maya P.",
 "reason":"Amount is over the $50 auto-approve limit",
 "policy":{"decision":"needs_approval","reasons":["…"],"rule_ids":["R-AMOUNT-50"]},
 "evidence":{"order":{"order_number":1042,"delivered_at":"…","status":"delivered"},"eligibility":{"eligible":true,"reasons":["…"]},"policy_sections":[{"section_id":"§2.1","heading":"…","text":"…"}],"prior_refunds_90d":0},
 "agent_summary":"Customer asked to return unopened boots within the window.",
 "thread_id":"…","run_id":"…","created_at","expires_at","decided_at":null,"decision":null}
```
- `POST /v1/approvals/{id}/decision` body `{"decision":"approve"|"approve_with_edit"|"reject","amount":100.0?,"note":"…"?}` → `200 Approval` (the detail shape above, updated). `409` if already decided, `422` if the edited amount fails policy.

### Runs (admin: all in scope; customer: own, redacted)
- `GET /v1/runs?limit=50` → `{"runs":[{"id","thread_id","status":"ok"|"interrupted"|"error","route","model_primary","total_ms","llm_calls","tool_calls","tokens_in","tokens_out","created_at","first_user_text"}]}`
- `GET /v1/runs/{id}` → `{"run":{…same…},"steps":[{"seq":1,"kind":"node"|"llm"|"tool"|"guard"|"policy"|"interrupt"|"job","name":"route","model":"llama-3.1-8b-instant"|null,"started_at","duration_ms":210,"tokens_in":312,"tokens_out":9,"status":"ok"|"error"|"interrupted","input":{…},"output":{…},"error":null}]}`

### Feedback (customer, own runs) — SPEC §18.1
`POST /v1/runs/{run_id}/feedback` body `{"thumbs": 1 | -1, "comment": "…"?}` → `{"run_id","thumbs"}`. Stored on the run and forwarded to AgentForge (`PATCH /v1/traces/{id}/feedback`) when configured.

### Agent profile (admin) — SPEC §18.2
`GET /v1/admin/profile` → `{"label":"returnpilot@1","source":"bundled|agentforge|agentforge (cached)|bundled (fallback)","default_label":"returnpilot@1","diff":[{"path":"params.temperature","default":0.2,"active":0.4}],"locked":["policy","refund_auto_approve_limit",…],"active":{…profile.v1…},"agentforge":{"url":null,"profile_source":"bundled"}}`

### Admin (admin)
`GET /v1/admin/metrics?days=7` →
```json
{"window_days":7,
 "kpis":{"runs":124,"success_rate":0.93,"approvals_pending":2,"approvals_decided":17,"avg_latency_ms":3400,"p95_latency_ms":7800,"tool_calls":402,"policy_violations":0},
 "runs_per_day":[{"day":"2026-10-01","runs":20,"errors":1}],
 "latency_per_day":[{"day":"…","p50_ms":2900,"p95_ms":7100}],
 "routes":[{"route":"refund","count":40}],
 "approvals":{"approved":12,"rejected":3,"expired":2,"pending":2},
 "quota":[{"provider":"gemini","kind":"main","model":"gemini-flash-latest","used":120,"limit":1000,"tokens_used":640000,"token_limit":3000000},
          {"provider":"groq","kind":"fast","model":"openai/gpt-oss-120b","used":40,"limit":600,"tokens_used":51000,"token_limit":120000},
          {"provider":"groq","kind":"small","model":"openai/gpt-oss-20b",…},{"provider":"groq","kind":"guard",…,"token_limit":null},
          {"provider":"gemini","kind":"lite",…},{"provider":"gemini","kind":"embed",…}],
 "evals":{"suite":"live","git_sha":"…","created_at":"…","total":30,"passed":27,"metrics":{"task_success":0.9,"trajectory_match":0.93,"policy_violations":0,"approval_routing":1.0}} | null}
```

### Policy text (any role)
`GET /v1/policies/{section_id}` (e.g. `§2.1`, URL-encoded) → `{"section_id":"§2.1","doc":"returns-window","doc_title":"Returns Policy","heading":"Standard window","text":"markdown"}`
`GET /v1/policies` → `{"docs":[{"doc":"returns-window","title":"Returns Policy","sections":[{"section_id":"§1.1","heading":"…"}]}]}`

## 4. Demo personas (web login screen)
| key | role | display | blurb |
|---|---|---|---|
| `maya` | customer | Maya Patel | Standard tier · has a $129 boots order eligible for return (needs approval) |
| `arjun` | customer | Arjun Mehta | Gold tier (60-day window) · final-sale shirt, opened headphones, a damaged mug set |
| `lena` | customer | Lena Fischer | International (DE) · already-refunded scarf · 3 refunds in 90 days |
| `reviewer` | reviewer | Riley (Support Lead) | Approves or rejects risky refunds |
| `admin` | admin | Avery (Ops Admin) | Metrics, traces, evals |
