"""The orchestration graph (SPEC §7.3).

START → load_context → input_guard ─blocked→ finalize
                          └→ route ─human→ escalate → finalize
                               └→ agent ⇄ tools → policy_check ─allow→ execute_action → agent
                                    │                    └─needs_approval→ announce_pending → approval_gate (interrupt)
                                    │                                         ├─approved→ execute_action → announce_outcome
                                    │                                         └─rejected/expired→ announce_outcome → finalize
                                    └─final answer→ respond → output_guard → write_memory → finalize → END
"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage
from langgraph.graph import END, START, StateGraph

from returnpilot.agent.nodes import approval, context, policy, respond, tools
from returnpilot.agent.nodes.agent import agent
from returnpilot.agent.state import AgentState, TurnContext


def after_input_guard(state: AgentState) -> str:
    return "finalize" if state.get("flags", {}).get("blocked") else "route"


def after_route(state: AgentState) -> str:
    return "escalate" if state.get("route") == "human" else "agent"


def after_agent(state: AgentState) -> str:
    last = state["messages"][-1]
    if isinstance(last, AIMessage) and last.tool_calls and not state.get("stop_reason"):
        return "tools"
    return "respond"


def after_policy(state: AgentState) -> str:
    if state.get("actions_to_execute"):
        return "execute_action"
    pending = state.get("pending_action")
    if pending and not pending.get("approval_id"):
        return "announce_pending"
    return "agent"


def after_execute(state: AgentState) -> str:
    pending = state.get("pending_action")
    if pending and pending.get("review"):
        return "announce_outcome"
    if pending and not pending.get("approval_id"):
        return "announce_pending"
    return "agent"


def after_gate(state: AgentState) -> str:
    if state.get("stop_reason") == "deferred":
        return END
    decision = ((state.get("pending_action") or {}).get("review") or {}).get("decision")
    return "execute_action" if decision in approval.APPROVED else "announce_outcome"


def build_graph(checkpointer: Any = None) -> Any:
    g = StateGraph(AgentState, context_schema=TurnContext)
    g.add_node("load_context", context.load_context)
    g.add_node("input_guard", context.input_guard)
    g.add_node("route", context.route)
    g.add_node("agent", agent)
    g.add_node("tools", tools.tools)
    g.add_node("policy_check", policy.policy_check)
    g.add_node("announce_pending", approval.announce_pending)
    g.add_node("approval_gate", approval.approval_gate)
    g.add_node("execute_action", approval.execute_action)
    g.add_node("announce_outcome", approval.announce_outcome)
    g.add_node("escalate", respond.escalate)
    g.add_node("respond", respond.respond)
    g.add_node("output_guard", respond.output_guard)
    g.add_node("write_memory", respond.write_memory)
    g.add_node("finalize", respond.finalize)

    g.add_edge(START, "load_context")
    g.add_edge("load_context", "input_guard")
    g.add_conditional_edges("input_guard", after_input_guard, ["route", "finalize"])
    g.add_conditional_edges("route", after_route, ["agent", "escalate"])
    g.add_conditional_edges("agent", after_agent, ["tools", "respond"])
    g.add_edge("tools", "policy_check")
    g.add_conditional_edges("policy_check", after_policy, ["execute_action", "announce_pending", "agent"])
    g.add_conditional_edges("execute_action", after_execute, ["announce_outcome", "announce_pending", "agent"])
    g.add_edge("announce_pending", "approval_gate")
    g.add_conditional_edges("approval_gate", after_gate, ["execute_action", "announce_outcome", END])
    g.add_edge("announce_outcome", "finalize")
    g.add_edge("escalate", "finalize")
    g.add_edge("respond", "output_guard")
    g.add_edge("output_guard", "write_memory")
    g.add_edge("write_memory", "finalize")
    g.add_edge("finalize", END)
    return g.compile(checkpointer=checkpointer)
