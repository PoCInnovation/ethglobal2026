Plan final — Council AI Deliberation
Architecture

User ouvre /pay/$intentId (Polymarket trade)
    ↓
CouncilDeliberation component (auto-démarre)
    ↓ SSE stream
GET /api/council/deliberate?intentId=xxx
    ↓
Handler brut (pas de methodRouter)
    ├── requireSession (cookie auth)
    ├── Lit l'intent en DB → vérifie ownership
    ├── Check cache : intent.council_result existe ?
    │   ├── OUI → emit cached result, close
    │   └── NON → lance la délibération ↓
    ├── Rate limit (3/intent, 10/user/heure)
    ├── AbortController (cleanup on client disconnect)
    ├── Round 1 : chaque agent analyse (séquentiel, streaming)
    ├── Round 2 : chaque agent réagit aux autres (séquentiel, streaming)
    ├── Vote : regex tolérant + micro-appel fallback si échec
    ├── Sauvegarde council_result dans l'intent (JSONB)
    └── emit: council_result, close
Fichiers à créer (7 fichiers)
1. apps/web/api/_lib/councilConfig.ts (nouveau)
Configuration centrale — le seul fichier à éditer pour paramétrer le conseil.


export interface CouncilAgentConfig {
  id: string;          // "bull", "bear", "quant"
  name: string;        // "Alex", "Sam", "Morgan"
  role: string;        // "Bullish Analyst", "Risk Manager", "Quant Strategist"
  avatar: string;      // "📈", "🛡️", "🔢"
  systemPrompt: string; // Personnalité complète de l'agent
  memory?: string;      // Contexte persistant (historique, biais, calibration)
}

export const COUNCIL_AGENTS: CouncilAgentConfig[] = [
  { id: "bull",  name: "Alex",   role: "Bullish Analyst",        avatar: "📈", systemPrompt: "...", memory: "..." },
  { id: "bear",  name: "Sam",    role: "Risk Manager",           avatar: "🛡️", systemPrompt: "...", memory: "..." },
  { id: "quant", name: "Morgan", role: "Quantitative Strategist", avatar: "🔢", systemPrompt: "...", memory: "..." },
];

export const COUNCIL_DISCUSSION_ROUNDS = 2;
export const COUNCIL_APPROVAL_THRESHOLD = 0.5;  // >50% = approved
export const COUNCIL_MODEL = "claude-sonnet-4-6";
export const COUNCIL_MAX_TOKENS = 300;           // par réponse d'agent
export const COUNCIL_VOTE_MAX_TOKENS = 5;        // pour le micro-appel de vote fallback
Chaque agent a son propre systemPrompt et memory. Pour modifier le comportement d'un agent, on édite ce fichier uniquement :

