import { useState, useCallback, useRef, useEffect } from "react";
import type { CouncilState } from "@/lib/councilTypes";

const API_BASE = import.meta.env.DEV ? import.meta.env.VITE_BACKEND_URL || "" : "";

const initialState: CouncilState = {
  phase: "idle",
  agents: [],
  currentRound: 0,
};

export function useCouncilDeliberation(intentId: string | null) {
  const [state, setState] = useState<CouncilState>(initialState);
  const eventSourceRef = useRef<EventSource | null>(null);

  const openEventSource = useCallback((es: EventSource) => {
    es.onmessage = (event) => {
      const data = JSON.parse(event.data);

      setState(prev => {
        switch (data.type) {
          case "council_started":
            return {
              ...prev,
              phase: "deliberating",
              agents: data.payload.agents.map((a: any) => ({
                id: a.id,
                name: a.name,
                role: a.role,
                avatar: a.avatar,
                status: "waiting" as const,
                messages: [],
                currentStreamContent: "",
              })),
            };

          case "agent_thinking":
            return {
              ...prev,
              currentRound: data.payload.round,
              agents: prev.agents.map(a =>
                a.id === data.payload.agentId
                  ? { ...a, status: "thinking" as const, currentStreamContent: "" }
                  : a
              ),
            };

          case "agent_token":
            return {
              ...prev,
              agents: prev.agents.map(a =>
                a.id === data.payload.agentId
                  ? { ...a, currentStreamContent: a.currentStreamContent + data.payload.token }
                  : a
              ),
            };

          case "agent_message":
            return {
              ...prev,
              agents: prev.agents.map(a =>
                a.id === data.payload.agentId
                  ? {
                      ...a,
                      status: "done" as const,
                      messages: [...a.messages, { round: data.payload.round, content: data.payload.content }],
                      currentStreamContent: "",
                    }
                  : a
              ),
            };

          case "agent_vote":
            return {
              ...prev,
              phase: "voting",
              agents: prev.agents.map(a =>
                a.id === data.payload.agentId
                  ? { ...a, vote: data.payload.vote }
                  : a
              ),
            };

          case "council_result":
            return {
              ...prev,
              phase: "complete",
              result: {
                approved: data.payload.approved,
                ratio: data.payload.ratio,
                totalFor: data.payload.totalFor,
                totalAgainst: data.payload.totalAgainst,
                totalAbstain: data.payload.totalAbstain,
                summary: data.payload.summary,
              },
            };

          case "council_cached":
            return {
              ...prev,
              phase: "cached",
              agents: data.payload.agents?.map((a: any) => ({
                id: a.agentId,
                name: a.agentName,
                role: a.role,
                avatar: a.avatar,
                status: "done" as const,
                messages: a.rounds.map((content: string, idx: number) => ({
                  round: idx + 1,
                  content,
                })),
                currentStreamContent: "",
                vote: a.vote,
              })) ?? prev.agents,
              result: {
                approved: data.payload.approved,
                ratio: data.payload.ratio,
                totalFor: data.payload.totalFor,
                totalAgainst: data.payload.totalAgainst,
                totalAbstain: data.payload.totalAbstain,
                summary: data.payload.summary,
              },
            };

          case "error":
            if (data.payload.fatal) {
              console.error("[Council] Fatal error from server:", data.payload.message);
              return { ...prev, phase: "error", error: data.payload.message };
            }
            console.warn("[Council] Agent error:", data.payload.agentId, data.payload.message);
            return {
              ...prev,
              agents: prev.agents.map(a =>
                a.id === data.payload.agentId
                  ? { ...a, status: "error" as const }
                  : a
              ),
            };

          default:
            return prev;
        }
      });
    };

    es.onerror = () => {
      es.close();
      setState(prev => {
        if (prev.phase === "complete" || prev.phase === "cached") {
          return prev; // SSE closed normally after result
        }
        console.error("[Council] SSE connection dropped (phase was:", prev.phase, ")");
        return { ...prev, phase: "error", error: "Connection lost" };
      });
    };
  }, []);

  const start = useCallback(() => {
    if (!intentId) return;

    setState({ ...initialState, phase: "connecting" });

    const url = `${API_BASE}/api/council/deliberate?intentId=${intentId}`;
    console.log("[Council] Connecting →", url);

    console.log("[Council] Opening SSE...");
    const es = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = es;
    openEventSource(es);
  }, [intentId, openEventSource]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  return { state, start, isRunning: state.phase === "deliberating" || state.phase === "voting" };
}
