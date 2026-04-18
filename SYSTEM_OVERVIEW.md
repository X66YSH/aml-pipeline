# S2A Platform — Complete System Overview
## Signal-to-Action: Agentic LLM Architecture for AML Detection

*A deep dive into the architecture, agents, and design decisions behind S2A. For setup and quick start, see the [main README](README.md).*

---

## 1. What This System Does (One Sentence)

**Regulatory text → 6 AI agents autonomously compile it into executable detection features → Isolation Forest flags suspicious accounts → RCC Verifier traces each alert back to the original regulation.**

This is the implementation of Phume Ngam's paper: *"Regulation In, Regulation Out: An Agentic LLM Architecture for AML"*.

---

## 2. The Problem It Solves

Traditional AML feature engineering:
- Takes **6-12 months** from regulatory guidance to deployed detection
- Relies on scarce experts who understand BOTH compliance AND data schemas
- Creates **traceability gaps** — when auditors ask "why did you build this feature?", teams can't trace back to the regulation
- Is **inconsistent** — 3 analysts reading the same regulation produce 3 different implementations
- Is **not schema-portable** — a feature built for one database schema doesn't work on another

## 3. The Architecture: 6 Named Agents

Each agent follows a **Perceive → Reason → Act (PRA)** loop, producing structured, auditable output at every step.

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ ① Regulatory│    │ ② Schema    │    │ ③ Feature   │    │ ④ Deterministic│  │ ⑤ Anomaly   │    │ ⑥ RCC       │
│   Analyst   │───▶│   Adapter   │───▶│   Engineer  │───▶│   Validator   │──▶│  Detection  │───▶│  Verifier   │
│             │    │             │    │             │    │              │   │             │    │             │
│ Reads law   │    │ Maps to     │    │ Generates   │    │ AST safety + │   │ Isolation   │    │ "Regulation │
│ Extracts    │    │ schema      │    │ Python code │    │ Column check  │   │ Forest      │    │  Out"       │
│ indicators  │    │ columns     │    │             │    │ KS/IV stats   │   │             │    │ Verdict +   │
│             │    │             │    │             │    │              │   │             │    │ Evidence    │
└─────────────┘    └─────────────┘    └─────────────┘    └──────┬───────┘   └─────────────┘    └─────────────┘
                                                                │
                                                    ┌───────────┴───────────┐
                                                    │   Self-Correction     │
                                                    │   + Human-in-the-Loop │
                                                    │   Decision Points     │
                                                    └───────────────────────┘
