require('dotenv').config();
const crypto = require('crypto');
const { sanitizePostOrReplyText } = require('./official_api_client');
const { hasXaiKey, completeJson } = require('./grok_client');
const { isSetupForeignAccount, resolveExitCountry, resolveAccountLocaleConfig } = require('./browser_config');

// 10万アカウントでも絶対に被らない数億通りの多次元ペルソナDNAを決定論的に生成
const REGIONS = [
  "東京・下北沢周辺", "東京・吉祥寺エリア", "東京・中目黒周辺", "東京・高円寺", "東京・恵比寿", "東京・神楽坂", "東京・清澄白河", "東京・三軒茶屋", "東京・池袋周辺", "東京・立川",
  "神奈川・横浜みなとみらい", "神奈川・鎌倉", "神奈川・湘南エリア", "神奈川・武蔵小杉", "神奈川・川崎", "埼玉・大宮", "埼玉・川越", "埼玉・浦和", "千葉・船橋", "千葉・柏",
  "大阪・梅田周辺", "大阪・堀江エリア", "大阪・中崎町", "大阪・難波", "大阪・天王寺", "大阪・吹田", "京都・烏丸周辺", "京都・出町柳", "京都・嵐山近く", "兵庫・神戸三宮",
  "兵庫・西宮北口", "兵庫・姫路", "愛知・名古屋栄", "愛知・覚王山", "愛知・大須", "福岡・天神エリア", "福岡・薬院", "福岡・博多", "福岡・糸島近く", "北海道・札幌大通",
  "北海道・円山エリア", "北海道・函館", "宮城・仙台青葉区", "広島・紙屋町", "広島・尾道", "静岡・浜松", "静岡・三島", "長野・松本", "長野・軽井沢周辺", "石川・金沢",
  "岡山・倉敷", "香川・高松", "愛媛・松山", "熊本・中央区", "鹿児島・天文館周辺", "沖縄・那覇", "沖縄・北谷周辺", "新潟・中央区", "栃木・宇都宮", "茨城・つくば"
];

const AGES = [
  "20歳・大学2年生", "21歳・大学3年生", "22歳・新社会人", "23歳・社会人2年目", "24歳", "25歳", "26歳", "27歳",
  "28歳", "29歳", "30歳", "31歳", "32歳", "33歳", "34歳", "35歳", "36歳", "37歳", "38歳", "39歳", "41歳", "43歳"
];

const JOBS = [
  "フロントエンドエンジニア", "バックエンドエンジニア", "インフラエンジニア", "UI/UXデザイナー", "グラフィックデザイナー", "Webマーケター", "SNS運用ディレクター", "広報・PR職",
  "法人営業", "企画・商品開発", "経理・財務", "人事・採用担当", "総務・バックオフィス", "フリーランスイラストレーター", "フリーランス動画編集者", "Webライター",
  "建築設計士", "インテリアコーディネーター", "カフェスタッフ", "バリスタ", "パン職人", "パティシエ", "書店員", "図書館司書", "アパレル販売員", "バイヤー",
  "美容師", "ネイリスト", "アイリスト", "化粧品メーカー勤務", "看護師", "薬剤師", "理学療法士", "管理栄養士", "歯科衛生士", "保育士",
  "塾講師", "音楽教室講師", "フィットネストレーナー", "ヨガインストラクター", "ホテルスタッフ", "旅行会社勤務", "不動産営業", "印刷会社勤務",
  "雑貨メーカー企画", "食品メーカー開発", "カメラマンアシスタント", "音響スタッフ", "イベント制作", "花屋スタッフ", "トリマー", "在宅ワーカー"
];

