/**
 * src/i18n_tg.js
 * X-Swarm Cloud Telegram Bot 12-Language Localization Engine
 * Supported: en, ja, zh, ko, ru, es, fr, de, pt, tr, vi, ar
 */

const SUPPORTED_LANGS = [
  { code: 'en', flag: '🇺🇸', name: 'English', native: 'English' },
  { code: 'ja', flag: '🇯🇵', name: 'Japanese', native: '日本語' },
  { code: 'zh', flag: '🇨🇳', name: 'Chinese', native: '简体中文' },
  { code: 'ko', flag: '🇰🇷', name: 'Korean', native: '한국어' },
  { code: 'ru', flag: '🇷🇺', name: 'Russian', native: 'Русский' },
  { code: 'es', flag: '🇪🇸', name: 'Spanish', native: 'Español' },
  { code: 'fr', flag: '🇫🇷', name: 'French', native: 'Français' },
  { code: 'de', flag: '🇩🇪', name: 'German', native: 'Deutsch' },
  { code: 'pt', flag: '🇧🇷', name: 'Portuguese', native: 'Português' },
  { code: 'tr', flag: '🇹🇷', name: 'Turkish', native: 'Türkçe' },
  { code: 'vi', flag: '🇻🇳', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'ar', flag: '🇸🇦', name: 'Arabic', native: 'العربية' }
];