```

### Agent 1: Regulatory Analyst (LLM — GPT-4o)
- **Input**: Raw regulatory text (e.g., FINTRAC operational alert)
- **PRA Output**:
  - **Perceive**: "I received a FINTRAC alert about casino-related underground banking..."
  - **Reason**: "This describes structuring behavior. I chose this over 'layering' because..."
  - **Act**: Structured indicator (category, risk_rationale), parameters (thresholds with regulatory basis), computation plan
- **Ontology**: 20 predefined categories (structuring, layering, geographic_risk, velocity_anomaly, etc.)
- **Allowed Operations**: count, sum, mean, std, ratio, entropy, distinct_count, coefficient_of_variation, etc.

### Agent 2: Schema Adapter (LLM — GPT-4o)
- **Input**: Indicator + target database schema
- **PRA Output**:
  - **Perceive**: "The indicator needs country columns. I'm evaluating 7 FINTRAC channels..."
  - **Reason**: "Card channel has country directly. EFT lacks it — proxy via amount patterns..."
  - **Act**: Per-channel status (direct_match / proxy_required / not_feasible)
- **Key capability**: Same regulation → different code on different schemas (FINTRAC 7-channel vs IBM AML single-table)
- **This is the "schema-adaptive compilation" from the paper**

### Agent 3: Feature Engineer (LLM — GPT-4o)
- **Input**: Indicator + adapted schema requirements
- **Output**: Python `compute_feature(df, accounts_df=None)` function
- **Code includes PRA comments**:
  ```python
  # PERCEIVE: The indicator focuses on structuring via sub-threshold cash deposits...
  # REASON: COUNT is better than SUM because structuring is about frequency, not volume...
  def compute_feature(df, accounts_df=None):
      threshold = 10000  # Regulatory basis: CTR reporting threshold
      ...
  ```

### Agent 4: Deterministic Validator (NOT LLM — pure code)
- **AST Safety**: Banned imports (os, sys, subprocess), banned calls (eval, exec, open), file I/O, network calls
- **Column Alignment**: Checks if referenced columns exist in the target schema
- **Statistical Validation**: KS statistic, Information Value (IV) — measures feature's discriminatory power
- **Self-Correction Loop**: Up to 5 automatic iterations (error → LLM fix → re-validate)
- **Human-in-the-Loop Decision Points**:
  - Column not found → options: Find Similar / Rethink Approach / Skip
  - IV too low → Diagnostic Agent analyzes root cause → options: Rethink Indicator / Adaptation / Code / Continue with Benchmarks / Stop
  - Options narrow after each attempt (tried options removed)

### Agent 5: Anomaly Detection (Isolation Forest — scikit-learn)
- **Model**: Isolation Forest (paper standard unsupervised method)
- **Features**: 10 benchmark (domain-agnostic statistical) + N compiled (regulation-driven)
- **Split**: 70/30 stratified train/test
- **Threshold**: Fixed top-100 accounts flagged
- **Metrics**: AUC-ROC, Precision@K, Recall@K, F1, Confusion Matrix, ROC Curve
- **Feature Importance**: Available for model interpretation
- **Current results on IBM AML**: AUC ~90-91.5%

### Agent 6: RCC Verifier — Regulatory Consistency Checker (LLM — GPT-4o)
- **This is the "Regulation Out" half of the closed loop**
- **Input**: Flagged customer's feature values + the SAME regulatory text that compiled the feature
- **Output**: Structured verdict:
  ```json
  {
    "verdict": "supported" | "contradicted" | "ambiguous",
    "confidence": "high" | "medium" | "low",
    "evidence": [{
      "feature": "structuring_count",
      "customer_value": 15,
      "population_mean": 2.3,
      "regulatory_criterion": "transactions structured to avoid reporting thresholds",
      "quoted_text": "Multiple cash deposits... each slightly below $10,000...",
      "assessment": "Customer has 15 sub-threshold transactions vs mean 2.3..."
    }]
  }
  ```
- **Closed Loop**: Regulation In (compiles features) → Regulation Out (verifies alerts against same regulation)

---

## 4. Key Technical Concepts

### 4.1 Regulatory Feature Specification (RFS)
The structured intermediate artifact: `(b, f, D, P, V)` where:
- **b**: Normalized behavioral indicator (from ontology)
- **f**: Deterministic feature function (`compute_feature()`)
- **D**: Data requirements (columns, JOINs, schema adaptation)
- **P**: Provenance (document ID, quoted regulatory text)
- **V**: Validation evidence (KS, IV, empirical stats)

### 4.2 Neuro-Symbolic Detection
- **Symbolic**: Regulation provides the specification (what to look for)
- **Neural**: LLM compiles it into code (how to compute it)
- **Statistical**: Isolation Forest ranks accounts (who is suspicious)
- **Symbolic again**: RCC verifies alerts against the original regulation

### 4.3 Self-Correction with Try → Fail → Fix Traces
- Agent generates code → Validator rejects (e.g., column 'Amount' not found)
- Error message + schema fed back to agent
- Agent adapts: discovers correct column name ('Amount Paid')
- Produces auditable correction trace

### 4.4 Information Value (IV) — Feature Quality Metric
```
IV = Σ (% of events_i - % of non-events_i) × ln(% of events_i / % of non-events_i)
```
- < 0.02: Not predictive → triggers feedback loop
- 0.02–0.1: Weak
- 0.1–0.3: Medium
- 0.3–0.5: Strong
- \> 0.5: Very strong (check for overfitting)

### 4.5 Kolmogorov-Smirnov (KS) Statistic
Maximum distance between CDFs of positive (suspicious) vs negative (normal) groups.
- 0 = identical distributions
- 1 = perfect separation

### 4.6 Isolation Forest
Unsupervised anomaly detection. Key insight: anomalies are "few and different" — they require fewer random splits to isolate.
- No labels needed for training (truly unsupervised)
- Labels used only for evaluation (AUC-ROC, P@K)
- `contamination` parameter set from empirical positive rate

### 4.7 Schema-Adaptive Compilation
Same FFIEC regulation "transactions involving financial secrecy havens":
- **FINTRAC schema**: `df[df['country'].isin(high_risk_list)]` (direct column)
- **IBM AML schema**: JOIN accounts → parse Bank Name → extract country → filter (multi-step)
- The Schema Adapter agent autonomously discovers the correct approach for each schema

---

## 5. Datasets

### IBM AML HI-Small (Primary — used for demo)
- **5,078,415 transactions**, 496,995 unique sender accounts
- **3,376 positive accounts** (0.68% — money laundering)
- Pre-merged single table with:
  - Sender/Receiver Account, Bank ID, Bank Name
  - Sender/Receiver Country (parsed from Bank Name)
  - Amount Paid/Received, Currency, Payment Format
  - `Is Laundering` label (binary)
- Source: IBM AMLSim synthetic benchmark (Kaggle)

### FINTRAC (Secondary — 7-channel Canadian banking)
- 7 channels: Card (3.5M), EFT (1.1M), EMT (846K), Cheque (241K), ABM (186K), Wire (5K), Western Union (2K)
- 1,000 labeled customers, 10 positive (too few for meaningful detection)
- Shows multi-channel schema adaptation capability

---

## 6. Benchmark Features (Domain-Agnostic Statistical)

10 features that require NO regulatory knowledge — pure statistics:

| # | Name | What it computes | Category |
|---|------|-----------------|----------|
| 1 | total_amount | Sum of Amount Paid per account | amount_anomaly |
| 2 | txn_count | Transaction count per account | velocity_anomaly |
| 3 | amount_std | Std dev of amounts | amount_anomaly |
| 4 | unique_counterparties | Unique receivers per sender | network_anomaly |
| 5 | temporal_spread | Days between first and last txn | temporal_anomaly |
| 6 | non_self_transfer_ratio | % of non-self transfers (key signal: normal=59%, laundering=0.5%) | behavioral_change |
| 7 | ach_ratio | % of ACH transactions (laundering=85% ACH) | layering |
| 8 | foreign_txn_ratio | % cross-border transactions | geographic_risk |
| 9 | median_amount | Median transaction amount (laundering 5x higher) | amount_anomaly |
| 10 | payment_diversity | Shannon entropy of payment formats | behavioral_change |

**Purpose**: Establish a baseline. When regulation-compiled features are added on top, the delta shows the value of "Regulation In".

---

## 7. Demo Flow (10-15 minutes)

### Run 1: "Iran is a high-risk country" → Self-Correction Demo
1. Paste simple text → Analyst extracts geographic_risk
2. Engineer generates code → Validator passes AST but IV=0
3. **Diagnostic Agent** analyzes: "Iran transactions too rare in dataset"
4. **Human decision**: Rethink Indicator → Rethink Adaptation → Rethink Code → Continue with Benchmarks
5. Detection runs with 10 benchmark features → AUC ~90%
6. **Story**: "The system tries 3 different agents, diagnoses failures, and falls back gracefully"

### Run 2: Real FINTRAC Document → Full Pipeline
1. Select a FINTRAC operational alert (e.g., Professional Money Laundering)
2. 6 agents work in sequence → compiled feature passes validation
3. Detection runs with 10 benchmark + 1 compiled = 11 features → AUC ~91.5%
4. **Compare**: baseline 90% → with regulation feature 91.5%
5. Open RCC tab → verdict + evidence + regulatory citations
6. **Story**: "Regulation In → detection → Regulation Out. Full traceability."

---

## 8. Tech Stack

- **Backend**: Python 3.13, FastAPI, uvicorn, SQLite + SQLAlchemy 2.0
- **Frontend**: React + Vite + TypeScript + Tailwind CSS + Framer Motion + Recharts
- **LLM**: OpenAI GPT-4o (AsyncOpenAI, temperature=0)
- **ML**: scikit-learn (IsolationForest, StandardScaler, train_test_split)
- **Stats**: scipy (KS test), numpy (IV calculation)
- **SSE**: Server-Sent Events for real-time pipeline streaming

---

## 9. Paper Alignment

| Paper Concept | Our Implementation |
|--------------|-------------------|
| Regulatory Analyst Agent | Tab 1: Perceive-Reason-Act on regulatory text |
| Schema Adapter Agent | Tab 2: Per-channel/table compatibility analysis |
| Feature Engineer Agent | Tab 3: Python code generation with PRA comments |
| Deterministic Validator | Tab 4: AST + column + KS/IV validation |
| Self-Correction Loop | Validator → Engineer retry (up to 5 iterations) |
| Human-in-the-Loop | Decision points with Diagnostic Agent recommendations |
| Isolation Forest Detection | Tab 5: Paper-standard unsupervised method |
| RCC Verifier | Tab 6: Verdict + evidence + regulatory citations |
| Schema-Adaptive Compilation | FINTRAC (7-channel) vs IBM AML (single-table) |
| Regulatory Feature Specification | FeatureContext model with provenance |
| Closed-Loop Grounding | Same regulatory text used for compilation AND verification |

---

## 10. Key Results

- **Compilation**: 6-agent pipeline compiles regulatory text to executable feature in ~2-3 minutes
- **Self-Correction**: Automatic retry + human decision points when needed
- **Detection**: AUC-ROC 90-91.5% on IBM AML benchmark
- **Traceability**: Every alert traces to regulatory text via RCC verification
- **Schema Portability**: Same regulation compiles differently for different schemas

---

## 11. Glossary of Technical Terms

- **Agentic AI Architecture** — specialized LLM agents with defined roles
- **Perceive-Reason-Act Loop** — structured reasoning framework per agent
- **Neuro-Symbolic Detection** — symbolic (regulation) + neural (LLM) + statistical (IF)
- **Regulatory Feature Specification (RFS)** — formal intermediate representation
- **Closed-Loop Grounding** — same source text for compilation AND verification
- **Schema-Adaptive Compilation** — automatic schema discovery and adaptation
- **Deterministic Acceptance Boundaries** — LLMs propose, deterministic code validates
- **Information Value (IV)** — credit scoring metric for feature quality
- **Kolmogorov-Smirnov Statistic** — distribution divergence measure
- **Isolation Forest** — Liu et al. 2008, anomaly detection via random partitioning
- **Contamination Parameter** — empirical positive rate for IF calibration
- **Stratified Train/Test Split** — preserves class ratio in both sets
- **Human-in-the-Loop Governance** — LLMs as proposers, humans as decision-makers
