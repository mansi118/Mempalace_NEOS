# PALACE Benchmarking Plan — 10 Industry Benchmarks

**Goal:** Rate PALACE against established memory/retrieval benchmarks. All results reproducible from this repo.

**Baseline (LongMemEval-derived, already measured):**

| Mode | R@5 | LLM required |
|---|---|---|
| Raw semantic search | 96.6% | None |
| Hybrid v4 (tuned on 50 dev) | 98.4% | None |
| Hybrid v4 + LLM rerank | ≥99% | Any capable model |

**Critical caveat:** PALACE has 424 documents. Standard benchmarks test against 100K-8.8M docs. R@5 >95% on 424 docs is expected for any reasonable embedding. All metrics must report corpus size. For comparability, we either add synthetic distractors or run the embedding model independently on standard corpora.

---

## The 10 Benchmarks

### Tier 1 — Directly Applicable (adapt to PALACE corpus)

#### 1. LongMemEval — Long-Term Memory Retrieval

| | |
|---|---|
| **Paper** | arxiv.org/abs/2410.10813 (Di Wu et al., Oct 2024) |
| **Repo** | github.com/xiaowu0162/LongMemEval |
| **Measures** | 5 capabilities: information extraction, multi-session reasoning, temporal reasoning, knowledge updates, abstraction |
| **Dataset** | ~500 questions from synthetic multi-session conversations |
| **Primary metric** | Recall@5 per capability category |
| **PALACE adaptation** | Map sessions → closets. Use existing 424 closets. Generate questions requiring cross-wing retrieval. |
| **Expected difficulty** | LOW for single-fact (already 96.6%), MEDIUM for multi-session, HIGH for temporal (no temporal metadata) |
| **Status** | Baseline already measured |

**Run command:**
```bash
npx tsx benchmarks/run_longmemeval.ts --corpus palace --split test
```

---

#### 2. BEIR — Retrieval Quality Across Domains

| | |
|---|---|
| **Paper** | arxiv.org/abs/2104.08663 (Thakur et al., 2021) |
| **Repo** | github.com/beir-cellar/beir |
| **HuggingFace** | BeIR datasets (18 datasets, 9 domains) |
| **Measures** | Zero-shot retrieval: nDCG@10, Recall@K, MRR@10 |
| **Dataset** | 18 datasets, 5K-8.8M docs each. Key subsets: SciFact (fact verification), FEVER (claim verification), FiQA (financial QA) |
| **Primary metric** | nDCG@10 (average across datasets) |
| **PALACE adaptation** | Two modes: (A) Run Qwen3-Embedding-8B on standard BEIR corpora for leaderboard comparison. (B) Create PALACE-format BEIR dataset with 424 closets + 2000 synthetic distractors + 200 queries with relevance judgments. |
| **Expected difficulty** | MEDIUM. Qwen3-8B likely nDCG@10 ~0.45-0.55 on BEIR avg (competitive for 8B-class). PALACE hybrid should add 2-5 nDCG points over raw embedding. |

**Run command:**
```bash
python benchmarks/run_beir.py --model qwen3-embedding-8b --datasets scifact,fever,fiqa
npx tsx benchmarks/run_beir_palace.ts --distractors 2000
```

---

#### 3. MTEB — Embedding Model Quality

| | |
|---|---|
| **Paper** | arxiv.org/abs/2210.07316 (Muennighoff et al., 2022) |
| **Leaderboard** | huggingface.co/spaces/mteb/leaderboard |
| **Repo** | github.com/embeddings-benchmark/mteb |
| **Measures** | 8 tasks: classification, clustering, pair classification, reranking, retrieval, STS, summarization, bitext mining |
| **Dataset** | 56+ English datasets across all task types |
| **Primary metric** | Average score across retrieval + STS subsets |
| **PALACE adaptation** | Run `mteb` Python package on Qwen3-Embedding-8B. Reports direct leaderboard position. Independent of PALACE architecture — tests the embedding model only. |
| **Expected difficulty** | LOW to run. This benchmarks the model, not the system. |