const HOBBIES = [
  "自家焙煎珈琲の飲み比べ", "純喫茶巡り", "路地裏の個人カフェ開拓", "ハード系パン屋巡り", "スパイスカレー作り", "週末の作り置き自炊", "クラフトビール収集", "日本酒の飲み比べ",
  "ナチュラルワイン", "抹茶スイーツ探し", "町中華開拓", "ラーメン食べ歩き", "ミニシアターでの映画鑑賞", "海外ドラマの一気見", "深夜アニメ視聴", "邦ロックのライブ遠征",
  "ジャズレコード収集", "シティポップ鑑賞", "アコースティックギター練習", "ピアノ弾き語り", "フィルムカメラ散歩", "夜景スナップ撮影", "現代美術館巡り", "建築巡り",
  "古書店・古本屋巡り", "ミステリー小説読書", "SF小説", "エッセイ本収集", "ソロキャンプ", "焚き火", "低山ハイキング", "朝のランニング",
  "ピラティス", "夜のストレッチとヨガ", "週3回の筋トレ", "サウナと水風呂（サ活）", "日帰り温泉巡り", "銭湯開拓", "観葉植物（塊根植物）育成", "ベランダ菜園",
  "アクアリウム・メダカ飼育", "猫カフェ通い", "柴犬動画を見ること", "古着屋ディグ", "スニーカー収集", "シルバーアクセサリー集め", "香水・フレグランス収集", "文房具・万年筆集め",
  "手帳デコ・ジャーナリング", "ボードゲームカフェ", "インディーゲーム", "レトロゲーム収集", "ガジェット・キーボード沼", "スマートホーム化", "国内のローカル線ひとり旅", "御朱印・神社仏閣巡り",
  "プラネタリウム鑑賞", "天体観測", "陶器・器集め", "北欧インテリア雑貨集め", "アロマテラピー", "紅茶・ハーブティー淹れ", "編み物・ハンドメイド", "レザークラフト"
];

const PERSONALITIES = [
  "日常のささやかな変化や季節の匂いにすぐ気づく繊細で穏やかな感性",
  "好きなことにはとことん凝り性で、道具や素材まで調べ尽くす探究心タイプ",
  "マイペースで一人の時間を大切にしつつ、美味しいものを食べるとすぐ機嫌が良くなる性格",
  "仕事はきっちりこなしつつ、定時後や休日の趣味時間のために生きているメリハリ派",
  "落ち着いた大人びた視点で物事を眺め、静かな空間や夜の時間を好む夜型タイプ",
  "フットワークが軽く、気になったお店や展示には週末すぐ足を運ぶ行動派",
  "少し人見知りだけど、共通の趣味の話になると饒舌になる親しみやすい性格",
  "丁寧な暮らしに憧れつつも、時々ズボラになってしまう人間味のある自然体",
  "ユーモアがあって日常のちょっとした失敗も明るく笑い話に変えるポジティブ気質",
  "音楽や映画の余韻に長く浸るのが好きなロマンチスト気質",
  "論理的でスッキリしたものを好むミニマリスト志向",
  "下町の空気や昔ながらの個人店を愛するノスタルジー志向"
];

const WRITING_STYLES = [
  "丁寧で柔らかい「〜ですね」「〜ます」調。句読点を丁寧に使い、落ち着いたリズムで書く",
  "飾らない自然な独り言の「〜だなあ」「〜かも」調。話し言葉に近いナチュラルな文体",
  "短めの文をテンポよく重ねる体言止めミックス調（「〜な夜。」「〜が心地いい。」）",
  "ひらがなを少し多めに使い、角のないふんわりした優しい空気感で書く文体",
  "余計な感嘆符（！）を使わず、静かなエッセイや日記の一節のように落ち着いた文体",
  "感情が素直に出る「〜で嬉しい」「〜が最高だった」など温度感のある親しみやすい文体",
  "少し知的な語彙を混ぜつつ、日常の風景を切り取るような観察眼のある文体",
  "句読点を控えめにし、改行や空白感でリズムを作る現代的なSNS文体",
  "語尾に「〜だったりする」「〜な気がする」など断定を避ける柔らかいニュアンスを持つ文体",
  "関西や地方出身の柔らかさがほんのり滲む、温かみのあるフランクな文体"
];

const FIRST_PERSONS = ["私", "わたし", "僕", "自分", "（一人称は省略して主語なしで書く）"];

const MICRO_TOPICS = [
  "ふと立ち寄ったお店の空気感", "今日飲んだ飲み物の温度や香り", "仕事や作業の合間の小さな息抜き",
  "窓から見えた空の色や風の匂い", "最近買って良かった日用品や道具", "週末にやりたい趣味の計画",
  "移動中に聴いていた音楽やラジオの余韻", "今日のランチや夜ごはんのメニュー選び", "部屋の片付けや模様替えの気分",
  "最近読んでいる本や観た作品のひとコマ", "季節の変わり目の服装選び", "朝の目覚めとルーティン",
  "帰り道に見かけた風景", "趣味に没頭していて時間があっという間に過ぎた話", "ちょっとした自分へのご褒美"
];

