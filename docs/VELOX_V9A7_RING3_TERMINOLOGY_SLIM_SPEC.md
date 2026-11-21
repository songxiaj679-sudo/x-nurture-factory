# VELOX V9-A.7: Ring 3 Terminology Exclusion Spec

## 0. 絶対ルール・前提（AGENTS.md Sections 1–6 準拠）

- 本仕様の正は `/home/songxiaj679/x-nurture-factory/AGENTS.md` Sections 1–6 である。
- 明示指示なく `git commit` / `git push` しない。再起動対象は `x-shop` のみ。
- `criticSystemRules(false)`、`src/llm_router.js`、`ring1`、`ring2`、`isolateLpContext === true` は変えない。

## 1. 用語

`knowledgeLine()` は、`topicRing === 'ring3_product_bridge'` のときだけ `terminology` を空にする。`oneLineMechanism` の 1 文は残す。`ring1` と `ring2` は用語を渡したままにする。

## 2. 検証

`tests/v9a7_ring3_terminology_slim.test.js` で、ring3 だけ用語が外れ、ring1 と ring2 では残ることを見る。
