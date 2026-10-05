"""Walk the SPEC §1.6 demo script against a running API (used locally and as a smoke test).

uv run python scripts/demo_flow.py --api http://127.0.0.1:10000 --key path/to/private.pem
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import uuid
from typing import Any

import httpx
import jwt


class Client:
    def __init__(self, api: str, key: str, persona: str, role: str, ws: str, name: str) -> None:
        self.api, self.key, self.persona, self.role, self.ws, self.name = api.rstrip("/"), key, persona, role, ws, name

    def token(self) -> str:
        now = int(time.time())
        claims = {
            "iss": "returnpilot-web",
            "aud": "returnpilot-api",
            "iat": now,
            "exp": now + 300,
            "sub": f"demo:{self.persona}",
            "role": self.role,
            "persona": self.persona,
            "ws": self.ws,
            "name": self.name,
            "sid": uuid.uuid4().hex,
        }
        return jwt.encode(claims, self.key, algorithm="ES256")

    def h(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.token()}"}

    def get(self, path: str) -> Any:
        r = httpx.get(f"{self.api}{path}", headers=self.h(), timeout=60)
        r.raise_for_status()
        return r.json()

    def post(self, path: str, body: dict[str, Any]) -> Any:
        r = httpx.post(f"{self.api}{path}", headers=self.h(), json=body, timeout=60)
        if r.status_code >= 400:
            print("ERROR", r.status_code, r.text)
            r.raise_for_status()
        return r.json()

    def chat(self, thread: str, text: str) -> list[tuple[str, dict[str, Any]]]:
        events: list[tuple[str, dict[str, Any]]] = []
        tokens: list[str] = []
        with httpx.stream(
            "POST", f"{self.api}/v1/threads/{thread}/messages", headers=self.h(), json={"text": text}, timeout=120
        ) as r:
            r.raise_for_status()
            event = None
            for line in r.iter_lines():
                if line.startswith("event: "):
                    event = line[7:]
                elif line.startswith("data: ") and event:
                    data = json.loads(line[6:])
                    events.append((event, data))
                    if event == "token":
                        tokens.append(data["text"])
                    elif event == "tool" and data["status"] != "started":
                        print(f"   🔧 {data['label']} [{data['status']}, {data.get('duration_ms')}ms]")
                    elif event in ("message", "approval", "action", "error", "replace"):
                        print(f"   [{event}] {json.dumps(data)[:240]}")
        return events


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://127.0.0.1:10000")
    ap.add_argument("--key", required=True)
    args = ap.parse_args()
    with open(args.key) as fh:
        key = fh.read()
    ws = str(uuid.uuid4())
    maya = Client(args.api, key, "maya", "customer", ws, "Maya Patel")
    riley = Client(args.api, key, "reviewer", "reviewer", ws, "Riley (Support Lead)")

    me = maya.get("/v1/me")
    print("me:", me["customer"]["name"], me["customer"]["email"])
    thread = maya.post("/v1/threads", {})["thread_id"]

    print("\n1) Maya: Can I return the boots from my last order?")
    maya.chat(thread, "Can I return the boots from my last order?")
    print("\n2) Maya: Yes, and refund me.")
    ev = maya.chat(thread, "Yes, and refund me.")
    approval = next((d for e, d in ev if e == "approval" and d["status"] == "pending"), None)
    if not approval:
        print("FAIL: no approval created")
        return 1

    print("\n3) Reviewer queue")
    queue = riley.get("/v1/approvals?status=pending")["approvals"]
    print("   pending:", [(a["title"], a["reason"]) for a in queue])
    detail = riley.get(f"/v1/approvals/{approval['approval_id']}")
    print(
        "   evidence sections:",
        [s["section_id"] for s in detail["evidence"]["policy_sections"]],
        "| summary:",
        detail["agent_summary"][:90],
    )
    decided = riley.post(
        f"/v1/approvals/{approval['approval_id']}/decision", {"decision": "approve", "note": "Within window"}
    )
    print("   decided:", decided["status"])

    print("\n4) Chat after approval (waiting for the simulated refund job)")
    for _ in range(20):
        t = maya.get(f"/v1/threads/{thread}")
        acts = {a["kind"]: a for a in t["actions"]}
        if acts.get("refund", {}).get("status") == "succeeded":
            break
        time.sleep(1)
    for m in t["messages"]:
        tools = ", ".join(x["label"] for x in m["tools"])
        print(
            f"   {m['role']:>9}: {m['text'][:150]}"
            + (f"  ⟨{tools}⟩" if tools else "")
            + (f"  approval={m['approval']['status']}" if m["approval"] else "")
        )
    print("   actions:", [(a["label"], a["status"], a["detail"]) for a in t["actions"]])

    print("\n5) New chat: Use my usual shipping preference.")
    t2 = maya.post("/v1/threads", {})["thread_id"]
    maya.chat(t2, "Use my usual shipping preference for this return.")

    print("\n6) Runs")
    admin = Client(args.api, key, "admin", "admin", ws, "Avery (Ops Admin)")
    runs = admin.get("/v1/runs?limit=5")["runs"]
    print("   runs:", [(r["kind"], r["status"], r["route"], r["total_ms"]) for r in runs])
    steps = admin.get(f"/v1/runs/{runs[-1]['id']}")["steps"]
    print("   first run steps:", " → ".join(f"{s['kind']}:{s['name']}" for s in steps))
    ok = acts.get("refund", {}).get("status") == "succeeded"
    print("\nRESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