const UI_DICT = {
  ko: {
    panelTitle: '⚡ <b>X-SWARM CLOUD — 24/7 자동화 컨트롤 패널 (🇰🇷한국어)</b>',
    plan: '📦 <b>현재 플랜:</b>',
    ip: '🌍 <b>전용 고정 ISP 프록시:</b>',
    ipAuto: '🔒 자동 할당 ($7 체험 또는 월간 플랜에서 국가 선택)',
    interval: '⏱️ <b>게시 간격:</b> 매',
    mins: '분마다',
    s1_ok: (n, m) => '✅ <b>1. 등록된 계정:</b> ' + n + '개 (최대 ' + m + '개)',
    s1_no: '❌ <b>1. 등록된 계정:</b> 없음 <i>([➕ 1. 계정 추가] 탭)</i>',
    s2_ok: (n) => '✅ <b>2. 게시물 템플릿:</b> ' + n + '개 준비됨',
    s2_no: '❌ <b>2. 게시물 템플릿:</b> 없음 <i>([✍️ 2. 게시물 설정] 탭)</i>',
    s3_ok: (b) => '✅ <b>3. 프로필(Bio) 링크:</b> <code>' + b + '</code>',
    s3_no: '⚪ <b>3. 프로필(Bio) 링크:</b> 변경 없음',
    s4_run: '🟢 <b>4. 엔진 상태:</b> <b>24/7 자동 실행 중</b>',
    s4_stop: '🔴 <b>4. 엔진 상태:</b> <b>일시 정지됨</b> <i>([▶️ 4. 자동 게시 시작] 탭)</i>',
    rules: '⚠️ <b>필수 규칙 (본인 책임):</b>\n• 간격이 짧을수록 섀도우밴 확률이 높아집니다 (~2시간 기준).\n• 반드시 구매한 일회용(Burner) 계정만 사용하세요! 첫 계정이 제한되면 0초 만에 예비 계정으로 자동 교체됩니다.',
    demo: (u, c) => '🟢 <b>실시간 공식 데모 (24/7 가동 중):</b> <a href="https://x.com/search?q=from%3A' + u + '&f=live">@' + u + '</a> (<b>' + c + '</b>회 자동 게시 / 섀도우밴 없음)',
    btn1: '➕ 1. 계정 추가 (Token)',
    btn2: '✍️ 2. 게시물 텍스트 설정',
    btn3: '🔗 3. Bio 링크 설정',
    btn4_run: '🟢 4. 실행 중 (중지)',
    btn4_stop: '▶️ 4. 자동 게시 시작',
    btnInt: (m) => '⏱️ 간격: ' + m + '분마다',
    btnIpFree: '🔒 IP: 자동 할당',
    btnIp: (l) => '🌍 IP: ' + l,
    btnStatus: '📊 내 계정 & 대기열 상태',
    btnRules: '⚖️ 면책 조항 & 규칙',
    btnGuide: '❓ 초보자 가이드',
    btnLang: '🌐 언어 선택 (12개국어)',
    btnSelfReply: '🔗 링크 분리: 본문 무링크 + 자동 답글 링크 (ON ✅)',
    btnProof: '🟢 실시간 데모: 가동 중인 봇 계정 보기 ↗',
    btnWeb: '🖥️ 웹 클라우드 대시보드 & 보안 증명 (SSO)',
    btnTrial: '🔥 $7 (24시간) 테스트 드라이브 시작 →',
    btnPlans: '💎 30일 플랜 보기 ($79 / $179 / $399)',
    btnBack: '← 컨트롤 패널로 돌아가기',
    switched: '🇰🇷 한국어로 변경되었습니다'
  },
  ru: {
    panelTitle: '⚡ <b>X-SWARM CLOUD — ПАНЕЛЬ АВТОПОСТИНГА 24/7 (🇷🇺RU)</b>',
    plan: '📦 <b>Тариф:</b>',
    ip: '🌍 <b>Выделенный Static ISP IP:</b>',
    ipAuto: '🔒 Авто-назначение (выбор страны в тесте за $7 или тарифах)',
    interval: '⏱️ <b>Интервал:</b> каждые',
    mins: 'мин.',
    s1_ok: (n, m) => '✅ <b>1. Аккаунты (Token):</b> ' + n + ' шт. (Макс. ' + m + ')',
    s1_no: '❌ <b>1. Аккаунты:</b> Нет <i>(Нажмите [➕ 1. Добавить аккаунт])</i>',
    s2_ok: (n) => '✅ <b>2. Шаблоны постов:</b> ' + n + ' шт. готово',
    s2_no: '❌ <b>2. Шаблоны постов:</b> Нет <i>(Нажмите [✍️ 2. Текст поста])</i>',
    s3_ok: (b) => '✅ <b>3. Ссылка в Bio:</b> <code>' + b + '</code>',
    s3_no: '⚪ <b>3. Ссылка в Bio:</b> Без изменений',
    s4_run: '🟢 <b>4. Статус:</b> <b>РАБОТАЕТ 24/7</b>',
    s4_stop: '🔴 <b>4. Статус:</b> <b>ПАУЗА</b> <i>(Нажмите [▶️ 4. ЗАПУСТИТЬ])</i>',
    rules: '⚠️ <b>ВАЖНЫЕ ПРАВИЛА (НА СВОЙ РИСК):</b>\n• Чем короче интервал, тем выше шанс теневого бана (~2 часа при частом постинге).\n• Используйте ТОЛЬКО покупные расходные аккаунты (auth_token)! При бане система за 0 сек переключается на резервный аккаунт.',
    demo: (u, c) => '🟢 <b>ЖИВОЕ ДЕМО (Работает 24/7):</b> <a href="https://x.com/search?q=from%3A' + u + '&f=live">@' + u + '</a> (<b>' + c + '</b> авто-постов / Без теневого бана)',
    btn1: '➕ 1. Добавить аккаунт',
    btn2: '✍️ 2. Текст поста',
    btn3: '🔗 3. Ссылка в Bio',
    btn4_run: '🟢 4. В РАБОТЕ (Стоп)',
    btn4_stop: '▶️ 4. ЗАПУСТИТЬ АВТОПОСТИНГ',
    btnInt: (m) => '⏱️ Интервал: ' + m + ' мин.',
    btnIpFree: '🔒 IP: Авто-выбор',
    btnIp: (l) => '🌍 IP: ' + l,
    btnStatus: '📊 Мои аккаунты и очередь',
    btnRules: '⚖️ Отказ от ответственности',
    btnGuide: '❓ Гайд для новичков',
    btnLang: '🌐 Язык / Language (12)',
    btnSelfReply: '🔗 Анти-бан ссылок: Ссылка в авто-ответе (ВКЛ ✅)',
    btnProof: '🟢 Живое демо: Проверить наш рабочий аккаунт ↗',
    btnWeb: '🖥️ Веб-панель управления и защита (SSO)',
    btnTrial: '🔥 Тест-драйв на 24 часа за $7 →',
    btnPlans: '💎 Тарифы на 30 дней ($79 / $179 / $399)',
    btnBack: '← Назад в панель управления',
    switched: '🇷🇺 Язык переключен на Русский'
  },
  es: {
    panelTitle: '⚡ <b>X-SWARM CLOUD — PANEL DE CONTROL 24/7 (🇪🇸ES)</b>',
    plan: '📦 <b>Plan:</b>',
    ip: '🌍 <b>Proxy ISP Estático Dedicado:</b>',
    ipAuto: '🔒 Asignación automática (elige país en prueba de $7 o planes)',
    interval: '⏱️ <b>Intervalo:</b> Cada',
    mins: 'min',
    s1_ok: (n, m) => '✅ <b>1. Cuentas Burner:</b> ' + n + ' cargadas (Máx ' + m + ')',
    s1_no: '❌ <b>1. Cuentas Burner:</b> Ninguna <i>(Toca [➕ 1. Añadir Cuenta])</i>',
    s2_ok: (n) => '✅ <b>2. Textos de Post:</b> ' + n + ' plantillas listas',
    s2_no: '❌ <b>2. Textos de Post:</b> Ninguno <i>(Toca [✍️ 2. Texto del Post])</i>',
    s3_ok: (b) => '✅ <b>3. Enlace en Bio:</b> <code>' + b + '</code>',
    s3_no: '⚪ <b>3. Enlace en Bio:</b> Sin cambios',
    s4_run: '🟢 <b>4. Estado:</b> <b>ACTIVO 24/7</b>',
    s4_stop: '🔴 <b>4. Estado:</b> <b>PAUSADO</b> <i>(Toca [▶️ 4. INICIAR])</i>',
    rules: '⚠️ <b>REGLAS IMPORTANTES:</b>\n• Intervalos más cortos = mayor probabilidad de shadowban (~2h promedio).\n• ¡Usa SOLO cuentas desechables compradas (auth_token)! Si una cae en shadowban, el sistema cambia a tu cuenta de respaldo en 0s.',
    demo: (u, c) => '🟢 <b>DEMO EN VIVO (Activo 24/7):</b> <a href="https://x.com/search?q=from%3A' + u + '&f=live">@' + u + '</a> (<b>' + c + '</b> posts / Sin Shadowban)',
    btn1: '➕ 1. Añadir Cuenta',
    btn2: '✍️ 2. Texto del Post',
    btn3: '🔗 3. Enlace en Bio',
    btn4_run: '🟢 4. ACTIVO (Pausar)',
    btn4_stop: '▶️ 4. INICIAR AUTO-POST',
    btnInt: (m) => '⏱️ Intervalo: Cada ' + m + 'm',
    btnIpFree: '🔒 IP: Automática',
    btnIp: (l) => '🌍 IP: ' + l,
    btnStatus: '📊 Mis Cuentas y Cola',
    btnRules: '⚖️ Reglas y Aviso Legal',
    btnGuide: '❓ Guía Básica',
    btnLang: '🌐 Idioma / Language (12)',
    btnSelfReply: '🔗 Modo Anti-Shadowban: Enlace en Auto-Respuesta (ON ✅)',
    btnProof: '🟢 Prueba en Vivo: Ver Cuenta Bot Activa ↗',
    btnWeb: '🖥️ Panel Web en la Nube y Seguridad (SSO)',
    btnTrial: '🔥 Prueba de 24h por $7 (100% descontable) →',
    btnPlans: '💎 Planes de 30 Días ($79 / $179 / $399)',
    btnBack: '← Volver al Panel',
    switched: '🇪🇸 Idioma cambiado a Español'
  },
  fr: {
    panelTitle: '⚡ <b>X-SWARM CLOUD — PANNEAU DE CONTRÔLE 24/7 (🇫🇷FR)</b>',
    plan: '📦 <b>Forfait :</b>',
    ip: '🌍 <b>Proxy ISP Statique Dédié :</b>',
    ipAuto: '🔒 Attribution auto (choix du pays avec essai $7 ou forfait)',
    interval: '⏱️ <b>Intervalle :</b> Toutes les',
    mins: 'min',
    s1_ok: (n, m) => '✅ <b>1. Comptes Burner :</b> ' + n + ' chargés (Max ' + m + ')',
    s1_no: '❌ <b>1. Comptes Burner :</b> Aucun <i>(Appuyez sur [➕ 1. Ajouter Compte])</i>',
    s2_ok: (n) => '✅ <b>2. Textes de Post :</b> ' + n + ' modèles prêts',
    s2_no: '❌ <b>2. Textes de Post :</b> Aucun <i>(Appuyez sur [✍️ 2. Texte du Post])</i>',
    s3_ok: (b) => '✅ <b>3. Lien Bio :</b> <code>' + b + '</code>',
    s3_no: '⚪ <b>3. Lien Bio :</b> Inchangé',
    s4_run: '🟢 <b>4. Statut :</b> <b>EN COURS 24/7</b>',
    s4_stop: '🔴 <b>4. Statut :</b> <b>EN PAUSE</b> <i>(Appuyez sur [▶️ 4. DÉMARRER])</i>',
    rules: '⚠️ <b>RÈGLES IMPORTANTES :</b>\n• Intervalles courts = risque accru de shadowban (~2h en moyenne).\n• Utilisez UNIQUEMENT des comptes jetables achetés (auth_token) ! Remplacement automatique en 0s en cas de shadowban.',
    demo: (u, c) => '🟢 <b>DÉMO EN DIRECT (24/7) :</b> <a href="https://x.com/search?q=from%3A' + u + '&f=live">@' + u + '</a> (<b>' + c + '</b> posts / Zéro Shadowban)',
    btn1: '➕ 1. Ajouter Compte',
    btn2: '✍️ 2. Texte du Post',
    btn3: '🔗 3. Lien Bio',
    btn4_run: '🟢 4. ACTIF (Arrêter)',
    btn4_stop: '▶️ 4. DÉMARRER AUTO-POST',
    btnInt: (m) => '⏱️ Intervalle : ' + m + 'm',
    btnIpFree: '🔒 IP : Auto',
    btnIp: (l) => '🌍 IP : ' + l,
    btnStatus: '📊 Mes Comptes & File',
    btnRules: '⚖️ Conditions & Risques',
    btnGuide: '❓ Guide Débutant',
    btnLang: '🌐 Langue / Language (12)',
    btnSelfReply: '🔗 Anti-Shadowban : Lien en Auto-Réponse (ACTIF ✅)',
    btnProof: '🟢 Preuve Live : Voir notre Bot actif sur X ↗',
    btnWeb: '🖥️ Console Web Cloud & Sécurité (SSO)',
    btnTrial: '🔥 Essai 24h à $7 (100% déduit sur 30j) →',
    btnPlans: '💎 Forfaits 30 Jours ($79 / $179 / $399)',
    btnBack: '← Retour au Panneau',
    switched: '🇫🇷 Langue changée en Français'
  },
  de: {
    panelTitle: '⚡ <b>X-SWARM CLOUD — 24/7 STEUERZENTRALE (🇩🇪DE)</b>',
    plan: '📦 <b>Tarif:</b>',
    ip: '🌍 <b>Dedizierter Static ISP Proxy:</b>',
    ipAuto: '🔒 Automatisch (Länderauswahl im $7 Test oder Monatsplan)',
    interval: '⏱️ <b>Intervall:</b> Alle',
    mins: 'Min.',
    s1_ok: (n, m) => '✅ <b>1. Burner-Konten:</b> ' + n + ' geladen (Max ' + m + ')',
    s1_no: '❌ <b>1. Burner-Konten:</b> Keine <i>([➕ 1. Konto hinzufügen] tippen)</i>',
    s2_ok: (n) => '✅ <b>2. Post-Texte:</b> ' + n + ' Vorlagen bereit',
    s2_no: '❌ <b>2. Post-Texte:</b> Keine <i>([✍️ 2. Post-Text] tippen)</i>',
    s3_ok: (b) => '✅ <b>3. Bio-Link:</b> <code>' + b + '</code>',
    s3_no: '⚪ <b>3. Bio-Link:</b> Unverändert',
    s4_run: '🟢 <b>4. Status:</b> <b>LÄUFT 24/7</b>',
    s4_stop: '🔴 <b>4. Status:</b> <b>PAUSIERT</b> <i>([▶️ 4. STARTEN] tippen)</i>',
    rules: '⚠️ <b>WICHTIGE REGELN:</b>\n• Kürzere Intervalle = höheres Shadowban-Risiko (~2 Std. Richtwert).\n• Nutzen Sie NUR gekaufte Wegwerf-Accounts (auth_token)! Bei Shadowban wechselt das System in 0 Sek. zum Backup-Account.',
    demo: (u, c) => '🟢 <b>LIVE-DEMO (Läuft 24/7):</b> <a href="https://x.com/search?q=from%3A' + u + '&f=live">@' + u + '</a> (<b>' + c + '</b> Posts / Kein Shadowban)',
    btn1: '➕ 1. Konto hinzufügen',
    btn2: '✍️ 2. Post-Text setzen',
    btn3: '🔗 3. Bio-Link setzen',
    btn4_run: '🟢 4. AKTIV (Stopp)',
    btn4_stop: '▶️ 4. AUTO-POST STARTEN',
    btnInt: (m) => '⏱️ Intervall: Alle ' + m + 'm',
    btnIpFree: '🔒 IP: Automatisch',
    btnIp: (l) => '🌍 IP: ' + l,
    btnStatus: '📊 Konten & Warteschlange',
    btnRules: '⚖️ Haftungsausschluss',
    btnGuide: '❓ Anfänger-Guide',
    btnLang: '🌐 Sprache / Language (12)',
    btnSelfReply: '🔗 Anti-Shadowban: Link als Auto-Antwort (AKTIV ✅)',
    btnProof: '🟢 Live-Beweis: Aktiven Bot auf X prüfen ↗',
    btnWeb: '🖥️ Web-Cloud-Konsole & Sicherheit (SSO)',
    btnTrial: '🔥 $7 (24h) Testfahrt starten →',
    btnPlans: '💎 30-Tage-Pläne ($79 / $179 / $399)',
    btnBack: '← Zurück zum Menü',
    switched: '🇩🇪 Sprache auf Deutsch geändert'
  },
  pt: {
    panelTitle: '⚡ <b>X-SWARM CLOUD — PAINEL DE CONTROLE 24/7 (🇧🇷PT)</b>',
    plan: '📦 <b>Plano:</b>',
    ip: '🌍 <b>Proxy ISP Estático Dedicado:</b>',
    ipAuto: '🔒 Automático (escolha o país no teste de $7 ou plano mensal)',
    interval: '⏱️ <b>Intervalo:</b> A cada',
    mins: 'min',
    s1_ok: (n, m) => '✅ <b>1. Contas Burner:</b> ' + n + ' carregadas (Máx ' + m + ')',
    s1_no: '❌ <b>1. Contas Burner:</b> Nenhuma <i>(Toque em [➕ 1. Adicionar Conta])</i>',
    s2_ok: (n) => '✅ <b>2. Textos de Post:</b> ' + n + ' modelos prontos',
    s2_no: '❌ <b>2. Textos de Post:</b> Nenhum <i>(Toque em [✍️ 2. Definir Post])</i>',
    s3_ok: (b) => '✅ <b>3. Link da Bio:</b> <code>' + b + '</code>',
    s3_no: '⚪ <b>3. Link da Bio:</b> Sem alteração',
    s4_run: '🟢 <b>4. Status:</b> <b>RODANDO 24/7</b>',
    s4_stop: '🔴 <b>4. Status:</b> <b>PAUSADO</b> <i>(Toque em [▶️ 4. INICIAR])</i>',
    rules: '⚠️ <b>REGRAS IMPORTANTES:</b>\n• Intervalos curtos = maior risco de shadowban (~2h em média).\n• Use APENAS contas descartáveis compradas (auth_token)! Troca automática em 0s para conta reserva se houver shadowban.',
    demo: (u, c) => '🟢 <b>DEMO AO VIVO (24/7):</b> <a href="https://x.com/search?q=from%3A' + u + '&f=live">@' + u + '</a> (<b>' + c + '</b> posts / Sem Shadowban)',
    btn1: '➕ 1. Adicionar Conta',
    btn2: '✍️ 2. Definir Post',
    btn3: '🔗 3. Link da Bio',
    btn4_run: '🟢 4. ATIVO (Parar)',
    btn4_stop: '▶️ 4. INICIAR AUTO-POST',
    btnInt: (m) => '⏱️ Intervalo: ' + m + 'm',
    btnIpFree: '🔒 IP: Automático',
    btnIp: (l) => '🌍 IP: ' + l,
    btnStatus: '📊 Minhas Contas e Fila',
    btnRules: '⚖️ Termos e Regras',
    btnGuide: '❓ Guia Iniciante',
    btnLang: '🌐 Idioma / Language (12)',
    btnSelfReply: '🔗 Anti-Shadowban: Link na Auto-Resposta (ATIVO ✅)',
    btnProof: '🟢 Prova ao Vivo: Ver Bot Ativo no X ↗',
    btnWeb: '🖥️ Painel Web Cloud & Segurança (SSO)',
    btnTrial: '🔥 Iniciar Teste de 24h por $7 →',
    btnPlans: '💎 Planos de 30 Dias ($79 / $179 / $399)',
    btnBack: '← Voltar ao Painel',
    switched: '🇧🇷 Idioma alterado para Português'
  },
  tr: {
    panelTitle: '⚡ <b>X-SWARM CLOUD — 7/24 KONTROL PANELİ (🇹🇷TR)</b>',
    plan: '📦 <b>Paket:</b>',
    ip: '🌍 <b>Özel Statik ISP Proxy:</b>',
    ipAuto: '🔒 Otomatik Atama ($7 deneme veya aylık pakette ülke seçin)',
    interval: '⏱️ <b>Gönderi Aralığı:</b> Her',
    mins: 'dk',
    s1_ok: (n, m) => '✅ <b>1. Burner Hesaplar:</b> ' + n + ' yüklendi (Maks ' + m + ')',
    s1_no: '❌ <b>1. Burner Hesaplar:</b> Yok <i>([➕ 1. Hesap Ekle] dokunun)</i>',
    s2_ok: (n) => '✅ <b>2. Gönderi Metinleri:</b> ' + n + ' şablon hazır',
    s2_no: '❌ <b>2. Gönderi Metinleri:</b> Yok <i>([✍️ 2. Metin Ayarla] dokunun)</i>',
    s3_ok: (b) => '✅ <b>3. Bio Linki:</b> <code>' + b + '</code>',
    s3_no: '⚪ <b>3. Bio Linki:</b> Değiştirilmedi',
    s4_run: '🟢 <b>4. Durum:</b> <b>7/24 ÇALIŞIYOR</b>',
    s4_stop: '🔴 <b>4. Durum:</b> <b>DURAKLATILDI</b> <i>([▶️ 4. BAŞLAT] dokunun)</i>',
    rules: '⚠️ <b>ÖNEMLİ KURALLAR:</b>\n• Kısa aralıklar shadowban riskini artırır (~2 saat ortalama).\n• SADECE satın alınan tek kullanımlık (auth_token) hesapları kullanın! Shadowban durumunda 0 saniyede yedek hesaba geçer.',
    demo: (u, c) => '🟢 <b>CANLI DEMO (7/24 Aktif):</b> <a href="https://x.com/search?q=from%3A' + u + '&f=live">@' + u + '</a> (<b>' + c + '</b> gönderi / Shadowban Yok)',
    btn1: '➕ 1. Hesap Ekle (Token)',
    btn2: '✍️ 2. Gönderi Metni',
    btn3: '🔗 3. Bio Linki',
    btn4_run: '🟢 4. AKTİF (Durdur)',
    btn4_stop: '▶️ 4. OTOMATİK PAYLAŞIMI BAŞLAT',
    btnInt: (m) => '⏱️ Aralık: Her ' + m + 'dk',
    btnIpFree: '🔒 IP: Otomatik',
    btnIp: (l) => '🌍 IP: ' + l,
    btnStatus: '📊 Hesaplarım ve Sıra',
    btnRules: '⚖️ Kurallar ve Yasal Uyarı',
    btnGuide: '❓ Başlangıç Rehberi',
    btnLang: '🌐 Dil / Language (12)',
    btnSelfReply: '🔗 Anti-Shadowban: Linki Otomatik Yanıta Koy (AKTİF ✅)',
    btnProof: '🟢 Canlı Kanıt: Aktif Bot Hesabımızı Gör ↗',
    btnWeb: '🖥️ Web Bulut Paneli & Güvenlik (SSO)',
    btnTrial: '🔥 $7 (24 Saat) Test Sürüşünü Başlat →',
    btnPlans: '💎 30 Günlük Paketler ($79 / $179 / $399)',
    btnBack: '← Panele Dön',
    switched: '🇹🇷 Dil Türkçe olarak değiştirildi'
  },
  vi: {
    panelTitle: '⚡ <b>X-SWARM CLOUD — BẢNG ĐIỀU KHIỂN 24/7 (🇻🇳VI)</b>',
    plan: '📦 <b>Gói hiện tại:</b>',
    ip: '🌍 <b>Proxy ISP Tĩnh Riêng Biệt:</b>',
    ipAuto: '🔒 Tự động gán (chọn quốc gia ở gói dùng thử $7 hoặc gói tháng)',
    interval: '⏱️ <b>Chu kỳ đăng:</b> Mỗi',
    mins: 'phút',
    s1_ok: (n, m) => '✅ <b>1. Tài khoản Token:</b> Đã thêm ' + n + ' (Tối đa ' + m + ')',
    s1_no: '❌ <b>1. Tài khoản Token:</b> Chưa có <i>(Bấm [➕ 1. Thêm Acc])</i>',
    s2_ok: (n) => '✅ <b>2. Nội dung bài đăng:</b> ' + n + ' mẫu sẵn sàng',
    s2_no: '❌ <b>2. Nội dung bài đăng:</b> Chưa có <i>(Bấm [✍️ 2. Cài bài đăng])</i>',
    s3_ok: (b) => '✅ <b>3. Link Bio:</b> <code>' + b + '</code>',
    s3_no: '⚪ <b>3. Link Bio:</b> Giữ nguyên',
    s4_run: '🟢 <b>4. Trạng thái:</b> <b>ĐANG CHẠY 24/7</b>',
    s4_stop: '🔴 <b>4. Trạng thái:</b> <b>ĐANG TẠM DỪNG</b> <i>(Bấm [▶️ 4. BẮT ĐẦU])</i>',
    rules: '⚠️ <b>QUY TẮC QUAN TRỌNG:</b>\n• Chu kỳ càng ngắn, tỷ lệ dính shadowban càng cao (~2 giờ).\n• CHỈ sử dụng acc phụ mua ngoài (auth_token)! Tự động đổi sang acc dự phòng trong 0s khi bị hạn chế.',
    demo: (u, c) => '🟢 <b>DEMO TRỰC TIẾP (24/7):</b> <a href="https://x.com/search?q=from%3A' + u + '&f=live">@' + u + '</a> (<b>' + c + '</b> bài đăng / Không Shadowban)',
    btn1: '➕ 1. Thêm Acc (Token)',
    btn2: '✍️ 2. Cài bài đăng',
    btn3: '🔗 3. Cài Link Bio',
    btn4_run: '🟢 4. ĐANG CHẠY (Dừng)',
    btn4_stop: '▶️ 4. BẮT ĐẦU AUTO-POST',
    btnInt: (m) => '⏱️ Chu kỳ: ' + m + ' phút',
    btnIpFree: '🔒 IP: Tự động',
    btnIp: (l) => '🌍 IP: ' + l,
    btnStatus: '📊 Tài khoản & Hàng đợi',
    btnRules: '⚖️ Miễn trừ trách nhiệm',
    btnGuide: '❓ Hướng dẫn người mới',
    btnLang: '🌐 Ngôn ngữ / Language (12)',
    btnSelfReply: '🔗 Chống Shadowban: Tự động gắn link dưới bình luận (BẬT ✅)',
    btnProof: '🟢 Bằng chứng sống: Xem Acc Bot đang chạy ↗',
    btnWeb: '🖥️ Quản lý trên Web Cloud & Bảo mật (SSO)',
    btnTrial: '🔥 Dùng thử 24h chỉ $7 (Khấu trừ 100%) →',
    btnPlans: '💎 Xem Gói 30 Ngày ($79 / $179 / $399)',
    btnBack: '← Quay lại bảng điều khiển',
    switched: '🇻🇳 Đã chuyển sang Tiếng Việt'
  },
  ar: {
    panelTitle: '⚡ <b>X-SWARM CLOUD — لوحة التحكم السحابية 24/7 (🇸🇦AR)</b>',
    plan: '📦 <b>الباقة الحالية:</b>',
    ip: '🌍 <b>بروكسي ISP ثابت مخصص:</b>',
    ipAuto: '🔒 تعيين تلقائي (اختر الدولة في تجربة 7$ أو الباقات الشهرية)',
    interval: '⏱️ <b>الفاصل الزمني:</b> كل',
    mins: 'دقيقة',
    s1_ok: (n, m) => '✅ <b>1. الحسابات المضافة:</b> ' + n + ' (الحد الأقصى ' + m + ')',
    s1_no: '❌ <b>1. الحسابات:</b> لا يوجد <i>(اضغط [➕ 1. إضافة حساب])</i>',
    s2_ok: (n) => '✅ <b>2. نصوص المنشورات:</b> ' + n + ' قالب جاهز',
    s2_no: '❌ <b>2. نصوص المنشورات:</b> لا يوجد <i>(اضغط [✍️ 2. نص المنشور])</i>',
    s3_ok: (b) => '✅ <b>3. رابط البايو (Bio):</b> <code>' + b + '</code>',
    s3_no: '⚪ <b>3. رابط البايو:</b> بدون تغيير',
    s4_run: '🟢 <b>4. الحالة:</b> <b>يعمل 24/7</b>',
    s4_stop: '🔴 <b>4. الحالة:</b> <b>متوقف مؤقتاً</b> <i>(اضغط [▶️ 4. بدء النشر])</i>',
    rules: '⚠️ <b>قواعد هامة (على مسؤوليتك):</b>\n• الفواصل الزمنية القصيرة تزيد من احتمالية الشادوبان (~ساعتين).\n• استخدم فقط حسابات التوكن المؤقتة المشتراة (auth_token)! يتم التبديل للحساب الاحتياطي في 0 ثانية عند الحظر.',
    demo: (u, c) => '🟢 <b>عرض حي مباشر (يعمل الآن 24/7):</b> <a href="https://x.com/search?q=from%3A' + u + '&f=live">@' + u + '</a> (<b>' + c + '</b> منشور / بدون شادوبان)',
    btn1: '➕ 1. إضافة حساب (Token)',
    btn2: '✍️ 2. تعيين نص المنشور',
    btn3: '🔗 3. رابط البايو (Bio)',
    btn4_run: '🟢 4. يعمل الآن (إيقاف)',
    btn4_stop: '▶️ 4. بدء النشر التلقائي',
    btnInt: (m) => '⏱️ الفاصل: كل ' + m + ' د',
    btnIpFree: '🔒 IP: تلقائي',
    btnIp: (l) => '🌍 IP: ' + l,
    btnStatus: '📊 حساباتي وقائمة الانتظار',
    btnRules: '⚖️ إخلاء المسؤولية والشروط',
    btnGuide: '❓ دليل المبتدئين',
    btnLang: '🌐 اللغة / Language (12)',
    btnSelfReply: '🔗 حماية من الحظر: وضع الرابط في الرد التلقائي (مفعل ✅)',
    btnProof: '🟢 إثبات مباشر: شاهد حساب البوت النشط على X ↗',
    btnWeb: '🖥️ لوحة تحكم الويب السحابية والأمان (SSO)',
    btnTrial: '🔥 ابدأ تجربة 24 ساعة بـ 7$ فقط →',
    btnPlans: '💎 باقات 30 يوم ($79 / $179 / $399)',
    btnBack: '← العودة للوحة التحكم',
    switched: '🇸🇦 تم تغيير اللغة إلى العربية'
  }
};