systemPrompt : définit la personnalité, le style de raisonnement, les critères de décision
memory : injecte du contexte persistant (passé de l'agent, biais connus, seuils de risque)
2. apps/web/api/_lib/councilTypes.ts (nouveau)
Types partagés entre l'orchestrateur et l'endpoint SSE (backend only).


// --- Events SSE émis vers le client ---

export type CouncilEventType =
  | "council_started"   // Délibération lancée, liste des agents
  | "agent_thinking"    // Un agent commence à réfléchir
  | "agent_token"       // Token individuel (streaming)
  | "agent_message"     // Message complet d'un agent (fin de son tour)
  | "agent_vote"        // Vote d'un agent
  | "council_result"    // Résultat final du vote
  | "council_cached"    // Résultat provenant du cache
  | "error";            // Erreur (agent ou global)

export interface CouncilEvent {
  type: CouncilEventType;
  payload: Record<string, unknown>;
}

// --- Types d'état internes ---

export type AgentVote = "FOR" | "AGAINST" | "ABSTAIN";

export interface AgentDeliberationResult {
  agentId: string;
  agentName: string;
  role: string;
  avatar: string;
  rounds: string[];       // Messages par round
  vote: AgentVote;
  error?: string;         // Si l'agent a échoué
}

export interface CouncilResult {
  approved: boolean;
  votes: Record<string, AgentVote>;  // agentId → vote
  ratio: number;                      // e.g. 0.67
  totalFor: number;
  totalAgainst: number;
  totalAbstain: number;
  agents: AgentDeliberationResult[];
  deliberatedAt: string;              // ISO timestamp
}
3. apps/web/api/_lib/councilOrchestrator.ts (nouveau)
Le moteur de délibération. Gère les rounds, le streaming, le vote.


import Anthropic from "@anthropic-ai/sdk";
import { COUNCIL_AGENTS, COUNCIL_DISCUSSION_ROUNDS, COUNCIL_MODEL, 
         COUNCIL_MAX_TOKENS, COUNCIL_VOTE_MAX_TOKENS } from "./councilConfig.js";
import type { CouncilEvent, CouncilResult, AgentVote, AgentDeliberationResult } from "./councilTypes.js";

interface MarketContext {
  marketTitle: string;
  conditionId: string;
  outcome: "Yes" | "No";
  amount: string;
  outcomePrice?: number;
}

type EventEmitter = (event: CouncilEvent) => void;

export async function runCouncilDeliberation(
  market: MarketContext,
  emit: EventEmitter,
  signal: AbortSignal
): Promise<CouncilResult>
Logique interne :


1. emit("council_started", { agents: [...ids/names/roles/avatars] })

2. Pour chaque round (1 → COUNCIL_DISCUSSION_ROUNDS) :
   Pour chaque agent (séquentiel) :
     a. emit("agent_thinking", { agentId, round })
     b. Construire les messages :
        - system: agent.systemPrompt + "\n\nMEMORY:\n" + agent.memory
        - user: [round 1] "Analyse ce trade: {marketTitle}, outcome {outcome} 
                 au prix de {outcomePrice}, montant {amount} USDC"
                [round 2+] "Voici les analyses des autres agents:\n{messages round précédent}\n
                 Réagis à leurs arguments."
     c. Stream Claude API avec signal (abort si client déconnecte)
        - Pour chaque token → emit("agent_token", { agentId, token, round })
     d. emit("agent_message", { agentId, content: fullMessage, round })
     e. Stocker le message dans conversationHistory[agentId][round]
     
     Si signal.aborted → throw AbortError

3. Phase de vote :
   Pour chaque agent :
     a. Parser le vote du dernier message (regex: /\bVOTE:\s*(FOR|AGAINST)\b/i)
     b. Si parsing échoue → micro-appel fallback :
        system: "You just provided this analysis: {lastMessage}"
        user: "Cast your vote. Respond with ONLY one word: FOR or AGAINST"
        max_tokens: 5
     c. Si fallback échoue aussi → vote = "ABSTAIN"
     d. emit("agent_vote", { agentId, vote })

4. Calcul du résultat :
   - totalFor = nombre de "FOR"
   - totalAgainst = nombre de "AGAINST"  
   - totalAbstain = nombre de "ABSTAIN"
   - votingAgents = totalFor + totalAgainst (abstentions ne comptent pas)
   - ratio = votingAgents > 0 ? totalFor / votingAgents : 0
   - approved = ratio > COUNCIL_APPROVAL_THRESHOLD

5. emit("council_result", result)
6. return result
Gestion d'erreur par agent : Si un appel Claude échoue pour un agent (rate limit, timeout, erreur réseau) :

emit("error", { agentId, message: "..." })
L'agent vote ABSTAIN
Le conseil continue avec les agents restants
Si tous les agents échouent → emit("error", { fatal: true, message: "..." })
4. apps/web/api/council/deliberate.ts (nouveau)
Endpoint SSE — handler brut, pas de methodRouter.


import type { VercelRequest, VercelResponse } from "@vercel/node";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // 1. Méthode GET uniquement
  if (req.method === "OPTIONS") { setCorsHeaders(res, req); res.status(200).end(); return; }
  if (req.method !== "GET") { res.status(405).end(); return; }

  // 2. CORS headers
  setCorsHeaders(res, req);

  // 3. Auth via cookie session
  let session;
  try { session = await requireSession(req); }
  catch { res.status(401).json({ error: "Unauthorized" }); return; }

  // 4. Lire intentId depuis query params
  const intentId = getQueryParam(req, "intentId");
  if (!intentId) { res.status(400).json({ error: "Missing intentId" }); return; }

  // 5. Lire l'intent en DB, vérifier ownership
  const intent = await getIntentById(intentId);
  if (!intent || intent.userId !== session.walletAddress) {
    res.status(404).json({ error: "Intent not found" }); return;
  }
  if (intent.details.type !== "polymarket_trade") {
    res.status(400).json({ error: "Not a Polymarket trade" }); return;
  }

  // 6. Check cache : si council_result existe déjà
  if (intent.details.councilResult) {
    // Retourner le résultat caché en SSE rapide
    res.writeHead(200, sseHeaders);
    res.write(sseEvent("council_cached", intent.details.councilResult));
    res.end();
    return;
  }

  // 7. Rate limit (simple: vérifier nombre de deliberations récentes)
  //    Max 3 par intent (stocké), max 10 par user par heure (in-memory ou DB)

  // 8. Setup SSE
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",   // Désactive le buffering nginx/proxy
  });

  // 9. AbortController pour cleanup
  const abort = new AbortController();
  res.on("close", () => abort.abort());

  // 10. Lancer la délibération
  const emit = (event: CouncilEvent) => {
    if (!res.closed) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  };

  try {
    const result = await runCouncilDeliberation(
      {
        marketTitle: intent.details.marketTitle,
        conditionId: intent.details.conditionId,
        outcome: intent.details.outcome,
        amount: intent.details.amount,
        outcomePrice: intent.details.outcomePrice,
      },
      emit,
      abort.signal,
    );

    // 11. Sauvegarder le résultat dans l'intent
    await saveCouncilResult(intentId, result);

  } catch (err) {
    if (!abort.signal.aborted) {
      emit({ type: "error", payload: { fatal: true, message: String(err) } });
    }
  }

  // 12. Fermer la connexion SSE
  res.end();
}
5. apps/web/src/lib/councilTypes.ts (nouveau)
Types frontend (miroir des types backend, côté client).


