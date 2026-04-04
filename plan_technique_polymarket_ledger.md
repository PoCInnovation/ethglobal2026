# Plan Technique : Agent IA Polymarket + Ledger Plugin + Chainlink CRE

## Objectif

Un **agent IA propose des positions sur des marchés Polymarket**. L'utilisateur **voit directement sur l'écran de sa Ledger** :
- Le **nom du marché** (ex: "Will Trump win 2024?")
- L'**outcome choisi** (YES / NO)
- Le **montant** (ex: 50 USDC)

Les titres de marchés (données off-chain) sont récupérés via **Chainlink CRE** et rendus disponibles on-chain. L'affichage sur la Ledger est réalisé via un **Ledger Ethereum Plugin custom** (pas un simple EIP-712).

---

## Analyse du repo ledger-agent-intents

### Fonctionnalités existantes

| Feature | Détail |
|---------|--------|
| **Intent Queue** | Agent IA propose des tx → humain review + signe sur Ledger |
| **Ledger DMK** | Connexion directe (USB/BLE) via Device Management Kit |
| **EIP-712 Signing** | Signature typed data pour auth + x402 payments |
| **EIP-3009** | TransferWithAuthorization pour USDC |
| **Agent Provisioning (LKRP)** | Clés agents secp256k1, auth `AgentAuth` header |
| **x402 Pay-Per-Call** | Protocole paiement APIs à la demande |
| **Web App** | React 19 + TanStack Router/Query + Tailwind |
| **Backend** | Express.js (dev) + Vercel Serverless (prod) + PostgreSQL (Neon) |
| **Status Lifecycle** | `pending → approved → authorized → executing → confirmed` |
| **Multi-chain** | Base, Base Sepolia, Sepolia |

### Ce qu'on ajoute

- Nouveau type d'intent : `polymarket_trade`
- **Ledger Ethereum Plugin** (C) pour clear signing des trades Polymarket
- **Smart contract intermédiaire** : encode les données Polymarket (titre + outcome + montant) pour que le plugin les parse
- **Workflow Chainlink CRE** : oracle on-chain des titres de marchés
- Extension de l'agent IA pour analyser et proposer des marchés

---

## Architecture globale

```
┌──────────────────────┐
│      Agent IA        │
│  (analyse marchés,   │
│   propose positions) │
└──────────┬───────────┘
           │ POST /api/intents { type: "polymarket_trade" }
           ▼
┌──────────────────────┐       ┌───────────────────────┐
│    Backend API       │◄──────│   Chainlink CRE       │
│                      │       │   Workflow DON         │
│  • Enrichit intent   │       │                       │
│    avec titre marché │       │  Gamma API → Consensus │
│    (lu depuis oracle)│       │  → Oracle Contract     │
└──────────┬───────────┘       └───────────────────────┘
           │
           ▼
┌──────────────────────┐
│      Web App         │
│  • Affiche intent    │
│  • User approuve     │
│  • Construit tx      │
│    vers PolyProxy    │
└──────────┬───────────┘
           │ tx calldata
           ▼
┌──────────────────────────────────────────┐
│          Ledger Device                    │
│  ┌────────────────────────────────────┐  │
│  │  Ethereum App + Plugin Custom      │  │
│  │                                    │  │
│  │  Plugin parse le calldata et       │  │
│  │  affiche sur l'écran :             │  │
│  │                                    │  │
│  │  ┌──────────────────────────────┐  │  │
│  │  │  Screen 1: Market            │  │  │
│  │  │  "Will Trump win 2024?"      │  │  │
│  │  ├──────────────────────────────┤  │  │
│  │  │  Screen 2: Outcome           │  │  │
│  │  │  "YES"                       │  │  │
│  │  ├──────────────────────────────┤  │  │
│  │  │  Screen 3: Amount            │  │  │
│  │  │  "50.00 USDC"               │  │  │
│  │  └──────────────────────────────┘  │  │
│  │                                    │  │
│  │    [✓ Confirm]    [✗ Reject]       │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
           │ signed tx
           ▼
┌──────────────────────┐
│  Polymarket CLOB     │
│  → Settlement via    │
│    CTF Exchange      │
│    (Polygon)         │
└──────────────────────┘
```

---

## Composant 1 : Ledger Ethereum Plugin (C)

### Concept

Le plugin est une application C légère qui **s'exécute aux côtés de l'app Ethereum native** de la Ledger. Quand l'utilisateur signe une transaction vers notre smart contract, l'app Ethereum délègue le parsing et l'affichage au plugin.