function detectTelegramLanguageCode(rawCode = '', startParam = '') {
  const sp = String(startParam || '').toLowerCase();
  for (const item of SUPPORTED_LANGS) {
    if (sp.includes('lang_' + item.code)) return item.code;
  }
  const lc = String(rawCode || '').toLowerCase().slice(0, 2);
  const matched = SUPPORTED_LANGS.find(l => l.code === lc);
  return matched ? matched.code : 'en';
}

function buildLanguageSelectorKeyboard(currentLang = 'en') {
  const rows = [];
  for (let i = 0; i < SUPPORTED_LANGS.length; i += 3) {
    const chunk = SUPPORTED_LANGS.slice(i, i + 3).map(item => ({
      text: (item.code === currentLang ? '✅ ' : '') + item.flag + ' ' + item.native,
      callback_data: 'set_lang_' + item.code
    }));
    rows.push(chunk);
  }
  const t = UI_DICT[currentLang];
  const backLabel = currentLang === 'ja'
    ? '← メインパネルへ戻る'
    : (currentLang === 'zh' ? '← 返回主控面板' : (t ? t.btnBack : '← Back to Control Panel'));
  rows.push([{ text: backLabel, callback_data: 'back_home' }]);
  return { inline_keyboard: rows };
}

function buildLocalizedCustomerDashboard(user, accSize, postSize, countryLabel, proofUname, proofCount, latestLinkHtml, escapeHtmlFn) {
  const lang = (user && user.lang) || 'en';
  const t = UI_DICT[lang];
  if (!t) return null;
  const isUsJpOnlyPlan = !user || !user.planId || user.planId === 'free' || user.planId === 'oneday';
  const intMin = user.postIntervalMin || 30;
  const ipStr = isUsJpOnlyPlan ? (countryLabel + ' <i>($7 Trial: 🇺🇸US / 🇯🇵JP selectable + TZ synced | 30d Plans: 10 Countries)</i>') : (countryLabel + ' <i>(30d Monthly: Dedicated ISP + TZ synced)</i>');
  const s1 = accSize > 0 ? t.s1_ok(accSize, user.maxAccounts || 1) : t.s1_no;
  const s2 = postSize > 0 ? t.s2_ok(postSize) : t.s2_no;
  const s3 = user.profileBio
    ? t.s3_ok(escapeHtmlFn(user.profileBio.slice(0, 32)) + (user.profileBio.length > 32 ? '...' : ''))
    : t.s3_no;
  const s4 = user.isEngineRunning ? t.s4_run : t.s4_stop;

  return t.panelTitle + '\n' +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    t.plan + ' ' + (user.planName || 'Free Preview Tier') + '\n' +
    t.ip + ' ' + ipStr + '\n' +
    t.interval + ' <b>' + intMin + ' ' + t.mins + '</b>\n' +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    s1 + '\n' +
    s2 + '\n' +
    s3 + '\n' +
    s4 + '\n' +
    '━━━━━━━━━━━━━━━━━━━━━━\n' +
    t.rules + '\n\n' +
    t.demo(proofUname, proofCount) + (latestLinkHtml || '');
}