export type AgentVote = "FOR" | "AGAINST" | "ABSTAIN";

export type CouncilPhase =
  | "idle"
  | "connecting"
  | "deliberating"
  | "voting"
  | "complete"
  | "error"
  | "cached";

export interface AgentState {
  id: string;
  name: string;
  role: string;
  avatar: string;
  status: "waiting" | "thinking" | "done" | "error";
  messages: { round: number; content: string }[];
  currentStreamContent: string;  // tokens en cours de streaming
  vote?: AgentVote;
}

export interface CouncilState {
  phase: CouncilPhase;
  agents: AgentState[];
  currentRound: number;
  result?: {
    approved: boolean;
    ratio: number;
    totalFor: number;
    totalAgainst: number;
    totalAbstain: number;
  };
  error?: string;
}
6. apps/web/src/hooks/useCouncilDeliberation.ts (nouveau)
Hook React qui consomme le SSE et reconstruit l'état.


export function useCouncilDeliberation(intentId: string | null) {
  const [state, setState] = useState<CouncilState>(initialState);
  const eventSourceRef = useRef<EventSource | null>(null);
  
  const start = useCallback(() => {
    if (!intentId) return;
    
    const es = new EventSource(`/api/council/deliberate?intentId=${intentId}`);
    eventSourceRef.current = es;
    
    es.onmessage = (event) => {
      const data = JSON.parse(event.data) as CouncilEvent;
      
      setState(prev => {
        switch (data.type) {
          case "council_started":
            // Initialiser les agents depuis le payload
          case "agent_thinking":
            // Marquer l'agent comme "thinking"
          case "agent_token":
            // Append token à currentStreamContent
          case "agent_message":
            // Finaliser le message, reset stream
          case "agent_vote":
            // Stocker le vote
          case "council_result":
            // Phase = complete, stocker résultat
          case "council_cached":
            // Phase = cached, restaurer résultat complet
          case "error":
            // Gérer erreur (agent ou fatal)
        }
      });
    };
    
    es.onerror = () => {
      es.close();
      setState(prev => 
        prev.phase === "complete" || prev.phase === "cached"
          ? prev  // SSE fermé normalement après résultat
          : { ...prev, phase: "error", error: "Connection lost" }
      );
    };
  }, [intentId]);
  
  // Cleanup on unmount
  useEffect(() => {
    return () => eventSourceRef.current?.close();
  }, []);
  
  return { state, start, isRunning: state.phase === "deliberating" || state.phase === "voting" };
}
Point important sur es.onerror : EventSource appelle onerror aussi quand la connexion se ferme normalement (le serveur fait res.end()). Le hook doit distinguer "erreur réelle" de "fin normale". La logique : si phase est déjà complete ou cached quand onerror fire, c'est une fermeture normale.

