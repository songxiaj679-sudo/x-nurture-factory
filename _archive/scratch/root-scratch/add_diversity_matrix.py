import re

with open('src/autonomous_promo_ai.js', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. SLOT_DIVERSITY_MATRIX の定義を追加
matrix_code = '''
// ========================================================================
// 🎯 VELOX AI: スロット別トピック排他マトリクス (Slot-wise Diversity Enforcer)
// 全スロットで同じ話題・同じ数字（「月30時間」等）が連呼される金太郎飴現象を自律的に完全防止
// ========================================================================
const SLOT_DIVERSITY_MATRIX = {
  morning: {
    slotNameJa: '朝枠 (08:30 JST)',
    dimensionJa: '現場の実務ルーティン・仕組み化手順軸',
    dimensionEn: 'Operator Workflow & Systematic Protocol',
    focusTopicJa: '朝の始業前、限られた時間でタスクを裁くための具体的な業務手順やツールの連携・型化。数字の工数削減アピール（月〇時間等）は一切排し、現場ですぐ試せる実務の型を提示すること。',
    focusTopicEn: 'Actionable morning operations, tool orchestration workflows, and modular automation frameworks without superficial overhead statistics.',
    strictForbiddenThemesJa: ['月〇時間', '30時間', '45分', '白紙の画面', 'テレアポ', 'シャドウバン', '大言壮語'],
    hookConstraintJa: '現場のリアルな作業手順・業務の詰まりポイントから入る'
  },
  noon: {
    slotNameJa: '昼枠 (12:30 JST)',
    dimensionJa: 'プラットフォーム裏側・アルゴリズム技術防衛軸',
    dimensionEn: 'Platform Graph & Algorithmic Defense Telemetry',
    focusTopicJa: 'Xの最新アルゴリズムの仕様、公式API v2のセキュリティ、親ポスト直リンクによるインプレッション減衰の技術的裏話。工数削減や作業時間の話は一切禁止し、アカウント防御の現場知見に特化すること。',
    focusTopicEn: 'Technical algorithmic telemetry, official X API v2 security compliance, and zero-link distribution physics without operational efficiency clichés.',
    strictForbiddenThemesJa: ['月〇時間', '30時間', '朝の作業', '白紙の画面', '時間の価値', '経営者の孤独'],
    hookConstraintJa: '知られていないアルゴリズムの仕様変更・技術的事実から入る'
  },
  afternoon: {
    slotNameJa: '夕方枠 (17:30 JST)',
    dimensionJa: '自社の泥臭い検証・冷や汗をかいた失敗ログ軸',
    dimensionEn: 'Unfiltered Operator Failure Log & Empirical Post-Mortem',
    focusTopicJa: '自社が過去に実際に試して大失敗した運用の記録、アカウント制限がかかりかけた時の冷や汗体験、等身大の試行錯誤とそこから得た教訓。成功アピールや評論家目線は禁止し、痛い実録を語ること。',
    focusTopicEn: 'Candid operational post-mortems, account restriction near-misses, and tangible lessons learned from real-world failures.',
    strictForbiddenThemesJa: ['月〇時間', '30時間', '白紙の画面', 'アルゴリズム解説', '抽象的な経営論'],
    hookConstraintJa: '自社で冷や汗をかいた生々しい失敗の実録から入る'
  },
  evening: {
    slotNameJa: '夜枠 (20:00 JST)',
    dimensionJa: 'B2B成約心理・商談導線・フォロワーと売上の乖離軸',
    dimensionEn: 'B2B Deal Velocity & Organic Conversion Architecture',
    focusTopicJa: 'なぜフォロワーが増えても商談に繋がらないのか、見込み客が意思決定する信頼獲得心理、プロフィール固定ポストの設計思想。工数削減ではなく、ビジネスの成約構造を語ること。',
    focusTopicEn: 'Why follower counts rarely correlate with deal pipeline, enterprise buyer psychology, and high-converting pinned profile architecture.',
    strictForbiddenThemesJa: ['月〇時間', '30時間', '朝のルーティン', '白紙の画面', 'ツールの操作手順'],
    hookConstraintJa: '「フォロワーが増えても売上ゼロ」の構造的矛盾から入る'
  },
  late_night: {
    slotNameJa: '深夜枠 (22:30 JST)',
    dimensionJa: '経営資源としての時間・やめる勇気・静かなマインドセット軸',
    dimensionEn: 'Strategic Focus, Selective Inaction & Executive Mindset',
    focusTopicJa: '有限な人生における思考の優先順位、やらないことを決める勇気、反復作業を手放して本質的な意思決定に集中するマインド。具体的なツール名や工数数字は排し、静かな内省と哲学を語ること。',
    focusTopicEn: 'Prioritizing cognitive bandwidth, the courage to eliminate recurring busywork, and quiet executive reflections on strategic leverage.',
    strictForbiddenThemesJa: ['月〇時間', '30時間', 'アルゴリズム', 'ツールの機能', '白紙の画面', '商談獲得'],
    hookConstraintJa: '深夜の静かな内省・思考の優先順位から入る'
  }
};

/**
 * 過去または今回のバッチ内で直近に使われた頻出語・重要キーワードを抽出し、
 * 次のスロットで重複使用を禁止する動的ネガティブプールを構築
 */
function extractDynamicCooldownKeywords(previousPosts = []) {
  const coolDownWords = new Set();
  const textCorpus = previousPosts.map(p => {
    if (!p) return '';
    if (typeof p === 'string') return p;
    return (p.text || '') + ' ' + (Array.isArray(p.tweets) ? p.tweets.join(' ') : '');
  }).join(' ');

  // 1. 数字＋時間・期間の表現（例: 30時間, 45分, 15分, 100時間, 2倍など）
  const timeMatches = textCorpus.match(/[0-9０-９]+(?:\\.[0-9]+)?(?:時間|分|日|ヶ月|年|倍)/g) || [];
  timeMatches.forEach(m => coolDownWords.add(m));

  // 2. 特徴的な名詞・定型フレーズ
  const specificPhrases = [
    '月30時間', '30時間', '45分', '100時間', '白紙の画面', '画面を睨み', 'キーボードが止まる',
    '溶かして', '溶かしていた', '工数逼迫', '手作業に溶かし', '精神論', '泥臭い手作業',
    '思考体力', 'テレアポ', '削られる', '買い戻せない', '余白'
  ];
  specificPhrases.forEach(ph => {
    if (textCorpus.includes(ph)) coolDownWords.add(ph);
  });

  return Array.from(coolDownWords);
}
'''

# 挿入位置: diagnoseUserAccountStageAndStrategy の直前
diag_marker = '/**\n * 👤 [Pass 0]: X公式APIによるユーザーアカウント現在地のリアルタイム精密診断'
if diag_marker in code:
    code = code.replace(diag_marker, matrix_code + '\n' + diag_marker)
    print("SUCCESS: Inserted SLOT_DIVERSITY_MATRIX and extractDynamicCooldownKeywords")
else:
    print("FAILED: Could not find diag_marker")

with open('src/autonomous_promo_ai.js', 'w', encoding='utf-8') as f:
    f.write(code)