function ensureAccountPersonality(token, accountData = {}) {
  const baseAttr = accountData.attributes || {};
  const seedStr = String(token || accountData.userId || 'default_seed');
  const h = crypto.createHash('sha512').update(seedStr).digest();

  const pick = (arr, offset) => arr[(h.readUInt32BE(offset % (h.length - 4))) % arr.length];

  const gender = baseAttr.gender || (h[0] % 2 === 0 ? '男性' : '女性');
  const location = baseAttr.location || accountData.location || pick(REGIONS, 4);
  const age = baseAttr.age || pick(AGES, 8);
  const job = baseAttr.job || pick(JOBS, 12);

  let hobbies = Array.isArray(baseAttr.hobbies) && baseAttr.hobbies.length >= 2 ? baseAttr.hobbies : [];
  if (hobbies.length < 2) {
    const h1 = pick(HOBBIES, 16);
    let h2 = pick(HOBBIES, 20);
    let h3 = pick(HOBBIES, 24);
    if (h2 === h1) h2 = HOBBIES[(HOBBIES.indexOf(h1) + 7) % HOBBIES.length];
    if (h3 === h1 || h3 === h2) h3 = HOBBIES[(HOBBIES.indexOf(h1) + 19) % HOBBIES.length];
    hobbies = [h1, h2, h3];
  }

  const personality = baseAttr.personality || pick(PERSONALITIES, 28);
  const tone = baseAttr.tone || pick(WRITING_STYLES, 32);
  const firstPerson = baseAttr.firstPerson || pick(FIRST_PERSONS, 36);
  const personaId = crypto.createHash('md5').update(seedStr).digest('hex').slice(0, 10);

  return {
    personaId,
    gender,
    age,
    job,
    location,
    hobbies,
    personality,
    tone,
    firstPerson
  };
}

function hasJapaneseScript(text) {
  return /[\u3040-\u30ff\u3400-\u9fff]/.test(String(text || ''));
}

const ENGLISH_PLACES = {
  us: ['Brooklyn', 'Austin', 'Portland', 'Chicago', 'Denver', 'Seattle'],
  gb: ['Manchester', 'Bristol', 'Brighton', 'Edinburgh', 'Leeds'],
  ca: ['Toronto', 'Vancouver', 'Ottawa', 'Calgary', 'Montreal'],
  au: ['Melbourne', 'Sydney', 'Brisbane', 'Adelaide', 'Perth'],
};
const ENGLISH_JOBS = ['cafe shift lead', 'bookshop clerk', 'junior designer', 'high school teacher', 'paramedic', 'bike mechanic', 'museum guide', 'baker'];
const ENGLISH_HOBBIES = ['weekend baking', 'secondhand records', 'morning runs', 'film photography', 'community gardens', 'thrift furniture', 'bird watching', 'pub quizzes'];
const ENGLISH_TONES = ['dry and short', 'warm and specific', 'quiet and observational', 'casual and a little self-deprecating'];
const ENGLISH_SCENES = ['a small errand that took longer than expected', 'something noticed on the walk home', 'a meal that turned out better than planned', 'a hobby that ate the whole evening'];

function englishVoice(token, accountData, baseAttr) {
  const country = resolveExitCountry(accountData);
  const seed = crypto.createHash('sha256').update(String(token || 'en') + ':' + country).digest();
  const pick = (arr, offset) => arr[seed[offset % seed.length] % arr.length];
  const places = ENGLISH_PLACES[country] || ENGLISH_PLACES.us;
  const ageDigits = String(baseAttr.age || '').match(/\d{2}/);
  const age = ageDigits ? ageDigits[0] : '32';
  const gender = /女/.test(String(baseAttr.gender || '')) ? 'woman' : 'man';
  const storedLocation = String(baseAttr.location || '');
  return {
    country,
    location: hasJapaneseScript(storedLocation) ? pick(places, 1) : (storedLocation || pick(places, 1)),
    age,
    gender,
    job: hasJapaneseScript(baseAttr.job) ? pick(ENGLISH_JOBS, 2) : (baseAttr.job || pick(ENGLISH_JOBS, 2)),
    hobbies: (Array.isArray(baseAttr.hobbies) && baseAttr.hobbies.some(hasJapaneseScript)) || !baseAttr.hobbies
      ? [pick(ENGLISH_HOBBIES, 3), pick(ENGLISH_HOBBIES, 4)]
      : baseAttr.hobbies.slice(0, 3),
    personality: hasJapaneseScript(baseAttr.personality) ? 'notices small ordinary things and does not announce them' : (baseAttr.personality || 'notices small ordinary things'),
    tone: hasJapaneseScript(baseAttr.tone) ? pick(ENGLISH_TONES, 5) : (baseAttr.tone || pick(ENGLISH_TONES, 5)),
    firstPerson: 'I',
    scene: pick(ENGLISH_SCENES, 6),
  };
}

