const { db } = require('./firestore');

/**
 * 🏛️ MAP-Elites (Multi-dimensional Archive of Phenotypic Elites)
 * ＆ Reflexion (Verbal Reinforcement Learning) コアエンジン
 * 
 * 単一スコアによる局所解（50点スタック）を完全排除し、
 * 多様な行動ニッチ（アングル × 構造 × ペルソナ）ごとに最高峰（80〜100点）のエリートを維持・交配する。
 */

// 1. 行動ニッチの次元定義（Behavioral Characteristics）
const NICHES = {
  angles: [
    { id: 'contrarian', name: '常識の逆張り・議論惹起型', desc: '業界の当たり前を覆し、プロ同士の引用RTを呼ぶ' },
    { id: 'primary_data', name: '一次データ・現場検証暴露型', desc: '泥臭い自社検証データで反論不能のファクトを突きつける' },
    { id: 'loss_aversion', name: '疑問形・損失回避型', desc: '読者の見落としている機会損失やコストを指摘' },
    { id: 'empathy_story', name: '失敗告白・共感ストーリー型', desc: '過去の痛々しい失敗から得た教訓の共有' },
    { id: 'minimalist_punch', name: '超短文・本質ワンフレーズ型', desc: '無駄を削ぎ落とし、1行で読者の固定観念を射抜く' }
  ],
  formats: [
    { id: 'single_punch', name: '単発140字完結' },
    { id: 'logical_thread', name: '4段ロジカルスレッド (フック→原因解体→解決策→導線)' },
    { id: 'comparison_table', name: '対比構造 (Before/After, 伸びない人 vs 伸びる人)' }
  ],
  targetAudience: [
    { id: 'b2b_executive', name: 'B2B経営者・役員・意思決定層' },
    { id: 'sme_operator', name: '現場リーダー・実務担当・マーケター' }
  ]
};

/**
 * 複合多目的スコア（Multi-Objective Pareto Score）の算出
 * 単なるインプレッション（露出）に偏らず、保存・クリック・信頼の総合調和を測定
 */
function calculateParetoFitness({ impressions = 0, likes = 0, retweets = 0, quotes = 0, bookmarks = 0, profileClicks = 0 }) {
  if (impressions === 0) return 60; // 初期デフォルト

  // 1. 露出スコア (0〜25点)
  const reachScore = Math.min(25, Math.log10(impressions + 1) * 6.5);

  // 2. 共感・保存度スコア (0〜35点) - ブックマークと引用RTを最重要視（アルゴリズム最優先指標）
  const bookmarkRate = bookmarks / impressions;
  const quoteRate = quotes / impressions;
  const depthScore = Math.min(35, (bookmarkRate * 2500) + (quoteRate * 3500) + (likes / impressions * 300));

  // 3. 実利・商談導線スコア (0〜25点) - プロフクリック率
  const profileClickRate = profileClicks / impressions;
  const practicalScore = Math.min(25, profileClickRate * 2000);

  // 4. ベースライン信頼スコア (15点)
  const trustBase = 15;

  const totalScore = Math.round(reachScore + depthScore + practicalScore + trustBase);
  return Math.min(100, Math.max(0, totalScore));
}

function measureSyntaxPrinciple(postText) {
  const text = String(postText || '');
  const lines = text.split('\n');
  const first = lines[0] || '';
  const ending = /[?？]\s*$|か。\s*$/.test(text.trim()) ? '疑問終止' : '断定終止';
  return `改行${lines.length}行、1行目${first.length}字、${ending}。`;
}

/**
 * 🎯 MAP-Elites サンプラー (活用80% vs 探索20%)
 * 50点の局所解に閉じこもらないよう、未開拓セルや逆張りセルを強制注入する
 */