Le plugin **intercepte les appels** à notre smart contract "PolyProxy" et **affiche des infos lisibles** à la place du calldata brut.

### Architecture du plugin

```
                        ┌─────────────────────────┐
                        │   Transaction entrante   │
                        │   to: 0xPolyProxy        │
                        │   data: calldata         │
                        └────────────┬────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │     Ethereum App (Ledger)        │
                    │                                  │
                    │  Reconnaît le selector           │
                    │  → Délègue au plugin             │
                    └────────────────┬────────────────┘
                                     │
              ┌──────────────────────▼──────────────────────┐
              │              Plugin Custom (C)               │
              │                                              │
              │  handle_init_contract()                      │
              │    → Vérifie le selector de fonction          │
              │    → Initialise le contexte                   │
              │                                              │
              │  handle_provide_parameter() × N              │
              │    → Reçoit les params 32 bytes par 32 bytes │
              │    → Parse: market_title, outcome, amount    │
              │    → Stocke dans pluginContext                │
              │                                              │
              │  handle_finalize()                           │
              │    → Validation finale                        │
              │    → Déclare 3 écrans d'affichage            │
              │                                              │
              │  handle_query_contract_ui()                  │
              │    → Screen 0: title="Market"                │
              │                 msg="Will Trump win 2024?"   │
              │    → Screen 1: title="Outcome"               │
              │                 msg="YES"                    │
              │    → Screen 2: title="Amount"                │
              │                 msg="50.00 USDC"             │
              └──────────────────────────────────────────────┘
```

### Handlers détaillés

#### `handle_init_contract`
- Vérifie que le **function selector** (4 premiers bytes du calldata) correspond à notre fonction `placePolymarketOrder(bytes32,string,uint8,uint256)`
- Initialise la structure `pluginContext` qui persistera entre les handlers
- Set l'état initial du parsing

#### `handle_provide_parameter`
- Appelé **répétitivement** par l'app Ethereum (32 bytes à la fois)
- Parse séquentiellement :
  1. `conditionId` (bytes32) — ID du marché
  2. `marketTitle` (string) — offset → puis data dynamique
  3. `outcome` (uint8) — 0 = YES, 1 = NO
  4. `amount` (uint256) — montant en USDC (6 decimals)
- Stocke chaque valeur dans `pluginContext`

> [!WARNING]
> Les strings en Solidity sont encodées en ABI avec offset + length + data. Le parsing est plus complexe que pour les types fixes. Il faut gérer les offsets dynamiques et potentiellement tronquer le titre si il dépasse la mémoire du plugin.

#### `handle_finalize`
- Valide que tous les champs ont été parsés
- Déclare `numScreens = 3` (market, outcome, amount)
- Retourne `PLUGIN_RESULT_OK`

#### `handle_query_contract_ui`
- Selon le `screenIndex` :

| screenIndex | title | msg (exemple) |
|-------------|-------|---------------|
| 0 | `"Market"` | `"Will Trump win 2024?"` (tronqué si trop long) |
| 1 | `"Outcome"` | `"YES"` ou `"NO"` |
| 2 | `"Amount"` | `"50.00 USDC"` (formaté avec 6 decimals) |

### Structure du projet plugin

```
app-plugin-polymarket/
├── src/
│   ├── main.c                    # Entry point, dispatcher
│   ├── handle_init_contract.c    # Selector check + context init
│   ├── handle_provide_parameter.c # Parse calldata params
│   ├── handle_finalize.c         # Validation + screen count
│   ├── handle_query_contract_ui.c # Build display screens
│   ├── polymarket_plugin.h       # Context struct, constants
│   └── contract.c                # Selectors & contract addresses
├── tests/                        # Tests Ragger (Python)
│   ├── test_polymarket_order.py
│   └── snapshots/                # Screenshots attendus
├── ethereum-plugin-sdk/          # Git submodule
├── Makefile
├── PLUGIN_SPECIFICATION.md
└── ledger_app.toml
```

### Structure du contexte plugin

```c
// polymarket_plugin.h
#define MAX_MARKET_TITLE_LEN 64  // Limité par la RAM du device

typedef enum {
    OUTCOME_YES = 0,
    OUTCOME_NO = 1,
} outcome_t;

typedef struct {
    uint8_t condition_id[32];
    char market_title[MAX_MARKET_TITLE_LEN + 1];
    outcome_t outcome;
    uint8_t amount[32];  // uint256
    
    // Parsing state
    uint8_t next_param;
    uint16_t title_offset;
    uint16_t title_length;
    bool title_parsed;
} polymarket_context_t;
```