7. apps/web/src/components/council/CouncilDeliberation.tsx (nouveau)
Composant principal.


Props: { intentId: string, onComplete: (result) => void }
Layout :


┌────────────────────────────────────────────────────┐
│  🏛️  AI Council Deliberation                       │
│  "Should we take this position?"                   │
│                                                    │
│  Market: Will ETH reach $5k by Dec 2025?           │
│  Position: Yes @ 65% — 50 USDC                     │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ 📈 Alex — Bullish Analyst         Round 1    │  │
│  │ The market is currently pricing Yes at 65%,  │  │
│  │ which I believe undervalues the true prob... │  │
│  │ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │  │
│  │ 📈 Alex — Round 2                           │  │
│  │ Sam raises valid points about tail risk,     │  │
│  │ but the momentum signals are too strong...   │  │
│  │                                    ✅ FOR     │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ 🛡️ Sam — Risk Manager              Round 1   │  │
│  │ ● ● ● (thinking animation...)                │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
│  ┌──────────────────────────────────────────────┐  │
│  │ 🔢 Morgan — Quant Strategist                 │  │
│  │ (waiting...)                                  │  │
│  └──────────────────────────────────────────────┘  │
│                                                    │
├────────────────────────────────────────────────────┤
│  [Phase finale, après tous les votes]              │
│                                                    │
│  ✅ TRADE APPROVED — 2/3 voted FOR (67%)          │
│  ou                                                │
│  ❌ TRADE REJECTED — 1/3 voted FOR (33%)          │
└────────────────────────────────────────────────────┘
Sous-composant AgentCard : Un composant interne qui affiche un agent avec :

Header : avatar + nom + rôle
Body : messages par round (avec séparateur visuel entre rounds)
Token streaming : animation de texte qui apparaît progressivement
Thinking : indicateur animé (3 dots pulsating)
Vote badge : Tag vert (FOR) / rouge (AGAINST) / gris (ABSTAIN)
Fichier à modifier (2 fichiers)
8. apps/web/api/_lib/env.ts (modifier)
Ajouter la validation de ANTHROPIC_API_KEY :


const envSchema = z.object({
  POSTGRES_URL: z.string().min(1),
  CRON_SECRET: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional().default(""),
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),  // ← AJOUT
});
Et l'exposer dans getEnv().

9. apps/web/src/routes/pay.$intentId.tsx (modifier)
Intégrer le composant de délibération quand l'intent est un Polymarket trade.

Changements :

