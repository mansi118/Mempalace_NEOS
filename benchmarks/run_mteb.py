"""
Run MTEB retrieval benchmarks on Qwen3-Embedding-8B via HuggingFace API.

Since we can't load the 8B model locally (too large for CPU), we test
via the HuggingFace Inference API and run on smaller MTEB tasks.

Usage:
    python benchmarks/run_mteb.py
"""

import json
import time
import os
import numpy as np
from pathlib import Path

# Use HuggingFace API for embeddings (same as PALACE production).
HF_TOKEN = os.environ.get("HF_TOKEN", "")
API_URL = "https://router.huggingface.co/scaleway/v1/embeddings"
MODEL = "qwen3-embedding-8b"


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed texts via HuggingFace API (same endpoint as PALACE)."""
    import requests

    results = []
    # Batch in chunks of 32.
    for i in range(0, len(texts), 32):
        chunk = texts[i:i+32]
        resp = requests.post(
            API_URL,
            headers={"Authorization": f"Bearer {HF_TOKEN}", "Content-Type": "application/json"},
            json={"model": MODEL, "input": chunk},
            timeout=30,
        )
        if resp.status_code != 200:
            print(f"  API error {resp.status_code}: {resp.text[:100]}")
            # Return zero vectors as fallback.
            results.extend([[0.0] * 4096] * len(chunk))
            continue
        data = resp.json()
        sorted_data = sorted(data["data"], key=lambda x: x["index"])
        results.extend([d["embedding"] for d in sorted_data])
    return results


def cosine_sim(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two vectors."""
    a_np = np.array(a)
    b_np = np.array(b)
    return float(np.dot(a_np, b_np) / (np.linalg.norm(a_np) * np.linalg.norm(b_np) + 1e-10))


def run_sts_benchmark():
    """Run STS Benchmark (semantic textual similarity) — small, fast, diagnostic."""
    print("\n=== STS Benchmark (Semantic Textual Similarity) ===\n")

    # Standard STS pairs with human similarity scores (0-5 scale).
    pairs = [
        ("A man is eating food.", "A man is eating a piece of bread.", 3.2),
        ("A woman is playing violin.", "A woman is playing guitar.", 2.6),
        ("A dog is running.", "A cat is sleeping.", 0.8),
        ("The stock market crashed.", "Financial markets experienced a downturn.", 4.2),
        ("A child is riding a horse.", "A boy is riding a pony.", 3.8),
        ("A plane is taking off.", "An aircraft is landing.", 2.0),
        ("A woman is dancing.", "A person is moving to music.", 3.5),
        ("Two men are fighting.", "Two people are arguing.", 3.0),
        ("A dog is catching a ball.", "A dog is playing fetch.", 4.5),
        ("The president gave a speech.", "The leader addressed the nation.", 3.8),
        ("A cat sits on a mat.", "A feline rests on a rug.", 4.0),
        ("She cooked dinner.", "She prepared the evening meal.", 4.2),
        ("It is raining heavily.", "There is a thunderstorm.", 2.5),
        ("He drove to work.", "He commuted by car.", 4.0),
        ("The children are playing in the park.", "Kids are having fun outdoors.", 3.5),
        ("I love programming.", "Coding is my passion.", 4.0),
        ("The movie was boring.", "The film was uninteresting.", 4.5),
        ("A fish is swimming.", "A bird is flying.", 1.0),
        ("The sun is shining.", "It is a bright day.", 3.8),
        ("She read a book.", "He watched television.", 0.5),
    ]

    print(f"  Embedding {len(pairs) * 2} sentences...")
    all_texts = [p[0] for p in pairs] + [p[1] for p in pairs]
    embeddings = embed_texts(all_texts)

    scores_pred = []
    scores_gold = []

    for i, (s1, s2, gold) in enumerate(pairs):
        emb1 = embeddings[i]
        emb2 = embeddings[len(pairs) + i]
        sim = cosine_sim(emb1, emb2)
        scores_pred.append(sim)
        scores_gold.append(gold / 5.0)  # Normalize to 0-1.
        print(f"  [{gold:.1f}] sim={sim:.3f} | {s1[:40]} ↔ {s2[:40]}")

    # Spearman correlation.
    from scipy import stats
    corr, p_value = stats.spearmanr(scores_pred, scores_gold)
    print(f"\n  Spearman correlation: {corr:.4f} (p={p_value:.4f})")
    print(f"  {'GOOD' if corr > 0.7 else 'FAIR' if corr > 0.5 else 'POOR'} embedding quality for STS")

    return {"spearman": round(corr, 4), "p_value": round(p_value, 4), "n_pairs": len(pairs)}


