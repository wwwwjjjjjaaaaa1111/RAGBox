"""中文友好的稀疏向量编码（BM25 风格，零外部模型依赖）。

设计：
- 分词：ASCII 连续字母数字为词；CJK 按单字+相邻双字组切分（中文无空格，
  bigram 能同时覆盖单字歧义与短语匹配）。
- 编码：token 用 crc32 哈希为 u32 索引（跨进程稳定），值为该 token 的词频。
- IDF 不在这里计算：集合创建时给稀疏向量配置 Modifier.IDF，
  由 Qdrant 在查询时按全库文档频率自动加权，等价于 BM25 的核心项。

Qdrant 稀疏点积语义：score = Σ query_tf·idf(t) × doc_tf，即经典的 tf·idf。
"""

from __future__ import annotations

import re
import zlib
from typing import Iterable

from qdrant_client import models

# 覆盖 CJK 统一表意文字（含扩展 A 区起点之后的主区段）。
_CJK_RE = re.compile(r"[\u3400-\u9fff]")
_ASCII_WORD_RE = re.compile(r"[a-z0-9]+")


def tokenize(text: str) -> list[str]:
    """把文本切分为用于稀疏匹配的 token 序列（含重复，保留词频信息）。"""

    tokens: list[str] = []
    lowered = text.lower()

    tokens.extend(_ASCII_WORD_RE.findall(lowered))

    # CJK 单字 + 相邻双字组：单字保底召回，双字提升短语区分度。
    cjk_runs = re.findall(r"[\u3400-\u9fff]+", lowered)
    for run in cjk_runs:
        tokens.extend(run)  # 单字
        tokens.extend(run[i : i + 2] for i in range(len(run) - 1))  # 双字组

    return tokens


def encode_sparse(text: str, index_space_bits: int = 32) -> models.SparseVector:
    """把文本编码为 Qdrant 稀疏向量。

    index_space_bits 控制哈希索引空间大小。哈希碰撞按特征哈希的惯例
    处理：相同索引的词频直接求和（合并），保证索引唯一以通过 Qdrant 校验。
    """

    tokens = tokenize(text)

    buckets: dict[int, float] = {}
    for token in tokens:
        index = zlib.crc32(token.encode("utf-8")) & ((1 << index_space_bits) - 1)
        buckets[index] = buckets.get(index, 0.0) + 1.0

    if not buckets:
        return models.SparseVector(indices=[], values=[])

    indices = sorted(buckets)
    return models.SparseVector(indices=indices, values=[buckets[i] for i in indices])


def encode_batch(texts: Iterable[str], index_space_bits: int = 32) -> list[models.SparseVector]:
    return [encode_sparse(text, index_space_bits) for text in texts]