Importer CouncilDeliberation et useCouncilDeliberation
Détecter isPolymarket (déjà fait)
Si Polymarket + pending → afficher <CouncilDeliberation> au-dessus des boutons d'action
Le hook se lance automatiquement quand le composant monte
Le résultat du conseil est passé en callback onComplete
Le bouton "Signer sur Ledger" :
Pendant la délibération : grisé, label "Council is deliberating..."
Si approuvé : couleur verte, badge ✅
Si rejeté : couleur orange, badge ⚠️ + tooltip "Le conseil recommande de ne pas trader"
Toujours cliquable après la fin de la délibération (l'humain reste souverain)
Flow SSE complet

Client                              Server
  |                                   |
  | GET /api/council/deliberate       |
  |   ?intentId=int_1234             |
  |──────────────────────────────────▶|
  |                                   | requireSession (cookie)
  |                                   | SELECT intent FROM intents
  |                                   | intent.councilResult? → non
  |                                   | rate limit check → OK
  |                                   |
  |◀── council_started ──────────────| { agents: [{id,name,role,avatar},...] }
  |                                   |
  |  ──── ROUND 1 ────               |
  |◀── agent_thinking ───────────────| { agentId: "bull", round: 1 }
  |◀── agent_token ──────────────────| { agentId: "bull", token: "The " }
  |◀── agent_token ──────────────────| { agentId: "bull", token: "market" }
  |◀── ... (streaming) ─────────────|
  |◀── agent_message ────────────────| { agentId: "bull", content: "The market...", round: 1 }
  |                                   |
  |◀── agent_thinking ───────────────| { agentId: "bear", round: 1 }
  |◀── ... (streaming) ─────────────|
  |◀── agent_message ────────────────| { agentId: "bear", content: "I see risk...", round: 1 }
  |                                   |
  |◀── agent_thinking ───────────────| { agentId: "quant", round: 1 }
  |◀── ... (streaming) ─────────────|
  |◀── agent_message ────────────────| { agentId: "quant", content: "EV calc...", round: 1 }
  |                                   |
  |  ──── ROUND 2 ────               |
  |◀── agent_thinking ───────────────| { agentId: "bull", round: 2 }
  |◀── ... (streaming) ─────────────|
  |◀── agent_message ────────────────| { agentId: "bull", content: "Responding to Sam...", round: 2 }
  |                                   |
  |◀── agent_thinking ───────────────| { agentId: "bear", round: 2 }
  |◀── ... (streaming) ─────────────|
  |◀── agent_message ────────────────| { agentId: "bear", content: "Alex overlooks...", round: 2 }
  |                                   |
  |◀── agent_thinking ───────────────| { agentId: "quant", round: 2 }
  |◀── ... (streaming) ─────────────|
  |◀── agent_message ────────────────| { agentId: "quant", content: "Final EV...", round: 2 }
  |                                   |
  |  ──── VOTES ────                  |
  |◀── agent_vote ───────────────────| { agentId: "bull", vote: "FOR" }
  |◀── agent_vote ───────────────────| { agentId: "bear", vote: "AGAINST" }
  |◀── agent_vote ───────────────────| { agentId: "quant", vote: "FOR" }
  |                                   |
  |◀── council_result ───────────────| { approved: true, ratio: 0.67, ... }
  |                                   |
  |                                   | UPDATE intents SET details.councilResult = ...
  |                                   |
  [connexion SSE fermée]              | res.end()
Cas cached (refresh de page) :


Client                              Server
  |                                   |
  | GET /api/council/deliberate       |
  |   ?intentId=int_1234             |
  |──────────────────────────────────▶|
  |                                   | intent.councilResult? → OUI
  |◀── council_cached ──────────────| { ...résultat complet + messages agents }
  [connexion fermée immédiatement]
Résumé des dépendances
Dépendance	Déjà installée ?	Action
@anthropic-ai/sdk	✅ (vient d'être ajouté)	—
ANTHROPIC_API_KEY env var	❌	Ajouter dans Vercel + .env.local
Migration DB (colonne council_result)	❌	Stocker dans details JSONB (pas de migration)
Note sur le stockage : Le champ details est déjà JSONB dans la table intents. On peut y ajouter councilResult sans migration SQL. Le type PolymarketTradeDetails sera étendu avec un champ optionnel councilResult?: CouncilResult.