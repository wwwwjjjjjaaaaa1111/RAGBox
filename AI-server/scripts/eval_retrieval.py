"""检索质量评估脚本：在评估集上计算检索指标。

评估集格式（eval/retrieval_eval.jsonl，每行一条）：
    {"id", "question", "user_id", "file_id",
     "expected_point_id"(8位前缀), "expected_chunk_index", "expected_page"}

指标：
    chunk_hit@k  — 期望分块（按 point_id 前缀匹配）出现在 top-k
    page_hit@k   — 期望文件同页的任一分块出现在 top-k（同页等义于答案同源）
    MRR@k        — 期望分块首次命中排名的倒数均值

用法：
    python scripts/eval_retrieval.py [--threshold 0.0] [--k 5] [--detail]

--threshold 传 0.0 观察纯排序质量；传 0.35（生产默认）观察线上拦截后的表现。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.knowledge_base.vector_store import KnowledgeVectorStore  # noqa: E402


def load_eval_set(path: Path) -> list[dict]:
    items = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            items.append(json.loads(line))
    return items


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--threshold", type=float, default=0.0)
    parser.add_argument("--k", type=int, default=5)
    parser.add_argument("--detail", action="store_true", help="逐题输出命中详情")
    args = parser.parse_args()

    eval_path = Path(__file__).resolve().parents[1] / "eval" / "retrieval_eval.jsonl"
    items = load_eval_set(eval_path)
    store = KnowledgeVectorStore()

    chunk_hit1 = chunk_hit5 = page_hit5 = 0
    reciprocal_rank_sum = 0.0
    empty_results = 0
    details: list[str] = []

    for item in items:
        question = item["question"]
        user_id = item["user_id"]
        expected_prefix = item["expected_point_id"]
        expected_page = item["expected_page"]

        matches = store.retrieve_chunks(
            question,
            user_id,
            top_k=args.k,
            score_threshold=args.threshold,
        )

        if not matches:
            empty_results += 1

        # 排序位置从 1 开始；(file_id, chunk_index) 唯一标识一个分块。
        # 注意：langchain-qdrant 返回的 Document.id 不携带 Qdrant point id，
        # 因此不能用 point 前缀匹配。
        chunk_rank = None
        page_rank = None
        for rank, (document, _score) in enumerate(matches, start=1):
            metadata = document.metadata or {}
            is_expected_chunk = (
                metadata.get("file_id") == item["file_id"]
                and metadata.get("chunk_index") == item["expected_chunk_index"]
            )
            is_expected_page = (
                metadata.get("file_id") == item["file_id"]
                and expected_page is not None
                and metadata.get("page_number") == expected_page
            )
            if chunk_rank is None and is_expected_chunk:
                chunk_rank = rank
            if page_rank is None and is_expected_page:
                page_rank = rank

        if chunk_rank == 1:
            chunk_hit1 += 1
        if chunk_rank is not None:
            chunk_hit5 += 1
            reciprocal_rank_sum += 1.0 / chunk_rank
        if page_rank is not None:
            page_hit5 += 1

        if args.detail:
            scores = [round(float(s), 3) for _, s in matches]
            details.append(
                f"{item['id']}  rank={chunk_rank or '-'}  page_hit={bool(page_rank)}  "
                f"scores={scores}  {question}"
            )

    n = len(items)
    print(f"评估集: {n} 题 | 阈值: {args.threshold} | k: {args.k}")
    print(f"  chunk_hit@1 : {chunk_hit1}/{n} = {chunk_hit1 / n:.1%}")
    print(f"  chunk_hit@{args.k} : {chunk_hit5}/{n} = {chunk_hit5 / n:.1%}")
    print(f"  page_hit@{args.k}  : {page_hit5}/{n} = {page_hit5 / n:.1%}")
    print(f"  MRR@{args.k}        : {reciprocal_rank_sum / n:.3f}")
    print(f"  检索为空        : {empty_results}/{n}")

    if args.detail:
        print("\n逐题详情:")
        for line in details:
            print(f"  {line}")


if __name__ == "__main__":
    main()