### Dev & Test

- **Build** : via le Makefile du boilerplate + Ledger SDK
- **Test local** : émulateur **Speculos** (simule Nano S/X/Stax/Flex)
- **Tests fonctionnels** : framework **Ragger** (Python) — compare les screenshots d'écran
- **IDE** : Extension VS Code Ledger recommandée

---

## Composant 2 : Smart Contract "PolyProxy"

### Pourquoi un contrat intermédiaire ?

Le plugin Ledger parse le **calldata** d'une transaction. Pour afficher le titre du marché en clair, ce titre doit être **dans le calldata** de la transaction que l'utilisateur signe. Or les ordres natifs Polymarket (envoyés au CLOB) ne contiennent pas le titre.

**Solution** : un smart contract intermédiaire "PolyProxy" qui :
1. Reçoit une transaction avec le titre + outcome + montant en clair (parsable par le plugin)
2. Construit et exécute l'interaction avec le CTF Exchange Polymarket en interne

### Interface du contrat

```
// Fonction appelée par l'utilisateur (signée sur Ledger)
function placePolymarketOrder(
    bytes32 conditionId,     // ID du marché
    string  marketTitle,     // "Will Trump win 2024?" — pour le plugin
    uint8   outcome,         // 0 = YES, 1 = NO
    uint256 amount           // montant USDC (6 decimals)
) external;
```

### Logique interne

1. **Vérifie le titre** : lit le contrat Oracle CRE pour confirmer que `marketTitle` correspond au `conditionId` → **pas de manipulation possible**
2. **Approve USDC** : transfert des USDC de l'utilisateur vers le contrat
3. **Interagit avec CTF/Exchange** : split, buy, ou place l'ordre selon la stratégie
4. **Émet un événement** : `OrderPlaced(conditionId, outcome, amount, user)`

### Sécurité

> [!CAUTION]
> Le `marketTitle` dans le calldata est là **uniquement pour l'affichage Ledger**. Le contrat DOIT vérifier sa cohérence on-chain via l'oracle CRE pour empêcher un affichage trompeur (ex: agent malveillant qui envoie un faux titre).

---

## Composant 3 : Workflow Chainlink CRE (Oracle de titres)

### Rôle
Récupérer les titres/métadonnées des marchés Polymarket (off-chain) et les stocker dans un contrat oracle on-chain via consensus BFT.

### Fonctionnement

```
Cron (toutes les 5-10 min)
   │
   ▼
HTTPClient → GET gamma-api.polymarket.com/markets
   │           (chaque nœud DON exécute indépendamment)
   ▼
Consensus BFT → agrégation des résultats
   │
   ▼
EVMClient.Write → PolymarketOracle.updateMarkets(data)
                   (écriture on-chain sur Polygon)
```

### Contrat Oracle

```
Mapping : conditionId (bytes32) → MarketInfo {
    question   (string)     // titre du marché
    outcomes   (string[2])  // ["Yes", "No"]
    endDate    (uint256)    // timestamp de fin
    active     (bool)       // marché ouvert ?
    lastUpdate (uint256)    // dernière mise à jour CRE
}
```

Le contrat `PolyProxy` lit ce mapping pour vérifier les titres lors du signing.

---

## Composant 4 : Nouveau type d'intent `polymarket_trade`

### Schema (extends shared types)

```
IntentDetails (type: "polymarket_trade") {
    conditionId: string      // bytes32, ID du marché
    marketTitle: string      // rempli par le backend via oracle CRE
    outcome: "Yes" | "No"    
    amount: string           // en USDC
    outcomePrice: number     // prix actuel (ex: 0.65)
    chainId: 137             // Polygon
    memo: string             // justification de l'agent
}
```

### Enrichissement backend

Quand un agent crée un intent `polymarket_trade` :
1. Backend lit le contrat Oracle CRE → récupère le `marketTitle` vérifié
2. Backend appelle la Gamma API → récupère le `outcomePrice` actuel
3. Valide que le marché est actif et pas expiré
4. Stocke l'intent enrichi en DB

> [!IMPORTANT]
> Le titre ne vient **jamais** directement de l'agent mais toujours de l'oracle CRE — on garantit ainsi que ce qui s'affiche sur la Ledger est authentique.

---

## Composant 5 : Agent IA + Extension CLI

### Nouvelles commandes

