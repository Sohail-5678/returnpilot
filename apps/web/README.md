# ReturnPilot — web

Next.js 16 (App Router) front end for ReturnPilot. It renders the demo store UI, handles sign-in with Auth.js, and proxies every API call to the FastAPI backend with a short-lived ES256 JWT. The binding web↔backend contract is [`docs/API_CONTRACT.md`](../../docs/API_CONTRACT.md).

## Run locally

```bash
pnpm install
pnpm setup:env          # writes .env.local: throwaway ES256 key, AUTH_SECRET, MOCK_BACKEND=true, DEMO_MODE=true
pnpm dev                # http://localhost:3000
```

With `MOCK_BACKEND=true` the proxy serves realistic fixtures from `lib/mock/`, so the whole demo works without the Python backend: sign in as Maya → ask about the boots → switch to Riley (account menu) → approve → switch back to Maya.

To use the real backend, set `MOCK_BACKEND=false` and `BACKEND_URL`, and give the backend the public key that `pnpm setup:env` prints.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server (Turbopack) |
| `pnpm build` / `pnpm start` | Production build / server |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest (SSE parser, stream reducer, tool chip, approval card, roles, JWT, mock backend) |

Environment variables are documented in [`.env.example`](./.env.example).

## Layout

- `app/` — routes. `(app)/` holds the signed-in pages; `api/v1/[...path]` is the authenticated backend proxy; `api/health` is the unauthenticated health passthrough.
- `auth.ts` — Auth.js (demo personas + optional GitHub). `proxy.ts` — route guards (Next 16's renamed middleware).
- `components/` — `chat/`, `runs/` (trace timeline), `charts/`, `landing/`, `shell/`, `states/`, `ui/` primitives.
- `lib/` — zod schemas mirroring the contract, SSE parser, chat stream reducer, React Query hooks, role rules, `server/` (JWT minting, env, workspace cookie), `mock/` (fixtures + scripted agent).