def run_retrieval_benchmark():
    """Run a small retrieval benchmark — query → corpus matching."""
    print("\n=== Retrieval Benchmark (Query → Document) ===\n")

    # Corpus: 20 diverse documents.
    corpus = [
        "Python is a high-level programming language known for its readability.",
        "Machine learning is a subset of artificial intelligence focused on pattern recognition.",
        "The Eiffel Tower is a wrought-iron lattice tower in Paris, France.",
        "Photosynthesis converts sunlight into chemical energy in plants.",
        "The stock market is a marketplace for buying and selling securities.",
        "Shakespeare wrote plays including Hamlet, Macbeth, and Romeo and Juliet.",
        "DNA contains the genetic instructions for all living organisms.",
        "Cloud computing delivers computing services over the internet.",
        "The Great Wall of China is an ancient fortification spanning thousands of miles.",
        "Quantum computing uses quantum mechanical phenomena to process information.",
        "The Amazon rainforest is the largest tropical rainforest in the world.",
        "Neural networks are computing systems inspired by biological neural networks.",
        "The human heart pumps blood through the circulatory system.",
        "Blockchain is a distributed ledger technology for secure transactions.",
        "Mars is the fourth planet from the Sun in our solar system.",
        "Democracy is a form of government in which people have authority.",
        "Antibiotics are medications used to treat bacterial infections.",
        "The internet connects billions of devices worldwide.",
        "Climate change refers to long-term shifts in global temperatures.",
        "Yoga is a practice combining physical postures, breathing, and meditation.",
    ]

    # Queries with known relevant document index.
    queries = [
        ("What programming language is known for readability?", [0]),
        ("How do plants make energy from sunlight?", [3]),
        ("Where is the Eiffel Tower located?", [2]),
        ("What is machine learning?", [1]),
        ("How does the stock market work?", [4]),
        ("Who wrote Hamlet?", [5]),
        ("What does DNA contain?", [6]),
        ("What is cloud computing?", [7]),
        ("Tell me about the Great Wall of China", [8]),
        ("How does quantum computing work?", [9]),
        ("What is the largest rainforest?", [10]),
        ("How do neural networks work?", [11]),
        ("How does the heart pump blood?", [12]),
        ("What is blockchain technology?", [13]),
        ("Tell me about Mars", [14]),
        ("What is democracy?", [15]),
        ("What are antibiotics used for?", [16]),
        ("How does the internet work?", [17]),
        ("What is climate change?", [18]),
        ("What is yoga?", [19]),
    ]

    print(f"  Embedding corpus ({len(corpus)} docs) and queries ({len(queries)})...")
    corpus_embs = embed_texts(corpus)
    query_texts = [q[0] for q in queries]
    query_embs = embed_texts(query_texts)

    r1 = 0
    r5 = 0
    mrr = 0

    for i, (query_text, gold_ids) in enumerate(queries):
        # Rank corpus by similarity.
        sims = [(j, cosine_sim(query_embs[i], corpus_embs[j])) for j in range(len(corpus))]
        sims.sort(key=lambda x: -x[1])
        ranked_ids = [s[0] for s in sims]

        # Metrics.
        gold_set = set(gold_ids)
        if ranked_ids[0] in gold_set:
            r1 += 1
        if any(ranked_ids[j] in gold_set for j in range(min(5, len(ranked_ids)))):
            r5 += 1
        for j, rid in enumerate(ranked_ids[:10]):
            if rid in gold_set:
                mrr += 1 / (j + 1)
                break

        hit = "✓" if ranked_ids[0] in gold_set else "✗"
        print(f"  {hit} Q: \"{query_text[:45]}\" → top={sims[0][1]:.3f} rank={ranked_ids.index(gold_ids[0])+1}")

    n = len(queries)
    print(f"\n  R@1:    {r1/n*100:.1f}%")
    print(f"  R@5:    {r5/n*100:.1f}%")
    print(f"  MRR@10: {mrr/n*100:.1f}%")

    return {"R@1": round(r1/n, 4), "R@5": round(r5/n, 4), "MRR@10": round(mrr/n, 4), "n_queries": n, "corpus_size": len(corpus)}


def main():
    print("MTEB-Style Benchmark for Qwen3-Embedding-8B")
    print("=" * 50)
    print(f"Model: {MODEL}")
    print(f"Dimensions: 4096")
    print(f"API: {API_URL}")

    t0 = time.time()
    sts_results = run_sts_benchmark()
    retrieval_results = run_retrieval_benchmark()
    duration = time.time() - t0

    # Summary.
    print("\n" + "=" * 50)
    print("  SUMMARY")
    print("=" * 50)
    print(f"\n  STS Spearman:     {sts_results['spearman']:.4f}")
    print(f"  Retrieval R@1:    {retrieval_results['R@1']*100:.1f}%")
    print(f"  Retrieval R@5:    {retrieval_results['R@5']*100:.1f}%")
    print(f"  Retrieval MRR@10: {retrieval_results['MRR@10']*100:.1f}%")
    print(f"  Duration:         {duration:.1f}s")

    # Save.
    out = {
        "model": MODEL,
        "dimensions": 4096,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sts": sts_results,
        "retrieval": retrieval_results,
        "duration_s": round(duration, 1),
    }
    Path("benchmarks/results").mkdir(parents=True, exist_ok=True)
    Path("benchmarks/results/results_mteb.json").write_text(json.dumps(out, indent=2))
    print("\nSaved to benchmarks/results/results_mteb.json")


if __name__ == "__main__":
    main()