function localTimeContext(accountData, english) {
  if (!english) return getJstTimeSlotContext();
  const tz = resolveAccountLocaleConfig(accountData).timezone || 'America/New_York';
  const hour = parseInt(new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }), 10);
  const weekday = new Date().toLocaleDateString('en-US', { timeZone: tz, weekday: 'long' });
  if (hour >= 5 && hour < 11) return { slot: `morning (${weekday})`, scene: 'getting ready, the first coffee, the start of the day' };
  if (hour >= 11 && hour < 17) return { slot: `afternoon (${weekday})`, scene: 'a break in the middle of the day' };
  if (hour >= 17 && hour < 22) return { slot: `evening (${weekday})`, scene: 'heading home, dinner, the evening hobby' };
  return { slot: `late (${weekday})`, scene: 'the quiet hour before sleep' };
}

function cleanEnglishName(raw) {
  const name = String(raw || '').split(/[|/／:：]/)[0].replace(/[^A-Za-z .'-]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 3) return 'Alex Morgan';
  return name.slice(0, 28);
}

function getJstTimeSlotContext() {
  const now = new Date();
  const jstHour = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo', hour: 'numeric', hour12: false }), 10);
  const jstMin = parseInt(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo', minute: 'numeric' }), 10);
  const weekday = now.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', weekday: 'long' });

  if (jstHour >= 5 && jstHour < 10) return { slot: `朝（${weekday} ${jstHour}時台）`, scene: '朝の支度・通勤通学・朝のコーヒー・1日の始まり' };
  if (jstHour >= 10 && jstHour < 14) return { slot: `昼（${weekday} ${jstHour}時台）`, scene: '昼休み・ランチ・午前の作業ひと段落・昼下がりの空気' };
  if (jstHour >= 14 && jstHour < 18) return { slot: `午後〜夕方（${weekday} ${jstHour}時台）`, scene: '午後の集中タイム・小休憩のおやつや飲み物・夕暮れ前の空気' };
  if (jstHour >= 18 && jstHour < 22) return { slot: `夜（${weekday} ${jstHour}時台）`, scene: '仕事や予定の終わり・帰宅途中の寄り道・夕食・夜の趣味時間' };
  return { slot: `深夜前（${weekday} ${jstHour}:${String(jstMin).padStart(2, '0')}頃）`, scene: '寝る前のリラックスタイム・静かな夜の読書や映画・1日の振り返り' };
}

// 100% Gemini API に生成させるコア関数（プログラム固定の定型文は一切返さない）
async function callGeminiStrictJson(promptText, temperature = 0.95) {
  if (!hasXaiKey()) throw new Error('XAI_API_KEY が .env に設定されていません');
  {
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { parsed, modelName } = await completeJson({
          tier: 'nurture',
          prompt: promptText,
          temperature
        });
        if (parsed && typeof parsed === 'object') return { parsed, modelName };
      } catch (e) {
        lastErr = e;
        await new Promise(r => setTimeout(r, 800 * attempt));
      }
    }
    throw new Error(`Grok生成失敗: ${lastErr ? lastErr.message : 'unknown'}`);
  }
}

// 10万アカウント用の完全ユニーク初期プロフィール生成（100% Gemini生成）
async function generateUniquePersonaProfileViaGemini(token, existingNamesSet = new Set(), customAccountData = {}) {
  const english = isSetupForeignAccount(customAccountData);
  const attr = ensureAccountPersonality(token, customAccountData);
  const voice = english ? englishVoice(token, customAccountData, attr) : null;
  const randTopic = MICRO_TOPICS[Math.floor(Math.random() * MICRO_TOPICS.length)];
  const nonce = crypto.randomBytes(4).toString('hex');

  for (let tryIdx = 1; tryIdx <= 3; tryIdx++) {
    const prompt = english ? `Create one ordinary person who lives in ${voice.location} and posts on X in English only.
DNA ${attr.personaId}-${nonce}. Age ${voice.age}. ${voice.gender}. Job: ${voice.job}. Interests: ${voice.hobbies.join(', ')}. Tone: ${voice.tone}.

Rules:
1. name, bio, location, and tweet must be English. No Japanese characters.
2. name is a normal personal name, letters and spaces only, like "Maya Foster".
3. No hashtags, URLs, or @mentions.
4. bio is 80 to 140 characters. tweet is 40 to 110 characters. Both sound like a private diary, not a brand.

JSON:
{ "name": "Maya Foster", "bio": "English bio", "location": "${voice.location}", "tweet": "English tweet" }`
    : `あなたは10万人規模の日本人X(Twitter)アカウント群のキャラクター設計AIです。
以下の固有DNAを持つ実在感あふれる日本人個人の「表示名(name)」「自己紹介(bio)」「最初の日常ツイート(tweet)」をJSON形式で作成してください。

【固有ペルソナDNA (ID: ${attr.personaId}-${nonce})】
- 居住地・生活圏: ${attr.location}
- 年齢・属性: ${attr.age}（${attr.gender}）
- 職業: ${attr.job}
- 趣味・好きなもの: ${attr.hobbies.join(' / ')}
- 性格・価値観: ${attr.personality}
- 文体・口調ルール: ${attr.tone}
- 一人称ルール: ${attr.firstPerson}
- 初回ポストの切り口: ${randTopic}

【厳守ルール】
1. 他のアカウントと絶対に被らない個性的な表現にすること（定番すぎる名前や頻出語「はるか」「たくみ」「けんた」「そうた」「槙野」「槇村」「槙人」「すずの」「すず乃」「律」「千冬」「志乃」は使用禁止。毎回まったく違う珍しい苗字や名前を使うこと）。
2. ハッシュタグ(#)・URL・@メンションは一切含めないこと。
3. AIっぽさ・宣伝っぽさを完全に消し、本物の日本人が日常の記録用に作ったアカウントに見える自然な文章にすること。

出力JSONスキーマ:
{
  "name": "記号（｜や/や・など）を一切含まない自然な日本人の名前またはニックネーム（漢字・ひらがな・カタカナのみ、2〜8文字、例：ちづる、佐伯 朔、みなみ、たかし）",
  "bio": "個性が伝わる自然な自己紹介文（65〜125文字）",
  "location": "${attr.location.split('・')[0]}",
  "tweet": "この人物の文体で書かれた最初の何気ないつぶやき（35〜85文字）"
}`;

    const { parsed, modelName } = await callGeminiStrictJson(prompt, 0.98);
    if (parsed && parsed.name && parsed.bio && parsed.tweet) {
      if (english && (hasJapaneseScript(parsed.name) || hasJapaneseScript(parsed.bio) || hasJapaneseScript(parsed.tweet))) {
        continue;
      }
      let cleanName;
      let location;
      let attributes;
      if (english) {
        cleanName = cleanEnglishName(parsed.name);
        location = hasJapaneseScript(parsed.location) ? voice.location : String(parsed.location || voice.location).trim();
        attributes = { ...attr, ...voice, location, gender: voice.gender, age: voice.age, job: voice.job, hobbies: voice.hobbies, tone: voice.tone, firstPerson: 'I' };
      } else {
        let rawName = String(parsed.name || '').split(/[｜|\/／・:：~〜\-ー]/)[0].trim();
        rawName = rawName.replace(/[^\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF\u3005a-zA-Z\s]/g, '').trim();
        cleanName = (rawName.length >= 2 ? rawName.slice(0, 10) : 'ちづる');
        location = String(parsed.location || attr.location.split('・')[0]).trim();
        attributes = attr;
      }
      if (!existingNamesSet.has(cleanName) || tryIdx === 3) {
        existingNamesSet.add(cleanName);
        console.log(`  🤖 [Gemini完全生成 (${modelName})] 固有DNA(${attr.personaId}) -> 表示名: ${cleanName}`);
        return {
          name: cleanName,
          bio: String(parsed.bio).replace(/#\S+/g, '').trim(),
          location,
          tweet: String(parsed.tweet).replace(/#\S+/g, '').trim(),
          attributes
        };
      }
    }
  }
  throw new Error('Geminiによる初期ペルソナ生成が完了しませんでした');
}

// 10万アカウント用の日常ツイート・リプライ・リプライ返し生成（100% Gemini生成・過去ログ重複防止付き）
async function generateAIContentViaGemini(token, accountData, type = 'tweet', targetTweetSnippet = '', partnerName = '') {
  if (isSetupForeignAccount(accountData)) {
    const attr = ensureAccountPersonality(token, accountData);
    const voice = englishVoice(token, accountData, attr);
    const timeCtx = localTimeContext(accountData, true);
    const displayName = hasJapaneseScript(accountData.name) ? 'the account owner' : (accountData.name || 'the account owner');
    const recentTweets = Array.isArray(accountData.recentTweets) ? accountData.recentTweets.slice(-5) : (accountData.lastTweetText ? [accountData.lastTweetText] : []);
    const avoidList = recentTweets.length > 0 ? `\nDo not repeat these recent posts:\n- ${recentTweets.join('\n- ')}` : '';
    let prompt;
    if (type === 'tweet') {
      prompt = `You are the real person behind the X account "${displayName}" in ${voice.location}.
Age ${voice.age}, ${voice.gender}, ${voice.job}. Interests: ${voice.hobbies.join(', ')}. Tone: ${voice.tone}.
Time: ${timeCtx.slot}. Scene hint: ${voice.scene}.
Write one private diary post in English only. No Japanese characters, hashtags, URLs, @mentions, or a character count. 40 to 110 characters.${avoidList}
JSON: { "text": "the post" }`;
    } else if (type === 'reply_back') {
      prompt = `You are "${displayName}" in ${voice.location}, tone ${voice.tone}.
Someone replied: "${String(targetTweetSnippet || '').slice(0, 140)}"
Write one short English reply in your own voice. No Japanese characters, hashtags, URLs, or @names. 20 to 80 characters.
JSON: { "text": "the reply" }`;
    } else {
      prompt = `You are "${displayName}" in ${voice.location}, tone ${voice.tone}.
You saw this post: "${String(targetTweetSnippet || '').slice(0, 140)}"
Write one short English reply about a specific detail in it. No Japanese characters, hashtags, URLs, or @names. 20 to 80 characters.
JSON: { "text": "the reply" }`;
    }
    for (let attempt = 1; attempt <= 2; attempt++) {
      const { parsed } = await callGeminiStrictJson(prompt, 0.95);
      let text = (parsed && parsed.text) ? String(parsed.text).replace(/[#＃]\S+/g, '').replace(/[@＠]\w+/g, '').replace(/https?:\/\/\S+/gi, '').trim() : '';
      text = sanitizePostOrReplyText(text);
      if (text && !hasJapaneseScript(text)) return text;
    }
    throw new Error('英語の投稿本文が生成できませんでした');
  }
  const attr = ensureAccountPersonality(token, accountData);
  const timeCtx = getJstTimeSlotContext();
  const displayName = accountData.name || '日本人ユーザー';
  const microTopic = MICRO_TOPICS[Math.floor(Math.random() * MICRO_TOPICS.length)];
  const recentTweets = Array.isArray(accountData.recentTweets) ? accountData.recentTweets.slice(-5) : (accountData.lastTweetText ? [accountData.lastTweetText] : []);
  const avoidListStr = recentTweets.length > 0 ? `\n【自身の直近の過去投稿（これらと似た表現・同じ話題は避けること）】\n- ${recentTweets.join('\n- ')}` : '';

  let prompt = '';
  if (type === 'tweet') {
    prompt = `あなたはX(Twitter)の日本人個人アカウント「${displayName}」本人です。
以下の固有キャラクター設定になりきって、今この瞬間の自然なつぶやきを1つだけ作成してください。

【あなたの固有設定 (DNA: ${attr.personaId})】
- 居住地・生活圏: ${attr.location}
- 年齢・性別・職業: ${attr.age} / ${attr.gender} / ${attr.job}
- 趣味・関心: ${attr.hobbies.join('、')}
- 性格: ${attr.personality}
- 文体・口調: ${attr.tone}
- 一人称: ${attr.firstPerson}
- 現在の時間・シチュエーション: ${timeCtx.slot}（${timeCtx.scene}）
- 今回の着眼点ヒント: 「${microTopic}」または趣味・日常の具体的なワンシーン${avoidListStr}

【絶対条件】
- プログラムの定型文のようなありきたりな挨拶（「今日も一日頑張ろう」「ひと息ついてコーヒー飲んでる」等のテンプレ表現）は禁止。
- その人ならではの具体的なディテール（五感・空気感・ちょっとした本音）を1つ入れること。
- URL・ハッシュタグ(#)・@メンションは一切含めないこと（35〜90文字程度）。
- 【最重要】「（80文字）」のような文字数カウント注記や解説は絶対に出力に含めず、本文のみを出力すること。

JSON形式で出力: { "text": "つぶやき本文" }`;
  } else if (type === 'reply_back') {
    prompt = `あなたはX(Twitter)の日本人個人アカウント「${displayName}」本人です。
【あなたの設定】${attr.age}・${attr.job} / 趣味: ${attr.hobbies.join('、')} / 性格: ${attr.personality} / 口調: ${attr.tone}

あなたの投稿に対して、${partnerName ? partnerName + 'さんから' : '他の方から'}以下のリプライが届きました：
「${targetTweetSnippet.slice(0, 140)}」

相手のリプライ内容の具体的な言葉を受け止めつつ、あなたの口調・性格のまま自然な返信（リプライ返し）を1つ作成してください（20〜55文字程度、URL・ハッシュタグ・@ID・文字数注記は含めないこと）。
JSON形式で出力: { "text": "返信本文" }`;
  } else {
    prompt = `あなたはX(Twitter)の日本人個人アカウント「${displayName}」本人です。
【あなたの設定】${attr.age}・${attr.job} / 趣味: ${attr.hobbies.join('、')} / 性格: ${attr.personality} / 口調: ${attr.tone}

タイムラインで以下の投稿を見かけました：
「${targetTweetSnippet.slice(0, 140)}」

テンプレ的な「わかります！共感しました！」だけの浅い反応は禁止です。相手の投稿内容の具体的な部分に反応し、あなたらしい口調で自然で温かい短い共感リプライを1つ作成してください（18〜50文字程度、URL・ハッシュタグ・@ID・文字数注記は含めないこと）。
JSON形式で出力: { "text": "リプライ本文" }`;
  }

  const { parsed, modelName } = await callGeminiStrictJson(prompt, 0.95);
  let text = (parsed && parsed.text) ? String(parsed.text).replace(/[#＃]\S+/g, '').replace(/[@＠]\w+/g, '').replace(/https?:\/\/\S+/gi, '').trim() : '';
  text = sanitizePostOrReplyText(text);
  if (!text) throw new Error('Geminiが空のテキストを返しました');
  return text;
}

// BIOに英語が含まれているか判定する（日本語垢なのに英文・英単語が入っているケースを的確に捕捉）
function hasEnglishInBio(bio) {
  if (!bio || typeof bio !== 'string') return false;
  const text = bio.trim();
  if (!text) return false;

  // URLとメンションを除外
  const clean = text.replace(/https?:\/\/\S+/gi, '').replace(/@\w+/g, '').trim();
  if (!clean) return false;

  // 1. 一般的な英語の単語・前置詞・動詞・形容詞等
  const englishWords = /\b(the|a|an|is|are|was|were|in|at|on|for|to|of|with|and|from|my|me|we|you|he|she|they|it|live|living|life|love|lover|like|likes|work|worker|engineer|developer|designer|tokyo|japan|japanese|daily|hobby|photo|dm|free|happy|good|hello|welcome|official|account|fan|follow|follower|crypto|web3|music|art|coffee|dog|cat)\b/i;
  if (englishWords.test(clean)) return true;

  // 2. 連続する英単語（例: "Hello world", "Coffee lover", "Tokyo Japan"）
  if (/[a-zA-Z]{2,}\s+[a-zA-Z]{2,}/.test(clean)) return true;

  // 3. 4文字以上の英単語が含まれる場合（単独の「X」「ID」「PC」などの極小略語は除外）
  const words = clean.match(/[a-zA-Z]{4,}/g);
  if (words && words.length > 0) return true;

  // 4. 英字（アルファベット）が合計5文字以上含まれている場合
  const latinMatches = clean.match(/[a-zA-Z]/g);
  if (latinMatches && latinMatches.length >= 5) return true;

  return false;
}

// 過去の投稿（Post）の文脈から、英語が含まれるBioを自然な日本語Bioへと再設計・生成する
async function generateNewBioFromPostContextViaGemini(token, accountData, tweetSnippets = [], currentBio = '') {
  const attr = ensureAccountPersonality(token, accountData);
  const displayName = accountData.name || '日本人ユーザー';
  const cleanPosts = (Array.isArray(tweetSnippets) ? tweetSnippets : [])
    .map(t => String(t || '').trim())
    .filter(t => t.length > 0)
    .slice(-6);

  const postContextStr = cleanPosts.length > 0
    ? cleanPosts.map((p, i) => `${i + 1}. 「${p}」`).join('\n')
    : `(まだ投稿が少ないため、本人のキャラクター設定・関心から文脈を反映)`;

  const prompt = `あなたはX(Twitter)の日本人個人アカウント「${displayName}」本人です。
現在のアカウントの自己紹介(Bio)に英語が含まれているため、これまでの実際の投稿(Post)の文脈・関心・キャラクターに完全に合致した、自然で人間味あふれる【日本語の自己紹介(Bio)のみ】を新しく作成してください。

【あなたの固有プロフィール設定 (DNA: ${attr.personaId})】
- 表示名: ${displayName}
- 年齢・性別: ${attr.age} / ${attr.gender}
- 居住地・生活圏: ${attr.location}
- 職業: ${attr.job}
- 趣味・関心: ${attr.hobbies.join('、')}
- 性格・文体・口調: ${attr.personality} / ${attr.tone}
- 一人称: ${attr.firstPerson}

【これまでの実際の投稿(Post)の文脈・最近の話題】
${postContextStr}

【変更前の古い自己紹介】
${currentBio || '(英語または未設定)'}

【自己紹介(Bio)作成ルール】
1. 100% 自然な日本語で作成すること（英単語やアルファベット、英文は絶対に含めないこと）。
2. これまでの投稿内容（話題、趣味、好きなもの、口調、雰囲気）と完全に一致させ、投稿を見た人が「この人のつぶやきにぴったりのプロフィールだ」と納得するリアルな一般人のBioにすること。
3. 55文字〜115文字程度の読みやすく親しみやすい長さにすること。
4. ハッシュタグ(#)、URL、@メンションは一切含めないこと。
5. AIっぽさや定型文（「よろしくお願いします！」だけのテンプレ）を排し、本物の日本人がスマホで手入力したような素朴で温かみのある自己紹介にすること。

JSON形式で出力:
{
  "bio": "作成した日本語の自己紹介文"
}`;

  const { parsed, modelName } = await callGeminiStrictJson(prompt, 0.92);
  let newBio = (parsed && parsed.bio) ? String(parsed.bio).replace(/[#＃]\S+/g, '').replace(/[@＠]\w+/g, '').replace(/https?:\/\/\S+/gi, '').trim() : '';
  if (!newBio) {
    newBio = `${attr.location.split('・')[0]}在住の${attr.job}。${attr.hobbies.slice(0, 2).join('と')}が好き。日々の気になったことを気ままにつぶやいてます。`;
  }
  return newBio;
}

module.exports = {
  ensureAccountPersonality,
  generateUniquePersonaProfileViaGemini,
  generateAIContentViaGemini,
  hasEnglishInBio,
  generateNewBioFromPostContextViaGemini
};

const NATURAL_JP_SURNAMES = [
  '佐藤','鈴木','高橋','田中','伊藤','渡辺','山本','中村','小林','加藤',
  '吉田','山田','佐々木','山口','松本','井上','木村','林','斎藤','清水',
  '山崎','森','池田','橋本','阿部','石川','山下','中島','石井','小川',
  '前田','岡田','長谷川','藤田','後藤','近藤','村上','遠藤','青木','坂本',
  '斉藤','福田','太田','西村','藤井','金子','岡本','藤原','三浦','中野',
  '原田','小野','田村','竹内','和田','中山','石田','上田','森田','原',
  '柴田','酒井','工藤','横山','宮崎','宮本','内田','高木','安藤','谷口',
  '大野','丸山','今井','河野','藤本','村田','武田','上野','杉山','増田',
  '平野','大塚','千葉','久保','松井','小島','岩崎','桜井','野口','松尾'
];
function diversifyOverusedSurnames(nameStr) {
  const s = String(nameStr || '').trim();
  if (!s) return s;
  const overused = /^(保科|名取|保坂|保泉|保苅|保良|折居|折原|久米|久世|久我|梶原|梶谷|梶本|梶井|芦原|能登|深町|深見|富永|百瀬|槙野|槇野|槙原|槇原|槇村|槙人|槙|真紀乃|槙乃|すずの|すず乃|ふみの|ふみ乃|ふじの|しずの|しづ乃|よし乃|きりの|桐乃|志乃|佳乃|佳代乃|千景|帆波|よりこ)\s*/;
  if (overused.test(s)) {
    const pick = NATURAL_JP_SURNAMES[Math.floor(Math.random() * NATURAL_JP_SURNAMES.length)];
    return s.replace(overused, pick + ' ');
  }
  return s;
}