async function sampleFromMapElitesArchive(userId, { allowMutation = true } = {}, targetDb = null) {
  const activeDb = targetDb || db;
  const isTest = process.env.NODE_ENV === 'test' || (process.argv && process.argv.some(a => a.includes('test')));
  const archiveKey = `map_elites_${userId || 'global'}`;
  let userArchive = {};

  if (targetDb || (!isTest || process.env.FIRESTORE_EMULATOR_HOST)) {
    try {
      const doc = await activeDb.collection('collective_intelligence').doc(archiveKey).get();
      if (doc.exists) {
        userArchive = doc.data().grid || {};
      }
    } catch (e) {
      console.warn(`[MAP-Elites Read Warning] ${archiveKey}: ${e.message}`);
    }
  }

  const mergedArchive = userArchive;
  const allCellKeys = Object.keys(mergedArchive);

  // 探索（Exploration / Mutation: 20%の確率）
  const isExploration = allowMutation && (Math.random() < 0.20);

  if (isExploration || allCellKeys.length === 0) {
    // 選択された組み合わせの効果は未検証
    const randomAngle = NICHES.angles[Math.floor(Math.random() * NICHES.angles.length)];
    const randomFormat = NICHES.formats[Math.floor(Math.random() * NICHES.formats.length)];
    const randomAudience = NICHES.targetAudience[Math.floor(Math.random() * NICHES.targetAudience.length)];
    const cellId = `${randomAngle.id}:${randomFormat.id}:${randomAudience.id}`;

    console.log(`🧬 [MAP-Elites 探索候補] セル【${cellId}】を選択しました`);

    return {
      mode: 'exploration',
      cellId,
      angle: randomAngle,
      format: randomFormat,
      audience: randomAudience,
      directive: `【探索候補】『${randomAngle.name}』×『${randomFormat.name}』の切り口を試す。効果は未検証であり、未提供の数値や実体験を創作しない。`,
      referenceElite: mergedArchive[cellId] || null
    };
  }

  // 活用（Exploitation: 80%の確率） - 実績スコアの高い上位エリートから選定
  const sortedElites = Object.entries(mergedArchive)
    .sort(([, a], [, b]) => (b.score || 0) - (a.score || 0));

  const chosenEntry = sortedElites[Math.floor(Math.random() * Math.min(3, sortedElites.length))] || sortedElites[0];
  const [cellId, elite] = chosenEntry;
  const [angleId, formatId, audienceId] = cellId.split(':');

  const angle = NICHES.angles.find(a => a.id === angleId) || NICHES.angles[0];
  const format = NICHES.formats.find(f => f.id === formatId) || NICHES.formats[0];
  const audience = NICHES.targetAudience.find(t => t.id === audienceId) || NICHES.targetAudience[0];

  return {
    mode: 'exploitation',
    cellId,
    angle,
    format,
    audience,
    eliteScore: elite.score,
    referenceHook: elite.hook,
    syntaxPrinciple: elite.syntaxPrinciple,
    reflection: `投稿指標のスコアは${elite.score}点。投稿内容と成果の因果関係は未検証。`,
    directive: `【記録済み投稿の参考】指標スコア${elite.score}点の投稿を参考に『${angle.name}』を検討する。投稿内容と成果の因果関係は未検証。`
  };
}

/**
 * 📝 Reflexion（言語的反省）とMAP-Elitesセルの更新
 * 投稿後の実績をもとに「何が成功し、何がボトルネックだったか」を言語化してセルをアップグレード
 */
async function registerPostPerformanceAndReflect({ userId, cellId, postText, metrics }) {
  const fitness = calculateParetoFitness(metrics);
  const archiveKey = `map_elites_${userId || 'global'}`;

  // 言語的反省（Verbal Reflection）の自動生成
  const reflectionText = `投稿指標のスコアは${fitness}点。投稿内容と成果の因果関係は未検証。`;

  try {
    const docRef = db.collection('collective_intelligence').doc(archiveKey);
    const snap = await docRef.get();
    let grid = snap.exists ? (snap.data().grid || {}) : {};

    const currentElite = grid[cellId];
    if (!currentElite || fitness > currentElite.score) {
      console.log(`🏆 [MAP-Elites 新エリート誕生] セル【${cellId}】の最高スコアが ${currentElite ? currentElite.score : 0}点 → ${fitness}点 へ更新されました！`);
      grid[cellId] = {
        score: fitness,
        hook: postText.split('\n')[0] || postText.slice(0, 50),
        fullSample: postText,
        syntaxPrinciple: measureSyntaxPrinciple(postText),
        reflection: reflectionText,
        updatedAt: new Date()
      };

      await docRef.set({ grid, updatedAt: new Date() }, { merge: true });
    }
  } catch (err) {
    console.error('MAP-Elites update error:', err.message);
  }

  return { fitness, reflection: reflectionText };
}

module.exports = {
  NICHES,
  calculateParetoFitness,
  sampleFromMapElitesArchive,
  registerPostPerformanceAndReflect
};