```bash
ledger-intent polymarket analyze         # Scan des marchés
ledger-intent polymarket buy YES <cid> 50 USDC  # Proposer un achat
ledger-intent polymarket list-markets    # Lister marchés actifs
```

### Rôle de l'agent
- Scanner les marchés Polymarket via la Gamma API  
- Analyser volume, liquidité, momentum  
- Proposer des positions via l'intent queue  
- Fournir un memo explicatif (justification)

---

## Flow complet de bout en bout

```
1. Agent IA → analyse marchés via Gamma API
   → Décide : "Acheter YES sur conditionId=0xabc... à 0.65"

2. Agent → POST /api/intents
   → { type: "polymarket_trade", conditionId: "0xabc...", outcome: "Yes", amount: "50" }

3. Backend → Lit Oracle CRE → enrichit avec marketTitle
   → Valide marché actif
   → Stocke intent (status: pending)

4. Utilisateur ouvre Web App
   → Voit : "Market: Will Trump win 2024? | YES à 0.65 | 50 USDC"
   → Justification agent : "High conviction based on polling data"
   → Approuve (status: approved)

5. Web App construit la tx
   → target: PolyProxy contract
   → calldata: placePolymarketOrder(conditionId, "Will Trump win ...", 0, 50e6)

6. Envoi à la Ledger via DMK
   → L'app Ethereum détecte le selector → délègue au Plugin
   → Le plugin parse le calldata
   → Affiche 3 écrans : Market / Outcome / Amount
   → Utilisateur confirme physiquement sur la Ledger

7. Transaction signée broadcast sur Polygon
   → PolyProxy vérifie le titre via Oracle CRE
   → PolyProxy exécute le trade via CTF Exchange
   → Tokens YES transférés à l'utilisateur

8. Backend update status → confirmed (avec txHash)
```

---

## Modifications par composant du repo

| Composant | Modifications |
|-----------|---------------|
| `packages/shared/` | Types `PolymarketTradeDetails`, constantes (adresses contrats, endpoints API) |
| `apps/backend/` | Handler `polymarket_trade`, service enrichissement Oracle CRE, validation marchés |
| `apps/web/` | Composant React pour afficher/approuver un intent Polymarket, flow de signing adapté |
| `apps/web/api/` | Mêmes mods que backend pour Vercel serverless, migration DB |
| `packages/skill/` | Commandes `polymarket analyze/buy/list-markets` |
| **Nouveau : `packages/cre-workflow/`** | Projet CRE TypeScript : fetch Gamma → consensus → write Oracle |
| **Nouveau : `contracts/`** | `PolymarketOracle.sol` + `PolyProxy.sol` |
| **Nouveau : `ledger-plugin/`** | Plugin C : parsing calldata + affichage custom 3 écrans |

---

## Défis techniques à anticiper

> [!WARNING]

1. **Parsing de strings dynamiques en C** — Les strings Solidity sont encodées avec offset/length. Le plugin doit gérer cet encodage ABI manuellement en C sur un device avec très peu de RAM (~4KB sur Nano S).

2. **Troncation du titre** — Les titres Polymarket peuvent être longs. Il faut tronquer intelligemment (ex: 64 chars max) et potentiellement scroller sur Nano S.

3. **Vérification on-chain du titre** — Le contrat PolyProxy doit comparer le titre soumis avec l'oracle, ce qui coûte du gas. Alternative : vérifier un hash du titre plutôt que la string complète.

4. **CRE Early Access** — Si pas d'accès au déploiement CRE, fallback possible : le backend fait l'enrichissement directement via la Gamma API (moins décentralisé mais fonctionnel pour le hackathon).

5. **Trading Polymarket on-chain** — Le trading natif passe par le CLOB (off-chain matching). Pour un flow 100% on-chain, il faudra potentiellement utiliser les fonctions split/merge du CTF plutôt que des ordres limites.

---

## Résumé des livrables hackathon

| Livrable | Technologie | Effort estimé |
|----------|------------|---------------|
| Ledger Plugin | C + Ethereum Plugin SDK | ⭐⭐⭐ (le plus complexe) |
| Smart Contracts (PolyProxy + Oracle) | Solidity | ⭐⭐ |
| Workflow CRE | TypeScript CRE SDK | ⭐⭐ |
| Backend (intents polymarket) | TypeScript (Express/Vercel) | ⭐ |
| Web App (UI polymarket) | React | ⭐ |
| Agent IA (analyse marchés) | TypeScript CLI | ⭐ |
