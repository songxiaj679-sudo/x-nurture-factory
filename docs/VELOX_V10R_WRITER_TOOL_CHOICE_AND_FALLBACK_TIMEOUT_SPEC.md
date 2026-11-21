# VELOX V10-R: Writer Forced Tool Choice and Aligned Fallback Timeout

## 0. 絶対ルール
- 正は `AGENTS.md` Sections 1–6。秘密、メール、URL は出さない。
- `completeCritic()` と `criticSystemRules(false)`（353 字）は変更しない。

## 1. ツール指定
- `completeWriter()` の Anthropic `tool_choice` は `{ type: 'tool', name: schemaName }`。
- 通常のテキスト生成経路は変えない。

## 2. フォールバック待ち時間
- Anthropic 失敗後の xAI 呼び出しは、呼び出し側の `timeoutMs` をそのまま使う。20 秒固定は使わない。

## 3. モデル別のプロセス内キャッシュ
- `400` で `tool_choice` の `type: "tool"` または `"any"` が非対応と返ったモデル名を、プロセス内の `Set` に記録する。
- 記録済みのモデルへの次の `completeWriter()` は、`type: "tool"` を送らず、最初から `{ type: "auto" }` で 1 往復にする。
- 別のモデル名は、また最初に `type: "tool"` を試す。
- `resetWriterToolChoiceCache()` で記録を消し、テスト間で持ち越さない。