function buildLocalizedCustomerKeyboard(lang, countryLabel, isRunning, intervalMin, isFree) {
  const t = UI_DICT[lang];
  if (!t) return null;
  return {
    inline_keyboard: [
      [
        { text: t.btn1, callback_data: 'wiz_add_token' },
        { text: t.btn2, callback_data: 'wiz_add_post' }
      ],
      [
        { text: t.btn3, callback_data: 'wiz_set_bio' },
        { text: isRunning ? t.btn4_run : t.btn4_stop, callback_data: 'toggle_engine' }
      ],
      [
        { text: t.btnInt(intervalMin), callback_data: 'cycle_interval' },
        { text: t.btnIp(countryLabel) + (isFree ? ' (US/JP)' : ''), callback_data: 'cycle_country' }
      ],
      [
        { text: t.btnStatus, callback_data: 'view_status' },
        { text: t.btnRules, callback_data: 'view_disclaimer' }
      ],
      [
        { text: t.btnGuide, callback_data: 'help_beginner' },
        { text: t.btnLang, callback_data: 'open_lang_menu' }
      ],
      [{ text: t.btnSelfReply, callback_data: 'toggle_self_reply' }],
      [{ text: t.btnProof, callback_data: 'view_live_proof' }],
      [{ text: t.btnWeb, callback_data: 'open_web_dash' }],
      [{ text: t.btnTrial, callback_data: 'buy_oneday' }],
      [{ text: t.btnPlans, callback_data: 'menu_plans' }]
    ]
  };
}

module.exports = {
  SUPPORTED_LANGS,
  UI_DICT,
  detectTelegramLanguageCode,
  buildLanguageSelectorKeyboard,
  buildLocalizedCustomerDashboard,
  buildLocalizedCustomerKeyboard
};