**Run command:**
```bash
python benchmarks/run_mteb.py --model Qwen/Qwen3-Embedding-8B --tasks retrieval,sts
```

---

#### 4. LoCoMo — Conversational Memory Recall

| | |
|---|---|
| **Paper** | arxiv.org/abs/2402.07482 (Maharana et al., Snap Research, 2024) |
| **Repo** | github.com/snap-research/LoCoMo |
| **Measures** | Long-context conversational memory: single-hop factoid, multi-hop reasoning, open-ended, temporal, unanswerable |
| **Dataset** | ~300 conversations, ~3500 QA pairs, up to 600 turns per conversation |
| **Primary metric** | Accuracy per question type, with special focus on "unanswerable" detection |
| **PALACE adaptation** | Ingest LoCoMo conversations as closets (one per session). Run LoCoMo questions via `palace_search`. Test `confidence=low` for unanswerable questions. |
| **Expected difficulty** | MEDIUM for single-hop, HIGH for temporal (no metadata), HIGH for unanswerable (threshold calibration is hard with Qwen's compressed score distribution) |

**Run command:**
```bash
npx tsx benchmarks/run_locomo.ts --split test --palace-id <id>
```

---

#### 5. HotpotQA — Multi-Hop Reasoning

| | |
|---|---|
| **Paper** | arxiv.org/abs/1809.09600 (Yang et al., 2018) |
| **Dataset** | hotpotqa.github.io, HuggingFace: hotpot_qa |
| **Measures** | 2-hop QA requiring reasoning over 2+ documents. Supporting fact identification. |
| **Dataset** | 113K QA pairs. "Distractor" setting: 10 paragraphs per question (2 gold, 8 distractors). |
| **Primary metric** | Retrieval: Recall@5 on gold passages. Answer: EM, F1. Supporting fact: EM, F1. |
| **PALACE adaptation** | Ingest gold paragraphs as closets across wings. Auto-create tunnels from entity co-occurrence. Test `palace_walk_tunnel` + `palace_search` vs vector-only. Use distractor setting (10 paragraphs per Q). |
| **Expected difficulty** | HIGH. Tests tunnel system value. With only 14 manual tunnels, needs auto-tunnel generation. |

**Run command:**
```bash
npx tsx benchmarks/run_hotpotqa.ts --setting distractor --limit 500
```

---

### Tier 2 — Requires Significant Adaptation

#### 6. MuSiQue — Complex Multi-Hop Chains (3-4 hops)

| | |
|---|---|
| **Paper** | arxiv.org/abs/2108.00573 (Trivedi et al., 2022) |
| **Repo** | github.com/StonyBrookNLP/musique |
| **Measures** | 2-4 hop compositional reasoning with decomposed sub-questions and unanswerable variants |
| **Dataset** | ~25K questions with reasoning chain decompositions |
| **PALACE adaptation** | Tests multi-tunnel traversal. 3-hop = 3 tunnels. Unanswerable variants test incomplete tunnel paths. |
| **Expected difficulty** | VERY HIGH. Aspirational — exposes where graph infrastructure needs to grow. |

---

#### 7. StreamingQA — Temporal Knowledge Retrieval

| | |
|---|---|
| **Paper** | arxiv.org/abs/2205.11388 (Liska et al., Google DeepMind, 2022) |
| **Measures** | Time-stamped QA where answers change over time. Knowledge staleness detection. |
| **Dataset** | ~150K QA pairs spanning 2007-2022, organized by month/year |
| **PALACE adaptation** | Requires temporal metadata on closets (currently all have same createdAt). Create domain-specific temporal questions. Tests decay/TTL subsystem. |
| **Expected difficulty** | HIGH with current system (no temporal data), MEDIUM after metadata is added. |

---

#### 8. FreshQA-adapted — Contradiction Detection

| | |
|---|---|
| **Paper** | arxiv.org/abs/2310.03214 (Vu et al., Google, 2023) |
| **Measures** | Facts that change: never-changing, slow-changing, fast-changing, false-premise rejection |
| **Dataset** | ~600 questions with regularly-updated ground truth |
| **PALACE adaptation** | Map to memory lifecycle: permanent closets (no TTL), decaying closets (TTL), superseded closets (version chain). Test contradiction detection cron against known contradictions. |
| **Expected difficulty** | HIGH for contradiction detection (word-overlap heuristic untested), MEDIUM for freshness. |

---

#### 9. Custom: Access Control Isolation Suite

| | |
|---|---|
| **Benchmark** | Custom (no standard exists) |
| **Measures** | Cross-tenant isolation, per-NEop permission enforcement, scope binding accuracy, audit log completeness |
| **Dataset** | Generated from access_matrix.yaml (12 NEops × 12 wings × 13 categories = 1872 permission combinations) |
| **PALACE adaptation** | For each NEop: attempt reads/writes to every wing/category. Verify allowed/denied matches access_matrix.yaml. Test scope bindings (icd_zoo_media restricted to clients/zoo-media). |
| **Primary metric** | Access control accuracy (must be 100%), information leakage rate (must be 0%) |
| **Expected difficulty** | MEDIUM. Code exists (26 unit tests), needs E2E verification. |

**Run command:**
```bash
npx tsx benchmarks/run_acl_suite.ts --palace-id <id>
```

---

#### 10. Custom: End-to-End Agent Memory Evaluation

| | |
|---|---|
| **Related work** | Mem0 eval, A-MEM (arxiv.org/abs/2402.02790), MemoryBank (arxiv.org/abs/2305.10250), LETTA/MemGPT (arxiv.org/abs/2310.08560) |
| **Measures** | Full MCP pipeline: tool selection accuracy, retrieval quality, answer accuracy, multi-step memory operations |
| **Dataset** | 50-100 scenario-based multi-turn interactions (custom-built) |
| **PALACE adaptation** | Each scenario: setup (ingest) → interact (query) → verify (check answers). Test all 19 MCP tools. Use LLM-as-judge with multi-model panel. |
| **Primary metrics** | Tool selection accuracy, answer EM/F1, memory coherence, operation latency |
| **Expected difficulty** | HIGH. No off-the-shelf benchmark. Must be custom-built. |

---

## Evaluation Architecture

```
benchmarks/
├── BENCHMARKS.md                 ← This file
├── harness/
│   ├── loader.ts                 ← Downloads/parses benchmark datasets
│   ├── ingester.ts               ← Converts to PALACE closets
│   ├── runner.ts                 ← Executes queries via MCP/Convex
│   ├── metrics.ts                ← Computes Recall@K, nDCG, MRR, EM, F1
│   └── reporter.ts              ← Generates result files
├── run_longmemeval.ts
├── run_beir.py                   ← Python (uses beir package)
├── run_beir_palace.ts            ← TypeScript (PALACE-specific BEIR)
├── run_mteb.py                   ← Python (uses mteb package)
├── run_locomo.ts
├── run_hotpotqa.ts
├── run_acl_suite.ts
├── run_e2e_agent.ts
├── results_longmemeval.json
├── results_beir.json
├── results_mteb.json
├── results_locomo.json
├── results_hotpotqa.json
├── results_acl.json
└── results_e2e.json
```

**Two evaluation layers:**
1. **Retrieval-only:** Tests `palace_search` directly → Recall@K, nDCG@10, MRR. No LLM. Fast.
2. **End-to-end:** Tests MCP tool chain → answer accuracy (EM, F1), tool selection accuracy. Requires LLM.

**Metrics computed for every benchmark:**

| Metric | Formula | What it tells you |
|---|---|---|
| Recall@5 | (relevant docs in top 5) / (total relevant docs) | Can the system find what it needs? |
| Recall@10 | Same at rank 10 | How much does expanding the window help? |
| nDCG@10 | Normalized discounted cumulative gain | Are relevant docs ranked higher? |
| MRR@10 | 1/rank of first relevant doc | How quickly does the system find a match? |
| EM | Exact string match of answer | Is the answer precisely correct? |
| F1 | Token-level precision/recall of answer | Is the answer approximately correct? |

---

## Implementation Phases

### Phase 1: Foundation (Week 1)
- Set up `benchmarks/harness/` with loader, metrics, reporter
- Run MTEB retrieval subset on Qwen3-Embedding-8B → leaderboard position
- Create PALACE-specific BEIR dataset (424 closets + 2000 distractors + 200 queries)
- Compute baseline nDCG@10 and Recall@K on PALACE corpus

### Phase 2: Memory Retrieval (Week 2)
- Adapt 100 LongMemEval questions to PALACE domain
- Run LoCoMo single-hop and conversational questions
- Establish per-category baselines (info extraction, multi-session, temporal, etc.)
- Test "unanswerable" detection (confidence=low threshold calibration)

### Phase 3: Multi-Hop (Week 3, blocked on graph)
- Ingest HotpotQA distractor paragraphs as closets
- Auto-generate tunnels from entity co-occurrence
- Run 500 HotpotQA questions: vector-only vs vector+tunnels
- Quantify tunnel value-add (delta in Recall@5)

### Phase 4: Robustness (Week 4)
- Build ACL test matrix from access_matrix.yaml → run 1872 permission checks
- Build FreshQA-adapted contradiction suite → test detect-contradictions cron
- Build StreamingQA-adapted temporal questions (requires temporal metadata)

### Phase 5: End-to-End Agent (Week 5)
- Build 50 scenario-based MCP evaluations
- Test all 19 tools with ground-truth expected tool selections
- Run multi-model LLM-as-judge panel (Llama 4 Scout + GPT-OSS)
- Produce final benchmark report

---

## Pitfalls to Avoid

| Pitfall | Risk | Mitigation |
|---|---|---|
| **Corpus-size inflation** | 424 docs → artificially high R@5 | Always report corpus size. Add distractors for comparability. |
| **Score distribution mismatch** | Qwen scores 0.4-0.8 vs standard 0.6-0.95 | Use rank-based metrics (R@K, nDCG), not threshold-based. |
| **Temporal absence** | All closets same createdAt | Exclude temporal categories OR add metadata first. |
| **Tunnel sparsity** | 14 tunnels for 424 closets | Auto-generate tunnels before multi-hop benchmarks. |
| **Benchmark overfitting** | Tuning params on test set | Hold out 30% as test. Only tune on dev set. |
| **LLM-as-judge bias** | Claude judging Claude | Multi-model panel. Prefer EM/F1 for factual questions. |

---

## Expected Results Summary

| Benchmark | Metric | Expected Score | Confidence |
|---|---|---|---|
| LongMemEval (single-hop) | R@5 | 96-98% | Already measured |
| LongMemEval (multi-session) | R@5 | 85-92% | Medium |
| BEIR (Qwen3 standalone) | nDCG@10 avg | 0.45-0.55 | Based on model class |
| BEIR (PALACE hybrid) | nDCG@10 | +2-5 pts over raw | Medium |
| MTEB retrieval | Avg score | Top-30 for 8B class | Based on model class |
| LoCoMo (single-hop) | Accuracy | 80-90% | Medium |
| LoCoMo (unanswerable) | Precision | 60-75% | Low (threshold calibration) |
| HotpotQA (vector-only) | R@5 both docs | 50-65% | Medium |
| HotpotQA (vector+tunnels) | R@5 both docs | 70-85% | Aspirational |
| ACL suite | Accuracy | 100% required | High (code exists) |
| E2E agent | Tool selection | 85-95% | Medium |
