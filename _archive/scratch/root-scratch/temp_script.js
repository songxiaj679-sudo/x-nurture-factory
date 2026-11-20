
    let currentPlan = 'pro';
    const savedBillingCurrency = localStorage.getItem('velox_billing_currency');
    let billingCurrencyManuallySelected = savedBillingCurrency === 'jpy' || savedBillingCurrency === 'usd';
    let currentCurrency = billingCurrencyManuallySelected
      ? savedBillingCurrency
      : 'jpy';
    let pollOrderTimer = null;

    const PLAN_NAMES = {
      starter: '🥉 Solo Starter',
      pro: '🥈 Agency Pro',
      business: '🥇 Syndicate Business'
    };

    const PLAN_PRICES = {
      jpy: { starter: '¥4,980', pro: '¥9,800', business: '¥19,800' },
      usd: { starter: '$39', pro: '$79', business: '$179' }
    };

    function selectPlan(p, el) {
      currentPlan = p;
      window.currentPlanId = p;
      document.querySelectorAll('.plan-box').forEach(b => b.classList.remove('selected'));
      document.querySelectorAll('.plan-pay-btn').forEach(b => b.classList.remove('primary'));
      
      const box = document.getElementById('planBox_' + p);
      if (box) box.classList.add('selected');
      const btn = document.getElementById('btnPay_' + p);
      if (btn) btn.classList.add('primary');

      updateBottomPayBar();
    }

    function updateBottomPayBar() {
      const price = PLAN_PRICES[currentCurrency]?.[currentPlan] || '¥9,800';
      const label = document.getElementById('selectedPlanLabel');
      const directBtn = document.getElementById('btnPayDirect');
      const isEn = currentLandingLang === 'en';
      const unit = currentCurrency === 'jpy'
        ? (isEn ? ' / month (tax included)' : ' / 月（税込）')
        : (isEn ? ' / month' : ' / 月');
      
      if (label) {
        label.innerText = (isEn ? 'Selected: ' : '現在選択中: ')
          + PLAN_NAMES[currentPlan] + ' (' + price + unit + '・'
          + (isEn ? '7-day free trial' : '7日間無料トライアル') + ')';
      }
      if (directBtn) {
        directBtn.href = '#';
        directBtn.innerText = isEn
          ? '💳 Start 7-day free trial →'
          : '💳 7日間無料トライアルを開始 ↗';
        directBtn.onclick = function(e) { handlePayClick(currentPlan, e); };
      }
    }

    function switchCurrency(cur, fromLanguage = false) {
      if (cur !== 'jpy' && cur !== 'usd') return;
      currentCurrency = cur;
      if (!fromLanguage) {
        billingCurrencyManuallySelected = true;
        localStorage.setItem('velox_billing_currency', cur);
      }
      const btnJpy = document.getElementById('btnCurJpy');
      const btnUsd = document.getElementById('btnCurUsd');
      if (cur === 'jpy') {
        btnJpy.style.background = '#2563EB';
        btnJpy.style.color = '#FFF';
        btnUsd.style.background = 'transparent';
        btnUsd.style.color = '#64748B';
      } else {
        btnUsd.style.background = '#2563EB';
        btnUsd.style.color = '#FFF';
        btnJpy.style.background = 'transparent';
        btnJpy.style.color = '#64748B';
      }

      ['starter', 'pro', 'business'].forEach(p => {
        const pr = PLAN_PRICES[cur][p];
        const isEn = currentLandingLang === 'en';
        const unit = cur === 'jpy'
          ? (isEn ? '/ month (tax included)' : '/月（税込）')
          : (isEn ? '/ month' : '/月');
        const priceEl = document.getElementById('price_' + p);
        if (priceEl) priceEl.innerHTML = pr + '<span style="font-size:12px;color:#64748B;">' + unit + '</span>';
        const b = document.getElementById('btnPay_' + p);
        if (b) {
          b.href = '#';
          b.innerText = isEn ? '💳 Start 7-day free trial →' : '💳 7日間無料トライアルを開始 ↗';
          b.onclick = function(e) { handlePayClick(p, e); };
        }
      });

      updateBottomPayBar();
    }

    async function handlePayClick(p, e) {
      if (e && e.preventDefault) e.preventDefault();
      p = p || window.currentPlanId || window.currentPlan || 'pro';
      const btn = e ? (e.target || e.currentTarget) : document.getElementById('btnStripeModalPay');
      const originalText = btn ? btn.innerText : '💳 Stripeで安全に決済して機能を解放する →';
      if (btn) {
        btn.innerText = "⏳ Stripe決済画面へ移動中...";
        btn.style.pointerEvents = "none";
      }

      try {
        const email = localStorage.getItem('xsw_email') || '';
        const uid = localStorage.getItem('xsw_uid') || '';
        const res = await fetch("/api/billing/create-checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            plan: p,
            currency: currentCurrency,
            lang: currentLandingLang,
            email,
            userId: uid
          })
        });
        const data = await res.json();
        if (data.ok && data.url) {
          window.location.href = data.url;
        } else {
          alert("決済の準備に失敗しました: " + (data.error || ""));
          if (btn) {
            btn.innerText = originalText;
            btn.style.pointerEvents = "auto";
          }
        }
      } catch (err) {
        alert("通信エラーが発生しました: " + err.message);
        if (btn) {
          btn.innerText = originalText;
          btn.style.pointerEvents = "auto";
        }
      }
    }
    window.handlePayClick = handlePayClick;

    async function verifyKeys() {
      const msg = document.getElementById('keyMsg');
      msg.style.display = 'block';
      msg.style.background = '#EFF6FF';
      msg.style.border = '1px solid #3B82F6';
      msg.style.color = '#1D4ED8';
      msg.innerText = '⏳ 公式APIキーを検証中...';

      const body = {
        apiKey: document.getElementById('inpApiKey').value,
        apiSecret: document.getElementById('inpApiSecret').value,
        accessToken: document.getElementById('inpAccessToken').value,
        accessTokenSecret: document.getElementById('inpAccessTokenSecret').value
      };

      try {
        const res = await fetch('/api/hybrid/verify-keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const j = await res.json();
        if (j.ok) {
          msg.style.background = '#ECFDF5';
          msg.style.border = '1px solid #10B981';
          msg.style.color = '#065F46';
          msg.innerHTML = j.message;
        } else {
          msg.style.background = '#FEF2F2';
          msg.style.border = '1px solid #EF4444';
          msg.style.color = '#991B1B';
          msg.innerText = '❌ ' + j.error;
        }
      } catch (e) {
        msg.style.background = '#FEF2F2';
        msg.style.border = '1px solid #EF4444';
        msg.style.color = '#991B1B';
        msg.innerText = '❌ 通信エラー: ' + e.message;
      }
    }

    async function launchAutopilot() {
      const msg = document.getElementById('launchMsg');
      msg.style.display = 'block';
      msg.style.background = '#EFF6FF';
      msg.style.border = '1px solid #3B82F6';
      msg.style.color = '#1D4ED8';
      msg.innerHTML = '🔍 <b>AIがURL先をスクレイピングし、市場・ペルソナ分析中...</b> (約10〜15秒かかります)';

      const body = {
        targetUrl: document.getElementById('inpTargetUrl').value,
        plan: currentPlan
      };

      try {
        const res = await fetch('/api/autopilot/launch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const j = await res.json();
        if (j.ok) {
          msg.style.background = '#ECFDF5';
          msg.style.border = '1px solid #10B981';
          msg.style.color = '#065F46';
          msg.innerHTML = j.message + '<br><small style="color:#475569;">🎯 分析対象: ' + (j.marketAnalysis ? j.marketAnalysis.serviceName : '') + ' / ターゲット: ' + (j.marketAnalysis ? j.marketAnalysis.targetAudience : '') + '</small>';
          loadJobs();
        } else {
          msg.style.background = '#FEF2F2';
          msg.style.border = '1px solid #EF4444';
          msg.style.color = '#991B1B';
          msg.innerText = '❌ ' + j.error;
        }
      } catch (e) {
        msg.style.background = '#FEF2F2';
        msg.style.border = '1px solid #EF4444';
        msg.style.color = '#991B1B';
        msg.innerText = '❌ ' + e.message;
      }
    }

    function getFormatBadge(fmt, isThread, threadLen) {
      if (fmt === 'multi_thread_story' || (isThread && threadLen >= 3)) {
        return '<span style="background:rgba(168,85,247,0.15);color:#7E22CE;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:800;margin-right:6px;">🧵 ' + (threadLen || '3-4') + '段スレッド</span>';
      }
      if (fmt === 'two_tier_reply_link' || (isThread && threadLen === 2)) {
        return '<span style="background:rgba(59,130,246,0.15);color:#1D4ED8;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:800;margin-right:6px;">💬 2段リプ誘導</span>';
      }
      if (fmt === 'single_empathy') {
        return '<span style="background:rgba(245,158,11,0.15);color:#B45309;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:800;margin-right:6px;">☕ 単発共感</span>';
      }
      return '<span style="background:rgba(16,185,129,0.15);color:#047857;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:800;margin-right:6px;">📌 単発ノウハウ</span>';
    }

    async function loadJobs() {
      const cont = document.getElementById('jobsContainer');
      if (!cont) return;
      try {
        const res = await fetch('/api/autopilot/jobs');
        const j = await res.json();
        if (j.ok && Array.isArray(j.jobs) && j.jobs.length > 0) {
          let html = '';
          j.jobs.forEach((job) => {
            const isDone = job.status === 'posted';
            const timeZone = job.scheduleTimeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            const dateStr = job.scheduledAt
              ? `${new Date(job.scheduledAt._seconds ? job.scheduledAt._seconds * 1000 : job.scheduledAt).toLocaleString('ja-JP', { timeZone })} (${timeZone})`
              : '';
            const tweets = Array.isArray(job.tweets) && job.tweets.length > 0 ? job.tweets : [job.text || ''];
            const badge = getFormatBadge(job.format, job.isThread, tweets.length);

            let tweetHtml = '<div style="font-size:13px;color:#1E293B;line-height:1.5;white-space:pre-wrap;margin-top:4px;">' + tweets[0] + '</div>';
            if (tweets.length > 1) {
              tweetHtml += '<details style="margin-top:8px;font-size:12px;color:#64748B;cursor:pointer;">' +
                '<summary style="color:#2563EB;font-weight:700;">▼ 連動ツリーを表示（全' + tweets.length + '件）</summary>' +
                '<div style="margin-top:6px;padding-left:10px;border-left:2px solid #38BDF8;">';
              for (let t = 1; t < tweets.length; t++) {
                tweetHtml += '<div style="margin-top:6px;color:#334155;white-space:pre-wrap;background:#F8FAFC;padding:6px 10px;border-radius:6px;border:1px solid #E2E8F0;"><b>(' + (t + 1) + '/' + tweets.length + ')</b> ' + tweets[t] + '</div>';
              }
              tweetHtml += '</div></details>';
            }

            html += '<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:10px;padding:14px 16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">' +
              '<div style="max-width:75%;">' +
                '<div style="display:flex;align-items:center;margin-bottom:4px;">' +
                  badge +
                  '<span style="font-size:12px;color:#64748B;font-weight:700;">[' + (job.angle || '自動最適化') + '] ' + dateStr + '</span>' +
                '</div>' +
                tweetHtml +
              '</div>' +
              '<div>' +
                (isDone
                  ? '<a href="' + job.tweetUrl + '" target="_blank" style="background:#059669;color:#FFF;padding:6px 14px;border-radius:8px;font-size:12px;text-decoration:none;font-weight:800;">✅ 投稿済 ↗</a>'
                  : '<span style="background:#E2E8F0;color:#64748B;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:700;">⏳ 待機中</span>'
                ) +
              '</div>' +
            '</div>';
          });
          cont.innerHTML = html;
        }
      } catch (e) {}
    }

    // ========================================================================
    // 🏛️ AI評議会（Multi-AI Deliberation Council）アカウント自律成長エンジン
    // ========================================================================
    let activeCouncilDeliberation = null;

    async function startGrowthEngine() {
      const launchMsg = document.getElementById('launchMsg');
      if (launchMsg) {
        launchMsg.style.display = 'block';
        launchMsg.style.background = '#EFF6FF';
        launchMsg.style.border = '1px solid #3B82F6';
        launchMsg.style.color = '#1D4ED8';
        const isEn = currentLandingLang === 'en';
        launchMsg.innerHTML = isEn
          ? '🏛️ <b>AI council started...</b> Preparing post suggestions from your inputs and available data.'
          : '🏛️ <b>AI評議会を開始しました...</b> 入力内容と利用可能なデータを参考に投稿案を作成しています。';
      }

      const studio = document.getElementById('councilStudioSection');
      if (studio) studio.scrollIntoView({ behavior: 'smooth' });

      await startCouncilDeliberation('');
    }

    async function submitCouncilFeedback() {
      const fbInput = document.getElementById('userCouncilFeedback');
      const fb = (fbInput ? fbInput.value : '').trim();
      if (!fb) {
        alert(currentLandingLang === 'en' ? 'Please enter revision instructions for the AI Council (e.g., "more casual tone", "stronger CTA", etc.)' : 'AI合議への修正指示を入力してください（例: 「もっとフランクに」「URL誘導を強めて」「時間は明日の昼に」など）');
        return;
      }
      const studio = document.getElementById('councilStudioSection');
      if (studio) studio.scrollIntoView({ behavior: 'smooth' });
      await startCouncilDeliberation(fb);
    }

    async function startCouncilDeliberation(userFeedback = '') {
      const wrap = document.getElementById('councilResultWrap');
      const loader = document.getElementById('councilLoading');
      const btnMain = document.getElementById('btnMainLaunch');
      const btnAgain = document.getElementById('btnDeliberateAgain');
      const btnFb = document.getElementById('btnSubmitFeedback');
      const statusMsg = document.getElementById('councilCommitStatus');
      const launchMsg = document.getElementById('launchMsg');

      if (statusMsg) statusMsg.style.display = 'none';
      if (loader) loader.style.display = 'block';
      if (wrap) wrap.style.display = 'none';
      if (btnMain) btnMain.disabled = true;
      if (btnAgain) btnAgain.disabled = true;
      if (btnFb) btnFb.disabled = true;

      const body = {
        userId: localStorage.getItem('xsw_uid') || 'default_user',
        targetUrl: document.getElementById('inpTargetUrl').value || '',
        userFeedback: userFeedback || '',
        currentDraft: activeCouncilDeliberation ? activeCouncilDeliberation.proposedPost : null,
        plan: currentPlan,
        lang: currentLandingLang
      };

      try {
        const res = await fetch('/api/autopilot/council/deliberate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (res.status === 401) {
          if (loader) loader.style.display = 'none';
          if (btnMain) btnMain.disabled = false;
          if (btnAgain) btnAgain.disabled = false;
          if (btnFb) btnFb.disabled = false;
          const isEn = currentLandingLang === 'en';
          const msg = isEn 
            ? 'Account growth scheduling requires an active plan or sign-in. Please start your 7-day free trial or sign in below.'
            : '本番アカウントでの自律配信スケジュールには、ログインまたは7日間無料トライアルの開始が必要です。以下のプラン選択またはログインからお進みください。';
          alert(msg);
          const paySec = document.getElementById('price_' + currentPlan) || document.getElementById('login-box');
          if (paySec) paySec.scrollIntoView({ behavior: 'smooth' });
          return;
        }
        const d = await res.json();
        if (loader) loader.style.display = 'none';
        if (btnMain) btnMain.disabled = false;
        if (btnAgain) btnAgain.disabled = false;
        if (btnFb) btnFb.disabled = false;

        if (!d || !d.ok) {
          const errText = (d && d.error) || '合議の実行に失敗しました';
          alert('AI合議エラー: ' + errText);
          if (launchMsg) {
            launchMsg.style.background = '#FEF2F2';
            launchMsg.style.border = '1px solid #EF4444';
            launchMsg.style.color = '#991B1B';
            launchMsg.innerText = '❌ 合議エラー: ' + errText;
          }
          return;
        }

        activeCouncilDeliberation = d;
        if (launchMsg) {
          const isEn = currentLandingLang === 'en';
          launchMsg.style.background = '#ECFDF5';
          launchMsg.style.border = '1px solid #10B981';
          launchMsg.style.color = '#065F46';
          launchMsg.innerHTML = isEn
            ? '🎉 <b>7-Agent AI Council Consensus Reached!</b> Review the dialectical debate log and approved strategy below.'
            : '🎉 <b>7名AI評議会の合議が完了しました！</b> 下記スタジオにて7名の専門家ディベートと決定案をご確認ください。';
        }
        renderCouncilResult(d);
      } catch (err) {
        if (loader) loader.style.display = 'none';
        if (btnMain) btnMain.disabled = false;
        if (btnAgain) btnAgain.disabled = false;
        if (btnFb) btnFb.disabled = false;
        alert('通信エラー: ' + err.message);
      }
    }

    function renderCouncilResult(data) {
      const wrap = document.getElementById('councilResultWrap');
      const grid = document.getElementById('councilDebateGrid');
      const formatBadge = document.getElementById('councilFormatBadge');
      const postAngle = document.getElementById('councilPostAngle');
      const timeBadge = document.getElementById('councilTimeBadge');
      const preview = document.getElementById('councilTweetsPreview');
      const reason = document.getElementById('councilScheduleReason');
      const verdictBox = document.getElementById('userFeedbackVerdictBox');

      // ユーザー指示に対する評議会の是々非々審査判定（妥協なき審査・プロ的否定＆代替案提示）
      if (verdictBox) {
        const rev = data.userFeedbackReview;
        if (rev && rev.verdict && rev.verdict !== 'none') {
          let bg = '#FFFBEB';
          let border = '#F59E0B';
          let textCol = '#78350F';
          let badgeCol = '#D97706';
          let badgeText = '⚠️ 評議会是々非々審査: 却下・プロ対案を採択';

          if (rev.verdict === 'accepted') {
            bg = '#ECFDF5';
            border = '#10B981';
            textCol = '#065F46';
            badgeCol = '#059669';
            badgeText = '✅ 評議会是々非々審査: 指示を全面採択';
          } else if (rev.verdict === 'partially_accepted') {
            bg = '#EFF6FF';
            border = '#3B82F6';
            textCol = '#1E40AF';
            badgeCol = '#2563EB';
            badgeText = '💡 評議会是々非々審査: 一部採択＆アルゴリズム補正';
          }

          verdictBox.style.display = 'block';
          verdictBox.style.background = bg;
          verdictBox.style.border = `1.5px solid ${border}`;
          verdictBox.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
              <span style="background:${badgeCol};color:#FFF;padding:3px 10px;border-radius:999px;font-size:11px;font-weight:900;">${badgeText}</span>
              <span style="font-size:12px;font-weight:800;color:${textCol};">${rev.verdictTitle || 'ユーザー指示に対するプロ審査判定'}</span>
            </div>
            <div style="font-size:13px;line-height:1.5;color:${textCol};margin-bottom:6px;">
              <b>【プロ審査・率直な批評】:</b> ${rev.critique || ''}
            </div>
            ${rev.counterProposal ? `
              <div style="font-size:12px;line-height:1.5;color:${textCol};background:rgba(255,255,255,0.7);padding:8px 12px;border-radius:8px;border:1px dashed ${border};">
                <b>💡 評議会が採用した最適代替策:</b> ${rev.counterProposal}
              </div>
            ` : ''}
          `;
        } else {
          verdictBox.style.display = 'none';
          verdictBox.innerHTML = '';
        }
      }

      const debate = data.councilDebate || {};
      const post = data.proposedPost || {};
      const sched = data.recommendedSchedule || {};

      const scoreBoard = document.getElementById('aiScoreBoard');
      const scoreRank = document.getElementById('aiScoreRank');
      const scoreNum = document.getElementById('aiScoreNum');
      const scoreImp = document.getElementById('aiScoreImp');
      const scoreReason = document.getElementById('aiScoreReason');

      // AI動的スコアボードのレンダリング
      if (scoreBoard && data.metricsAnalyzed && data.metricsAnalyzed.aiScore) {
        const scoreData = data.metricsAnalyzed.aiScore;
        const rankColors = {
          'S': '#FDE047', // ゴールド
          'A': '#60A5FA', // ブルー
          'B': '#34D399', // エメラルド
          'C': '#FBBF24', // オレンジ
          'D': '#F87171'  // レッド
        };
        const rankColor = rankColors[scoreData.rank] || '#CBD5E1';
        
        scoreRank.innerText = 'RANK ' + scoreData.rank;
        scoreRank.style.color = rankColor;
        scoreNum.innerText = '(' + scoreData.score + '/100pt)';
        scoreImp.innerText = currentLandingLang === 'en' ? 'Reference only' : '参考値です';
        scoreReason.innerText = scoreData.rankReason;
        
        scoreBoard.style.display = 'block';
      } else if (scoreBoard) {
        scoreBoard.style.display = 'none';
      }

      // 7名のディベートカード生成
      let debateHtml = '';
      if (debate.hookAnalyst) {
        debateHtml += `
          <div style="background:#FFFBEB;border:1px solid #FDE68A;border-radius:10px;padding:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:12px;font-weight:900;color:#B45309;">🎯 AI ① トレンド＆フック分析官</span>
              <span style="background:#F59E0B;color:#FFF;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;">スコア: ${debate.hookAnalyst.score || 9}/10</span>
            </div>
            <div style="font-size:12px;color:#78350F;line-height:1.4;margin-bottom:4px;"><b>批評:</b> ${debate.hookAnalyst.critique}</div>
            <div style="font-size:11px;color:#92400E;background:rgba(255,255,255,0.7);padding:6px 8px;border-radius:6px;"><b>💡 提案フック:</b> ${debate.hookAnalyst.suggestion}</div>
          </div>
        `;
      }
      if (debate.empathyPsychologist) {
        debateHtml += `
          <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:12px;font-weight:900;color:#1D4ED8;">💬 AI ② 共感＆心理ストーリー官</span>
              <span style="background:#2563EB;color:#FFF;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;">スコア: ${debate.empathyPsychologist.score || 9}/10</span>
            </div>
            <div style="font-size:12px;color:#1E3A8A;line-height:1.4;margin-bottom:4px;"><b>批評:</b> ${debate.empathyPsychologist.critique}</div>
            <div style="font-size:11px;color:#1D4ED8;background:rgba(255,255,255,0.7);padding:6px 8px;border-radius:6px;"><b>💡 心理誘導:</b> ${debate.empathyPsychologist.suggestion}</div>
          </div>
        `;
      }
      if (debate.algorithmOptimizer) {
        debateHtml += `
          <div style="background:#F5F3FF;border:1px solid #DDD6FE;border-radius:10px;padding:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:12px;font-weight:900;color:#6D28D9;">📊 AI ③ アルゴリズム＆時間最適化官</span>
              <span style="background:#7C3AED;color:#FFF;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;">推奨: ${debate.algorithmOptimizer.recommendedTimeJst || '20:30'}</span>
            </div>
            <div style="font-size:12px;color:#4C1D95;line-height:1.4;margin-bottom:4px;"><b>推奨枠:</b> ${debate.algorithmOptimizer.recommendedSlotName || '夜のゴールデンタイム'}</div>
            <div style="font-size:11px;color:#5B21B6;background:rgba(255,255,255,0.7);padding:6px 8px;border-radius:6px;"><b>💡 根拠:</b> ${debate.algorithmOptimizer.reason}</div>
          </div>
        `;
      }
      if (debate.brandGuardian) {
        debateHtml += `
          <div style="background:#FDF2F8;border:1px solid #FBCFE8;border-radius:10px;padding:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:12px;font-weight:900;color:#BE185D;">🛡️ AI ④ 脱AI臭＆ブランド防御官</span>
              <span style="background:#EC4899;color:#FFF;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;">人間味: ${debate.brandGuardian.score || 9.5}/10</span>
            </div>
            <div style="font-size:12px;color:#9D174D;line-height:1.4;margin-bottom:4px;"><b>検閲:</b> ${debate.brandGuardian.critique}</div>
            <div style="font-size:11px;color:#BE185D;background:rgba(255,255,255,0.7);padding:6px 8px;border-radius:6px;"><b>💡 人間味演出:</b> ${debate.brandGuardian.suggestion}</div>
          </div>
        `;
      }
      if (debate.arbiterConsensus) {
        debateHtml += `
          <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
              <span style="font-size:12px;font-weight:900;color:#15803D;">🏛️ AI ⑤ 統括合議議長</span>
              <span style="background:#16A34A;color:#FFF;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:800;">合議一致</span>
            </div>
            <div style="font-size:12px;color:#14532D;line-height:1.4;margin-bottom:4px;"><b>合議総括:</b> ${debate.arbiterConsensus.decisionSummary}</div>
            <div style="font-size:11px;color:#166534;background:rgba(255,255,255,0.7);padding:6px 8px;border-radius:6px;"><b>💡 指示反映:</b> ${debate.arbiterConsensus.userFeedbackReflected || '最適化済み'}</div>
          </div>
        `;
      }
      grid.innerHTML = debateHtml;

      // 🧠 自己学習ナレッジ（成功・失敗事例）の描画
      const knowBox = document.getElementById('aiKnowledgeEvolutionBox');
      const knowLevel = document.getElementById('aiKnowledgeLevelBadge');
      const knowMeta = document.getElementById('aiKnowledgeMetaInfo');
      const knowGrid = document.getElementById('aiKnowledgeCasesGrid');
      const knowTakeaway = document.getElementById('aiKnowledgeTakeawayBox');

      if (knowBox && data.userKnowledge) {
        const uk = data.userKnowledge;
        if (knowLevel) knowLevel.innerText = 'AI Level ' + (uk.level || 1);
        if (knowMeta) knowMeta.innerText = `分析済: ${uk.learnedPostsCount || 0}件 / 成功蓄積: ${uk.successfulCasesCount || 0}件 / 反省蓄積: ${uk.failedCasesCount || 0}件`;
        
        let casesHtml = '';
        const topSuccess = (uk.successfulCases && uk.successfulCases[0]) || null;
        const topFailed = (uk.failedCases && uk.failedCases[0]) || null;

        if (topSuccess) {
          casesHtml += `
            <div style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;padding:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <span style="font-size:11px;font-weight:900;color:#065F46;">🏆 学習した成功要因</span>
                <span style="font-size:10px;color:#047857;font-weight:800;">${topSuccess.impressions ? topSuccess.impressions.toLocaleString() + ' IMP' : '高反響'}</span>
              </div>
              <div style="font-size:11px;color:#064E3B;line-height:1.4;">${topSuccess.whyItSucceeded || topSuccess.title}</div>
            </div>
          `;
        }
        if (topFailed) {
          casesHtml += `
            <div style="background:#FFF1F2;border:1px solid #FECDD3;border-radius:10px;padding:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
                <span style="font-size:11px;font-weight:900;color:#9F1239;">⚠️ 学習した失敗・反省点</span>
                <span style="font-size:10px;color:#BE123C;font-weight:800;">回避対象</span>
              </div>
              <div style="font-size:11px;color:#881337;line-height:1.4;">${topFailed.flawReason || topFailed.improvementPoint}</div>
            </div>
          `;
        }
        if (knowGrid) knowGrid.innerHTML = casesHtml;

        if (knowTakeaway && data.knowledgeEvolution && data.knowledgeEvolution.newTakeaway) {
          knowTakeaway.style.display = 'block';
          knowTakeaway.innerHTML = `<b>💡 今回の合議による進化:</b> ${data.knowledgeEvolution.newTakeaway}`;
        } else if (knowTakeaway) {
          knowTakeaway.style.display = 'none';
        }

        knowBox.style.display = 'block';
      } else if (knowBox) {
        knowBox.style.display = 'none';
      }

      // 投稿プレビューの初期化 (Plan A をデフォルト選択)
      currentActivePlanType = 'planA';
      switchPlanOption('planA');
      const isEn = currentLandingLang === 'en';
      timeBadge.innerText = (isEn ? '⏰ Suggested time: ' : '⏰ 推奨投稿時間: ')
        + (sched.displayTime || (isEn ? 'Today 20:30' : '本日 20:30'));
      reason.innerHTML = '<b>' + (isEn ? '💡 Note: ' : '💡 提案理由: ')
        + '</b>' + (sched.reason || (isEn
          ? 'A suggestion based on the provided instructions and available data.'
          : '入力内容と利用可能なデータに基づく提案です。'));

      wrap.style.display = 'block';
      wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    let currentActivePlanType = 'planA';

    function switchPlanOption(planKey) {
      if (!activeCouncilDeliberation || !activeCouncilDeliberation.proposedPost) return;
      currentActivePlanType = planKey;
      const proposed = activeCouncilDeliberation.proposedPost;
      const planData = (proposed && proposed[planKey]) || proposed.planA || proposed;
      
      const tabA = document.getElementById('tabBtnPlanA');
      const tabB = document.getElementById('tabBtnPlanB');
      const badgeA = document.getElementById('planABadge');
      const badgeB = document.getElementById('planBBadge');

      if (planKey === 'planA') {
        if (tabA) { tabA.style.border = '2px solid #059669'; tabA.style.background = '#ECFDF5'; tabA.style.color = '#065F46'; tabA.style.fontWeight = '900'; }
        if (tabB) { tabB.style.border = '1.5px solid #CBD5E1'; tabB.style.background = '#FFFFFF'; tabB.style.color = '#475569'; tabB.style.fontWeight = '800'; }
        if (badgeA) { badgeA.style.background = '#059669'; badgeA.style.color = '#FFF'; badgeA.innerText = currentLandingLang === 'en' ? 'Selected' : '選択中'; }
        if (badgeB) { badgeB.style.background = '#E2E8F0'; badgeB.style.color = '#64748B'; badgeB.innerText = currentLandingLang === 'en' ? 'Alternative' : '別案'; }
      } else {
        if (tabA) { tabA.style.border = '1.5px solid #CBD5E1'; tabA.style.background = '#FFFFFF'; tabA.style.color = '#475569'; tabA.style.fontWeight = '800'; }
        if (tabB) { tabB.style.border = '2px solid #7C3AED'; tabB.style.background = '#F5F3FF'; tabB.style.color = '#5B21B6'; tabB.style.fontWeight = '900'; }
        if (badgeA) { badgeA.style.background = '#E2E8F0'; badgeA.style.color = '#64748B'; badgeA.innerText = currentLandingLang === 'en' ? 'Alternative' : '別案'; }
        if (badgeB) { badgeB.style.background = '#7C3AED'; badgeB.style.color = '#FFF'; badgeB.innerText = currentLandingLang === 'en' ? 'Selected' : '選択中'; }
      }

      // 投稿プレビューの更新
      const formatBadge = document.getElementById('councilFormatBadge');
      const postAngle = document.getElementById('councilPostAngle');
      const preview = document.getElementById('councilTweetsPreview');

      if (formatBadge) formatBadge.innerHTML = getFormatBadge(planData.format || 'two_tier_reply_link', true, (planData.tweets || []).length);
      if (postAngle) postAngle.innerText = planData.angle || 'AI合議最適化ポスト';

      let tweetPreviewHtml = '';
      const tweets = Array.isArray(planData.tweets) && planData.tweets.length > 0 ? planData.tweets : [planData.text || ''];
      tweets.forEach((t, idx) => {
        if (idx === 0) {
          tweetPreviewHtml += `<div style="background:#FFFFFF;border:1px solid #BBF7D0;border-radius:8px;padding:12px;margin-bottom:6px;"><b>【親ポスト】</b>\n${t}</div>`;
        } else {
          tweetPreviewHtml += `<div style="background:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:10px;margin-bottom:6px;font-size:13px;color:#334155;"><b>【連動リプライ (${idx + 1}/${tweets.length})】</b>\n${t}</div>`;
        }
      });
      if (preview) preview.innerHTML = tweetPreviewHtml;
    }

    const reDeliberateWithUserFeedback = submitCouncilFeedback;

    async function commitCouncilSchedule() {
      if (!activeCouncilDeliberation || !activeCouncilDeliberation.deliberationId) {
        alert('確定する合議セッションがありません');
        return;
      }
      const btn = document.getElementById('btnCommitCouncil');
      const statusMsg = document.getElementById('councilCommitStatus');
      btn.disabled = true;
      btn.innerText = '⏳ スケジュール確定中...';

      try {
        const res = await fetch('/api/autopilot/council/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: localStorage.getItem('xsw_uid') || 'default_user',
            deliberationId: activeCouncilDeliberation.deliberationId,
            selectedPlan: currentActivePlanType,
            plan: currentPlan
          })
        });
        const j = await res.json();
        btn.disabled = false;
        const isEn = currentLandingLang === 'en';
        btn.innerText = isEn ? '✅ Confirm scheduled post' : '✅ この投稿案を予約';

        if (j.ok) {
          statusMsg.style.display = 'block';
          statusMsg.style.background = '#ECFDF5';
          statusMsg.style.border = '1px solid #10B981';
          statusMsg.style.color = '#065F46';
          statusMsg.innerHTML = isEn
            ? '🎉 <b>Your post draft was added to the schedule.</b><br>It will be published through the X API at the selected time. An engagement-support campaign may also be registered using connected accounts. This is separate from the official API posting flow; execution and results are not guaranteed. Check X policies before using it.'
            : '🎉 <b>投稿案を予約スケジュールに登録しました。</b><br>指定時間にX API経由で投稿されます。接続アカウントを利用したエンゲージメント支援キャンペーンが登録される場合があります。これは公式APIによる投稿とは別の処理で、実行や数値を保証しません。Xの規約をご確認ください。';
          loadJobs();
        } else {
          statusMsg.style.display = 'block';
          statusMsg.style.background = '#FEF2F2';
          statusMsg.style.border = '1px solid #EF4444';
          statusMsg.style.color = '#991B1B';
          statusMsg.innerText = '❌ ' + j.error;
        }
      } catch (e) {
        btn.disabled = false;
        btn.innerText = currentLandingLang === 'en' ? '✅ Confirm scheduled post' : '✅ この投稿案を予約';
        alert('エラー: ' + e.message);
      }
    }

    // ========================================================================
    // 🌐 多言語 i18n ハイブリッドエンジン (全面ビジネス日本語 / 全面ビジネス英語)
    // ========================================================================
    const I18N_LANDING = {
      ja: {
        // Navigation
        nav_philosophy: "開発思想",
        nav_tech: "5大技術",
        nav_engine: "自律エンジン",
        nav_sales: "AI営業",
        nav_security: "セキュリティ",
        nav_demo: "無料デモ",
        nav_pricing: "料金プラン",
        nav_faq: "FAQ",
        nav_dashboard: "📊 アカウント管理",
        nav_login: "ログイン",
        nav_signup: "新規登録",

        // Hero
        hero_telem1_label: "通信プロトコル",
        hero_telem1_sub: "公式正規通信準拠",
        hero_telem2_label: "運用上の配慮",
        hero_telem2_value: "配慮設計",
        hero_telem2_sub: "利用者が規約を確認して運用",
        hero_telem3_label: "AI審査体制",
        hero_telem3_sub: "是々非々ディベート審査",
        hero_h1: "VeloxPost Cloud 4.0<br><span style=\"color:#2563EB;\">AIを活用したX運用支援</span>",
        hero_desc: "VeloxPostはX公式APIを利用した投稿作成・予約配信・運用支援SaaSです。7つの役割で構成するAI評議会が投稿案の作成や見直しを支援し、取得可能な反応指標を次の案づくりに活用します。投稿成果やアカウントの状態は、投稿内容・利用状況・Xの判断などによって異なります。",
        hero_badge1: "🛡️ X公式APIを利用したアカウント連携",
        hero_badge2: "🏛️ 利用者による規約確認を前提に運用を支援",
        hero_badge3: "💳 Stripe Checkoutによる決済",
        hero_badge4: "🤝 ブランドに配慮した投稿作成を支援",
        hero_btn_select: "エディションを選択する →",
        hero_btn_demo: "無料ライブデモを体験",

        // Section 2: Philosophy
        philo_badge: "PHILOSOPHY & PRINCIPLES",
        philo_h2: "サービス設計と運用支援について",
        philo_desc: "X公式APIを使った投稿作成・予約配信・アカウント運用支援を提供します。利用者は投稿内容を確認し、Xの利用規約や各種法令に沿って運用してください。APIの利用可否やアカウントの状態、投稿成果を保証するものではありません。",
        philo_card1_title: "01. X公式APIを利用した連携",
        philo_card1_desc: "X公式APIを使って連携します。APIの利用条件や投稿に適用される規約は変更されることがあり、利用者自身による確認が必要です。規約適合やアカウントの状態を保証するものではありません。",
        philo_card1_tag: "ENTERPRISE SAFETY • COMPLIANCE",
        philo_card2_title: "02. ブランド価値と社会的信用の保護",
        philo_card2_desc: "投稿案の作成や確認を支援します。公開前に内容を確認し、ブランド方針や利用者の責任に沿って必要な編集を行ってください。",
        philo_card2_tag: "BRAND REPUTATION & ETHICS",
        philo_card3_title: "03. Stripe Checkoutによる決済",
        philo_card3_desc: "決済にはStripe Checkoutを利用します。利用可能な支払方法や決済書類は、決済画面およびStripeの案内をご確認ください。",
        philo_card3_tag: "PCI-DSS L1 SECURE BILLING",
        philo_card4_title: "04. 7名AI合議制による是々非々の批判的推敲",
        philo_card4_desc: "7つの役割で構成するAI評議会が複数の観点から投稿案を作成・見直します。提案の採否や最終的な投稿内容は利用者が確認できます。",
        philo_card4_tag: "7-AGENT CRITICAL DELIBERATION",

        // Section 3: Architecture
        arch_badge: "SYSTEM ARCHITECTURE",
        arch_h2: "成果を科学する5大エンジニアリング",
        arch_desc: "VeloxPost Cloud 4.0を支える5つのコア技術。単なる自動投稿とは根本的に異なる、エンタープライズ水準の自律グロース基盤です。",
        arch_tab0: "01. 公式API v2暗号化",
        arch_tab1: "02. 7名AI合議ディベート",
        arch_tab2: "03. ナレッジ自己進化",
        arch_tab3: "04. 複数アカウント運用",
        arch_tab4: "05. 文脈認識AI営業",

        // Section 4: Continuous Pipeline
        pipe_strip: "X OFFICIAL API × AI DRAFTING × SCHEDULED PUBLISHING",
        pipe_h1: "投稿案の作成から予約配信まで。<br><span style=\"color:#2563EB;\">X運用の作業を支援するツール。</span>",
        pipe_eyebrow: "POSTING WORKFLOW",
        pipe_h2: "投稿計画と予約配信を、ひとつの画面で。",
        pipe_lead: "宣伝したいURLや方針を設定し、AI評議会で投稿案を作成できます。配信内容と時間を確認し、運用状況に合わせて調整してください。",
        pipe_f1_title: "取得できる反応指標を、次の投稿案に活用。",
        pipe_f1_desc: "いいね、返信、リポスト、ブックマークなど、APIから取得できる指標を参照します。データが取得できない指標や期間があり、分析結果や投稿成果を保証するものではありません。",
        pipe_f1_badge: "📈 取得可能な反応指標を参考に投稿案を改善",
        pipe_f2_title: "X公式APIを利用した連携。",
        pipe_f2_desc: "X公式APIを通じてアカウントを連携します。投稿内容や利用方法がXの規約に適合するかは利用者が確認してください。APIの変更やアカウント制限を防止することは保証できません。",
        pipe_f2_badge: "🛡️ X公式API連携 • 規約確認を前提とした運用",

        // Section 5: Multi-Stream & Outreach
        multi_eyebrow: "MULTI-STREAM & REVENUE EXPANSION",
        multi_h2: "複数アカウントの運用 × AI投稿・返信支援",
        multi_lead: "Solo Starter（月額4,980円）、Agency Pro（月額9,800円）、Syndicate Business（月額19,800円）から選べます。各プランの運用レーン数・接続アカウント枠・利用可能機能は、料金表をご確認ください。",
        multi_lanes_title: "⚡ 運用レーンの表示例",
        multi_lanes_badge: "表示例",
        multi_lane1_title: "● Lane 1: 投稿テーマの例",
        multi_lane1_status: "表示例",
        multi_lane1_text: "投稿テーマごとに内容や配信予定を管理できます。",
        multi_lane2_title: "● Lane 2: 複数アカウント運用の例",
        multi_lane2_status: "表示例",
        multi_lane2_text: "実際の利用状況を示すものではありません。",
        multi_lane3_title: "● Lane 3: 投稿案・予約配信の例",
        multi_lane3_status: "表示例",
        multi_lane3_text: "利用できるレーン数はプランにより異なります。",
        multi_promo_eyebrow: "MULTI-STREAM ENGINE",
        multi_promo_title: "複数の投稿テーマを整理して運用",
        multi_promo_desc: "運用レーンごとに投稿内容や配信予定を管理できます。実際の投稿数や成果は設定、利用状況、Xの仕様により異なります。",
        outreach_eyebrow: "AI CONTEXTUAL OUTREACH (BUSINESS EDITION)",
        outreach_title: "設定したキーワードをもとに返信を支援",
        outreach_desc: "ビジネスプランでは、設定したキーワードに関連する投稿へのAI返信機能を利用できます。返信内容や送信条件を確認し、Xの規約と自社方針に沿って設定してください。見込み客獲得や売上を保証する機能ではありません。",
        outreach_demo_title: "🎯 AI返信案の生成例",
        outreach_demo_badge: "返信案",
        outreach_tweet_lbl: "投稿例",
        outreach_tweet_txt: "「SNSでのB2Bリード獲得、毎日投稿するリソースが全然足りなくて限界…誰かおすすめの仕組み化教えてほしい」",
        outreach_reply_author: "VeloxPost AI返信案",
        outreach_reply_badge: "生成された返信案",
        outreach_reply_txt: "「その課題、多くのB2B企業が直面しています…！単なる宣伝Botではなく、課題解決型のストーリーを届けられるかが分岐点になりますよね。仕組み化の第一歩を応援しています🙌」",
        outreach_stat: "✓ キーワード設定に応じたAI返信機能（ビジネスプラン）",

        // Section 6: Security
        sec_eyebrow: "ENTERPRISE SECURITY & COMPLIANCE",
        sec_h2: "認証情報の保護と、運用上の注意点。",
        sec_lead: "保存されたX API認証情報はAES-256-GCMで暗号化します。決済はStripe Checkoutを利用します。データの取り扱いはプライバシーポリシーをご確認ください。暗号化やAPI連携は、アカウント停止・情報漏えい等が起きないことを保証するものではありません。",
        sec_c1_title: "🏛️ プライバシーと規約の確認",
        sec_c1_desc: "個人情報の取り扱いはプライバシーポリシーに記載しています。外部サービスとの連携・処理内容をご確認のうえご利用ください。",
        sec_c2_title: "🤝 投稿内容は公開前にご確認ください",
        sec_c2_desc: "AIの投稿案は必ずしも自社の方針や最新情報に合うとは限りません。公開前に内容を確認し、必要に応じて編集してください。",
        sec_c3_title: "💳 Stripe Checkoutによる決済",
        sec_c3_desc: "Stripe Checkoutを利用します。利用可能な支払方法と決済書類は、決済画面およびStripeの案内をご確認ください。",

        // Section 7: Live Demo
        demo_eyebrow: "INTERACTIVE LIVE SANDBOX",
        demo_h2: "AI評議会のリアルタイム合議を無料体験",
        demo_council_active: "AI ENGINE: 7-Agent Council Active",
        demo_lead: "登録不要で体験可能。宣伝したいWebページのURLと想定ターゲットを入力してください。7名のAI評議会がリアルタイムに協議し、最適化された戦略ポストを導き出します。",
        demo_lbl_handle: "01 / あなたのXアカウント名（@ユーザー名）",
        demo_ph_handle: "@your_account または アカウント名",
        demo_lbl_url: "02 / 宣伝したい商材・サービスURL",
        demo_ph_url: "https://your-service.com/product",
        demo_lbl_prompt: "03 / AI評議会への指示・要望プロンプト（任意）",
        demo_ph_prompt: "例: 「B2B経営者に刺さるトーンで」「ブックマーク保存率を最大化したい」など (空欄の場合はAIが最適判断)",
        demo_btn_run: "⚡ 7名のAI評議会を招集して無料アカウント診断＆合議を開始する →",
        demo_cta_text: "本番環境での自律運用を始める準備はできましたか？ 無料アカウント登録ですぐにコックピットへアクセスできます。",
        demo_cta_login: "👤 無料アカウント作成 / ログイン",
        demo_cta_unlock: "🔓 エディションを選択して開始 →",
        demo_debate_header: "📋 7名の専門家AIによる合議ディベートログ",
        demo_score_label: "AIによる参考評価",
        demo_score_value: "投稿データに基づく参考値",
        cockpit_status_sub: "プランに応じて、X公式API連携・AI評議会・投稿運用機能をご利用いただけます。",
        checkout_url_title: "宣伝・集客したいURLを入力",
        checkout_url_label: "対象のWebページURL（自社LP、ブログ、ショップ等）",
        checkout_plan_title: "プランを選択",
        checkout_currency_jpy: "🇯🇵 JPY (日本円)",
        checkout_currency_usd: "🇺🇸 USD (米ドル)",
        checkout_starter_name: "🥉 Solo Starter",
        checkout_pro_name: "🥈 Agency Pro",
        checkout_business_name: "🥇 Syndicate Business",
        checkout_starter_features: "1日1投稿 (月30本)<br>運用レーン 1 / 接続枠 5",
        checkout_pro_features: "1日3投稿 (朝昼夜 / 月90本)<br>運用レーン 3 / 接続枠 12",
        checkout_business_features: "1日5投稿 (朝昼夕夜深夜 / 月150本)<br>運用レーン 5 / 接続枠 25・AI返信営業",
        checkout_trial_note: "7日間の無料期間終了後、選択したプランの月額料金で自動更新されます。利用可能な支払方法はStripe決済画面に表示されます。",
        modal_title: "プラン選択・決済",
        modal_desc: "X公式API連携とAI投稿支援をご利用いただけます。運用レーン数・接続アカウント枠・返信機能はプランにより異なります。",
        modal_starter_features: "✓ 1日1投稿 (月30本の自動最適化配信)<br>✓ 運用レーン 1 / 接続アカウント枠 5",
        modal_pro_features: "✓ 1日3投稿 (朝・昼・夜ゴールデンタイム / 月90本)<br>✓ 運用レーン 3 / 接続アカウント枠 12",
        modal_business_features: "✓ 1日5投稿 (朝昼夕夜深夜フルオート / 月150本)<br>✓ 運用レーン 5 / 接続アカウント枠 25・AI返信営業",
        modal_billing_provider: "✓ Stripe Checkout",
        modal_billing_renewal: "✓ 7日間トライアル後に月額自動更新",
        modal_billing_cancel: "✓ 解約はサポートへご連絡ください",
        modal_billing_api: "✓ X公式API連携",

        // Section 8: Specs
        specs_h2: "主要機能・スペック早見表",
        spec_c1_label: "アカウント連携",
        spec_c1_big: "X公式API",
        spec_c1_desc: "X公式APIを利用して連携します。規約適合やアカウント状態を保証するものではありません。",
        spec_c2_label: "AI意思決定・合議システム",
        spec_c2_big: "7名 専門合議",
        spec_c2_desc: "フック・共感心理・アルゴ逆解析・ブランド防御・CFO・SME社長・最高司令官による激論合議",
        spec_c3_label: "運用アカウント枠",
        spec_c3_big: "最大25枠",
        spec_c3_desc: "ビジネスプランの接続アカウント枠。投稿レーン数などの詳細は料金表をご確認ください。",

        // Section 9: Pricing Editions
        editions_eyebrow: "SELECT YOUR EDITION",
        editions_h2: "事業規模に合わせた3つのプラン",
        editions_lead: "すべてのプランでX公式API連携とAI投稿支援をご利用いただけます。運用レーン数・接続アカウント枠・返信機能はプランにより異なります。",
        plan1_tier: "👤 CREATOR & SOLO",
        plan1_price: "¥4,980 <span>/ 月（税込・$39）</span>",
        plan1_desc: "個人の情報発信や小規模な運用向け。AIを使った投稿案作成と予約配信を始められるプランです。",
        plan1_feat1: "✓ <strong>1日1投稿</strong> (月30本の自動最適化配信)",
        plan1_feat2: "✓ <strong>運用レーン 1</strong> (接続アカウント枠 5)",
        plan1_feat3: "✓ X公式API連携",
        plan1_feat4: "✓ 🧠 <strong>AI評議会</strong>による投稿案作成支援",
        plan1_btn: "Solo Starter を選択 →",
        plan2_badge: "チーム向け",
        plan2_tier: "🏢 BUSINESS PRO",
        plan2_price: "¥9,800 <span>/ 月（税込・$79）</span>",
        plan2_desc: "複数の投稿テーマやアカウントを運用する個人・チーム向けのプランです。",
        plan2_feat1: "✓ <strong>1日3投稿</strong> (朝・昼・夜ゴールデンタイム / 月90本)",
        plan2_feat2: "✓ <strong>運用レーン 3</strong> (接続アカウント枠 12)",
        plan2_feat3: "✓ 🧠 <strong>AI評議会</strong>による投稿案の作成・見直し",
        plan2_feat4: "✓ 投稿スケジュール管理",
        plan2_btn: "Agency Pro を選択 →",
        plan3_badge: "👑 ENTERPRISE SCALE",
        plan3_tier: "🌐 SYNDICATE",
        plan3_price: "¥19,800 <span>/ 月（税込・$179）</span>",
        plan3_desc: "複数アカウントや投稿テーマを運用するチーム向けのプランです。",
        plan3_feat1: "✓ <strong>1日5投稿</strong> (朝昼夕夜深夜フルオート / 月150本)",
        plan3_feat2: "✓ <strong>運用レーン 5</strong> (接続アカウント枠 25)",
        plan3_feat3: "✓ 🧠 <strong>キーワード対応AI返信機能</strong>",
        plan3_feat4: "✓ 投稿スケジュール管理",
        plan3_btn: "Syndicate Business を選択 →",
        guarantee_title: "月額プランと決済について",
        guarantee_desc: "✓ <b>7日間の無料トライアル</b>　✓ <b>無料期間終了後は選択プランの月額で自動更新</b>　✓ <b>解約は更新日前日までにサポートへご連絡ください</b>",

        // Section 10: FAQ
        faq_h2: "よくあるご質問",
        faq_q1: "一般的な自動投稿ツール（Bot）との違いは何ですか？",
        faq_a1: "VeloxPost Cloudでは、AI評議会を使った投稿案作成、編集、予約配信を支援します。利用できる分析指標はAPIやアカウントの条件によって異なり、投稿の閲覧数や売上、商談獲得を保証するものではありません。",
        faq_q2: "アカウントの制限や凍結を防げますか？",
        faq_a2: "アカウントの状態や利用可否を保証することはできません。X公式APIを利用しますが、APIやXの判断、投稿内容、利用者の設定などにより制限が発生する場合があります。投稿前に内容とXの最新規約をご確認ください。",
        faq_q3: "個人事業主やフリーランスでも利用できますか？ 法人での契約も可能ですか？",
        faq_a3: "はい。個人・法人を問わずご利用いただけます。利用可能な支払方法はStripeの決済画面に表示されます。",
        faq_q4: "適格請求書（インボイス制度）に対応した領収書は発行されますか？ 経費精算は可能ですか？",
        faq_a4: "決済に関する領収書等はStripeの案内をご確認ください。適格請求書としての扱いや経費処理については、ご自身の状況に応じてご確認ください。",
        faq_q5: "無差別スパムや過度な煽りで、自社ブランドの社会的信用を落とすリスクはありませんか？",
        faq_a5: "リスクがないとは言い切れません。AIが作成した文面にも誤りや不適切な表現が含まれる場合があります。公開前に内容を確認し、必要に応じて編集してください。",
        faq_q6: "解約方法を教えてください。",
        faq_a6: "解約をご希望の場合は、次回更新日の前日までに support@veloxpostapp.com へご連絡ください。解約・更新条件の詳細は特定商取引法に基づく表記をご確認ください。",
        faq_q7: "投稿案の作成にどんなデータを使いますか？",
        faq_a7: "APIから取得できるいいね、返信、リポストなどの指標を投稿案の検討に利用できます。インプレッションなど取得できない指標は分析対象にならず、利用期間やデータ量によって分析内容は異なります。",
        faq_q8: "投稿後のエンゲージメント支援はありますか？",
        faq_a8: "予約投稿後、接続アカウントを利用したいいね・リポスト・引用などの支援キャンペーンが登録される場合があります。これはX公式APIによる処理ではなく、実行や数値を保証しません。Xの最新規約で許容される方法かを必ずご確認ください。",
        faq_q9: "AIが生成した投稿は事前に確認・修正できますか？",
        faq_a9: "はい。AIが作成した投稿案を確認し、入力内容を調整して再生成できます。公開前に内容を確認し、必要に応じて編集してください。",

        // Section 11: Editorial
        edit_h2: "VeloxPost開発チームからの見解",
        edit_h3_1: "なぜ一般的な自動投稿ツールは成果が出ないのか？",
        edit_p_1: "SNSマーケティングにおいて、多くの企業や事業主が「決まった時間に定型文を垂れ流す」だけのBotツールを導入し、結果として誰にも読まれずに終わっています。原因は明確です。SNSのアルゴリズムは「人間らしい文脈と、読者が保存したくなる本質的な価値」を厳格に評価するからです。<br>単なるURLの機械的投稿や、AI特有の安っぽい定型文は、プラットフォームからもオーディエンスからも即座に見放されます。",
        edit_h3_2: "私たちが創り上げた「AI合議制 × 自己学習」という最適解",
        edit_p_2: "VeloxPost Cloudは、単一のAIに頼るのではなく、フック分析官、共感心理官、アルゴリズム逆解析官、ブランド品質官、辛口CFO、SME実践社長、最高司令官という「7名の専門AI」を評議会として組織しました。<br>ユーザーの指示がアカウント成長にとって悪手（直リンクによるアルゴリズム減衰や、過度な煽り）であれば、AIは毅然とそれを却下し、プロとしての代替解決策を提示します。安易な妥協を徹底的に排除した客観的合議だからこそ、本物のマーケターチームを顧問に置いたような高品質な成果を生み出せます。",
        edit_h3_3: "完全公式API準拠とエンタープライズ・コンプライアンス",
        edit_p_3: "VeloxPostはX公式APIを利用してアカウントと連携します。APIの利用条件やXの規約は変更されることがあり、利用者は投稿内容と利用方法を確認する必要があります。API連携によってアカウント制限やブランド上のリスクがなくなるわけではありません。",
        edit_h3_4: "日本の諸法令遵守およびブランド保護への宣誓",
        edit_p_4: "サービスの提供にあたっては、利用規約・プライバシーポリシーをご確認ください。利用者は適用される法令、Xの規約、投稿内容について責任をもって確認してください。特定の成果やアカウント状態を保証するものではありません。",

        // Mobile CTA & Footer
        mobile_cta_demo: "⚡ 無料ライブデモ",
        mobile_cta_unlock: "🔓 エディション選択 →",
        footer_tokushoho: "特定商取引法に基づく表記",
        footer_terms: "利用規約",
        footer_privacy: "プライバシーポリシー",
        footer_company: "運営事業者情報",
        footer_disclosure: "VeloxPost CloudはX公式APIを利用した投稿作成・予約配信を支援するSaaSです。APIの利用条件、投稿内容やアカウント状態は利用者が確認してください。<br>決済にはStripe Checkoutを利用します。利用可能な支払方法、税金、決済書類は決済画面およびStripeの案内をご確認ください。",

        // Auth Modal
        auth_modal_title: "新規登録",
        auth_modal_sub: "VeloxPost Cloud 自律AIマーケティング管理画面へログインまたは新規作成します。",
        auth_btn_google: "Googleアカウントでログイン",
        auth_btn_x: "X (旧Twitter) でログイン",
        auth_lbl_or: "またはメールアドレスで登録",
        auth_tab_reg: "新規登録",
        auth_tab_login: "ログイン",
        auth_lbl_email: "📧 メールアドレス",
        auth_lbl_pass: "🔑 パスワード（8文字以上）",
        auth_lbl_pass2: "🔑 パスワード確認",
        auth_captcha_lbl: "人間による操作であることを確認しています...",
        auth_btn_submit: "✅ 新規登録して管理画面へ進む →",
        auth_legal_prefix: "ログインすることで、",
        auth_terms: "利用規約",
        auth_legal_and: "および",
        auth_privacy: "プライバシーポリシー",
        auth_legal_suffix: "に同意したものとみなされます。"
      },
      en: {
        // Navigation
        nav_philosophy: "Philosophy",
        nav_tech: "Architecture",
        nav_engine: "Autonomous Engine",
        nav_sales: "Outreach AI",
        nav_security: "Security & Trust",
        nav_demo: "Live Demo",
        nav_pricing: "Pricing",
        nav_faq: "FAQ",
        nav_dashboard: "📊 Cockpit",
        nav_login: "Log In",
        nav_signup: "Get Started",

        // Hero
        hero_telem1_label: "Official Protocol",
        hero_telem1_sub: "Official API v2",
        hero_telem2_label: "Policy-aware operation",
        hero_telem2_value: "Guided",
        hero_telem2_sub: "Users should review applicable rules",
        hero_telem3_label: "Consensus Engine",
        hero_telem3_sub: "7-Agent Deliberation",
        hero_h1: "VeloxPost Cloud 4.0<br><span style=\"color:#2563EB;\">AI-assisted X workflow</span>",
        hero_desc: "VeloxPost is a SaaS tool for creating and scheduling posts through the official X API. Its seven-role AI council helps draft and review content and can use engagement metrics available through the API. Results and account status depend on your content, usage, and X's decisions.",
        hero_badge1: "🛡️ Connects through the official X API",
        hero_badge2: "🏛️ Supports policy-aware workflows; users must review applicable rules",
        hero_badge3: "💳 Payments through Stripe Checkout",
        hero_badge4: "🤝 Tools to help review brand-sensitive content",
        hero_btn_select: "Choose Your Edition →",
        hero_btn_demo: "Experience Live Demo",

        // Section 2: Philosophy
        philo_badge: "PHILOSOPHY & PRINCIPLES",
        philo_h2: "How the service supports your workflow",
        philo_desc: "VeloxPost provides post drafting, scheduling, and account-management support using the official X API. Review your content and use the service in accordance with applicable laws and X policies. API availability, account status, and results are not guaranteed.",
        philo_card1_title: "01. Connection through the official X API",
        philo_card1_desc: "The service connects through the official X API. API access conditions and platform policies can change; users are responsible for reviewing current requirements. Compliance and account status are not guaranteed.",
        philo_card1_tag: "ENTERPRISE SAFETY • COMPLIANCE",
        philo_card2_title: "02. Enterprise Brand Equity Protection",
        philo_card2_desc: "The service helps draft and review posts. Review and edit content before publishing to ensure it fits your brand and requirements.",
        philo_card2_tag: "BRAND REPUTATION & ETHICS",
        philo_card3_title: "03. Payments through Stripe Checkout",
        philo_card3_desc: "Payments use Stripe Checkout. Check the checkout page and Stripe's guidance for available payment methods and payment documents.",
        philo_card3_tag: "PCI-DSS L1 SECURE BILLING",
        philo_card4_title: "04. 7-Agent Dialectical Consensus (Zero Compromise)",
        philo_card4_desc: "A seven-role AI council helps draft and review posts from multiple perspectives. Users can review suggestions and decide what to publish.",
        philo_card4_tag: "7-AGENT CRITICAL DELIBERATION",

        // Section 3: Architecture
        arch_badge: "SYSTEM ARCHITECTURE",
        arch_h2: "5 Core Engineering Pillars Behind Sustainable Growth",
        arch_desc: "The five technical pillars powering VeloxPost Cloud 4.0. Fundamentally distinct from basic timers—a true enterprise growth infrastructure.",
        arch_tab0: "01. Official API v2 Encryption",
        arch_tab1: "02. 7-Agent Consensus",
        arch_tab2: "03. Self-Evolving Intelligence",
        arch_tab3: "04. Multi-account Operations",
        arch_tab4: "05. Contextual Outreach AI",

        // Section 4: Continuous Pipeline
        pipe_strip: "OFFICIAL X API × AI DRAFTING × SCHEDULED PUBLISHING",
        pipe_h1: "From post drafts to scheduled publishing.<br><span style=\"color:#2563EB;\">Tools to support your X workflow.</span>",
        pipe_eyebrow: "POSTING WORKFLOW",
        pipe_h2: "Plan and schedule posts from one workspace.",
        pipe_lead: "Set a target URL and content direction, then use the AI council to draft posts. Review the content and schedule, and adjust them to your workflow.",
        pipe_f1_title: "Use available engagement metrics when reviewing drafts.",
        pipe_f1_desc: "The service can reference metrics available through the API, such as likes, replies, reposts, and bookmarks. Some metrics or periods may be unavailable; analysis and results are not guaranteed.",
        pipe_f1_badge: "📈 Draft improvements informed by available engagement metrics",
        pipe_f2_title: "Connect through the official X API.",
        pipe_f2_desc: "The service connects accounts through the official X API. Users must ensure their content and usage comply with X policies. API changes or account restrictions cannot be prevented or guaranteed against.",
        pipe_f2_badge: "🛡️ Official X API connection • User review required",

        // Section 5: Multi-Stream & Outreach
        multi_eyebrow: "MULTI-STREAM & REVENUE EXPANSION",
        multi_h2: "Multi-account operations × AI drafting and reply support",
        multi_lead: "Choose Solo Starter ($39/month), Agency Pro ($79/month), or Syndicate Business ($179/month). Available workflow lanes, connected-account slots, and reply features vary by plan; see the pricing table for details.",
        multi_lanes_title: "⚡ Workflow lane examples",
        multi_lanes_badge: "Examples",
        multi_lane1_title: "● Lane 1: Example post theme",
        multi_lane1_status: "Example",
        multi_lane1_text: "Manage post content and scheduled publishing by theme.",
        multi_lane2_title: "● Lane 2: Example multi-account workflow",
        multi_lane2_status: "Example",
        multi_lane2_text: "These examples do not represent actual account activity.",
        multi_lane3_title: "● Lane 3: Example draft and schedule",
        multi_lane3_status: "Example",
        multi_lane3_text: "The number of available lanes varies by plan.",
        multi_promo_eyebrow: "MULTI-STREAM ENGINE",
        multi_promo_title: "Organize and manage multiple post themes",
        multi_promo_desc: "Manage post content and schedules by workflow lane. Actual publishing volume and results depend on your settings, usage, and X's policies.",
        outreach_eyebrow: "AI CONTEXTUAL OUTREACH (BUSINESS EDITION)",
        outreach_title: "Reply support based on configured keywords",
        outreach_desc: "The Business plan includes an AI reply feature for posts related to configured keywords. Review the content and sending conditions and use them in accordance with X policies and your brand guidelines. The feature does not guarantee leads or sales.",
        outreach_demo_title: "🎯 AI reply draft example",
        outreach_demo_badge: "Reply draft",
        outreach_tweet_lbl: "Example post",
        outreach_tweet_txt: "“Struggling to maintain daily B2B content on X without burning 20+ hours a week. Anyone found a reliable way to automate this without sounding like a generic bot?”",
        outreach_reply_author: "VeloxPost AI reply draft",
        outreach_reply_badge: "Generated reply draft",
        outreach_reply_txt: "“This is the exact dilemma every founder faces. The watershed moment is moving past generic templates to data-backed narrative hooks that resonate with executives. Wishing you immense momentum on the journey! 🙌”",
        outreach_stat: "✓ Keyword-based AI reply feature (Business plan)",

        // Section 6: Security
        sec_eyebrow: "ENTERPRISE SECURITY & COMPLIANCE",
        sec_h2: "Credential protection and responsible use.",
        sec_lead: "Stored X API credentials are encrypted with AES-256-GCM. Payments use Stripe Checkout. See the privacy policy for data handling details. Encryption and API connectivity do not guarantee against account restrictions or data incidents.",
        sec_c1_title: "🏛️ Review privacy and platform policies",
        sec_c1_desc: "The privacy policy describes how personal information is handled. Review the processing and integrations of external services before using the service.",
        sec_c2_title: "🤝 Review posts before publishing",
        sec_c2_desc: "AI-generated drafts may not reflect your brand requirements or the latest information. Review and edit content before publishing.",
        sec_c3_title: "💳 Payments through Stripe Checkout",
        sec_c3_desc: "Payments use Stripe Checkout. Check the checkout page and Stripe's guidance for available payment methods and payment documents.",

        // Section 7: Live Demo
        demo_eyebrow: "INTERACTIVE LIVE SANDBOX",
        demo_h2: "Experience Real-Time 7-Agent Council Consensus for Free",
        demo_council_active: "AI ENGINE: 7-Agent Council Active",
        demo_lead: "No signup required. Enter your target product URL and persona directives. Watch the 7-agent council deliberate live to formulate conversion-optimized posts.",
        demo_lbl_handle: "01 / Your X Username (@handle)",
        demo_ph_handle: "@your_account or brand handle",
        demo_lbl_url: "02 / Target Product or Landing Page URL",
        demo_ph_url: "https://your-service.com/product",
        demo_lbl_prompt: "03 / Custom Directives for AI Council (Optional)",
        demo_ph_prompt: "e.g., 'Target enterprise CTOs', 'Focus on time savings & ROI', 'Authoritative executive tone'",
        demo_btn_run: "⚡ Convene 7-Agent Council & Run Live Strategic Audit →",
        demo_cta_text: "Ready to launch 24/7 autonomous social growth? Sign up for free to access your dedicated cockpit.",
        demo_cta_login: "👤 Sign Up / Log In",
        demo_cta_unlock: "🔓 Choose Your Edition →",
        demo_debate_header: "📋 7-Executive AI Council Dialectical Deliberation Log",
        demo_score_label: "AI-generated reference assessment",
        demo_score_value: "Reference only; based on available post data",
        cockpit_status_sub: "Your plan determines access to X API connectivity, the AI council, and posting workflow features.",
        checkout_url_title: "Enter the URL you want to promote",
        checkout_url_label: "Target webpage URL (website, blog, store, etc.)",
        checkout_plan_title: "Choose a plan",
        checkout_currency_jpy: "🇯🇵 JPY",
        checkout_currency_usd: "🇺🇸 USD",
        checkout_starter_name: "🥉 Solo Starter",
        checkout_pro_name: "🥈 Agency Pro",
        checkout_business_name: "🥇 Syndicate Business",
        checkout_starter_features: "1 post/day (30 posts/mo)<br>1 workflow lane / 5 account slots",
        checkout_pro_features: "3 posts/day (90 posts/mo)<br>3 workflow lanes / 12 account slots",
        checkout_business_features: "5 posts/day (150 posts/mo)<br>5 workflow lanes / 25 account slots · AI reply",
        checkout_trial_note: "After the 7-day free trial, your selected plan renews automatically at its monthly price. Available payment methods are shown at Stripe Checkout.",
        modal_title: "Choose a plan and check out",
        modal_desc: "Plans include official X API connectivity and AI drafting support. Workflow lanes, connected-account slots, and reply features vary by plan.",
        modal_starter_features: "✓ 1 post/day (30 posts/month autonomous scheduling)<br>✓ 1 workflow lane / 5 account slots",
        modal_pro_features: "✓ 3 posts/day (Morning, Noon, Night / 90 posts/mo)<br>✓ 3 workflow lanes / 12 account slots",
        modal_business_features: "✓ 5 posts/day (Full 24h Golden Hours / 150 posts/mo)<br>✓ 5 workflow lanes / 25 account slots & AI reply",
        modal_billing_provider: "✓ Stripe Checkout",
        modal_billing_renewal: "✓ Monthly auto-renewal after the 7-day trial",
        modal_billing_cancel: "✓ Contact support to cancel",
        modal_billing_api: "✓ Official X API connection",

        // Section 8: Specs
        specs_h2: "System Architecture & Engineering Specifications",
        spec_c1_label: "Account connection",
        spec_c1_big: "Official X API",
        spec_c1_desc: "Connects through the official X API. Policy compliance and account status are not guaranteed.",
        spec_c2_label: "Multi-Agent Consensus System",
        spec_c2_big: "7-Agent Council",
        spec_c2_desc: "Rigorous dialectical consensus by Hook, Empathy, Algo, Brand Safety, CFO, SME Operator, & Chief Commander.",
        spec_c3_label: "Connected-account slots",
        spec_c3_big: "Up to 25",
        spec_c3_desc: "The Business plan includes up to 25 connected-account slots. See the pricing table for plan details.",

        // Section 9: Pricing Editions
        editions_eyebrow: "SELECT YOUR EDITION",
        editions_h2: "Three Flexible Editions Tailored to Your Growth",
        editions_lead: "Every plan includes official X API connectivity and AI drafting support. Workflow lanes, connected-account slots, and reply features vary by plan.",
        plan1_tier: "👤 CREATOR & SOLO",
        plan1_price: "$39 <span>/ month (¥4,980)</span>",
        plan1_desc: "For individuals and small operations getting started with AI-assisted post drafting and scheduling.",
        plan1_feat1: "✓ <strong>1 post/day</strong> (30 posts/month autonomous scheduling)",
        plan1_feat2: "✓ <strong>1 workflow lane</strong> (5 connected-account slots)",
        plan1_feat3: "✓ Official X API connection",
        plan1_feat4: "✓ 🧠 <strong>AI council</strong> post-drafting support",
        plan1_btn: "Select Solo Starter →",
        plan2_badge: "For teams",
        plan2_tier: "🏢 BUSINESS PRO",
        plan2_price: "$79 <span>/ month (¥9,800)</span>",
        plan2_desc: "For individuals and teams managing multiple post themes or accounts.",
        plan2_feat1: "✓ <strong>3 posts/day</strong> (Morning, Noon, Night / 90 posts/month)",
        plan2_feat2: "✓ <strong>3 workflow lanes</strong> (12 connected-account slots)",
        plan2_feat3: "✓ 🧠 <strong>AI council</strong> drafting and review",
        plan2_feat4: "✓ Post scheduling tools",
        plan2_btn: "Select Agency Pro →",
        plan3_badge: "👑 ENTERPRISE SCALE",
        plan3_tier: "🌐 SYNDICATE",
        plan3_price: "$179 <span>/ month (¥19,800)</span>",
        plan3_desc: "For teams managing multiple accounts and post themes.",
        plan3_feat1: "✓ <strong>5 posts/day</strong> (Full 24h Golden Hours / 150 posts/month)",
        plan3_feat2: "✓ <strong>5 workflow lanes</strong> (25 connected-account slots & AI reply outreach)",
        plan3_feat3: "✓ 🧠 <strong>Keyword-based AI reply feature</strong>",
        plan3_feat4: "✓ Post scheduling tools",
        plan3_btn: "Select Syndicate Business →",
        guarantee_title: "Monthly plans and billing",
        guarantee_desc: "✓ <b>7-day free trial</b> &nbsp; ✓ <b>Then automatically renews at the selected monthly price</b> &nbsp; ✓ <b>Contact support by the day before renewal to cancel</b>",

        // Section 10: FAQ
        faq_h2: "Frequently Asked Questions",
        faq_q1: "How does VeloxPost differ from typical social media bots?",
        faq_a1: "VeloxPost Cloud helps create, edit, and schedule posts using an AI council. Available metrics depend on API and account conditions. Views, revenue, and lead generation are not guaranteed.",
        faq_q2: "Can the service prevent account restrictions or suspension?",
        faq_a2: "No. We cannot guarantee account status or continued access. Although the service connects through the official X API, restrictions may result from API changes, X's decisions, content, or user settings. Review your content and X's current policies before publishing.",
        faq_q3: "Can freelancers, solo operators, and corporate entities subscribe?",
        faq_a3: "Yes. Individuals and organizations can use the service. Available payment methods are shown on the Stripe checkout page.",
        faq_q4: "Do you issue tax-compliant invoices and receipts?",
        faq_a4: "Please refer to Stripe for payment receipts and other billing documents. Confirm yourself whether a document qualifies for your tax or accounting requirements.",
        faq_q5: "Will automated posts damage our executive brand reputation?",
        faq_a5: "No service can eliminate all risk. AI-generated content may contain errors or unsuitable wording. Review and edit every post before publishing.",
        faq_q6: "How do I cancel?",
        faq_a6: "To cancel, contact support@veloxpostapp.com by the day before your next renewal date. See the Specified Commercial Transactions disclosure for cancellation and renewal terms.",
        faq_q7: "What data is used to help create post drafts?",
        faq_a7: "The service can use API-available metrics such as likes, replies, and reposts when reviewing drafts. Metrics such as impressions may not be available, and analysis varies with account access, usage period, and data volume.",
        faq_q8: "Does the service provide post-publication engagement support?",
        faq_a8: "After scheduled posts are published, an engagement-support campaign may be registered using connected accounts for likes, reposts, or quotes. This is separate from the official X API posting flow; execution and results are not guaranteed. Verify that this use is allowed by X's current policies.",
        faq_q9: "Can I review and fine-tune posts before publication?",
        faq_a9: "Yes. Review AI-generated drafts, adjust your instructions, and generate another draft. Check and edit every post before publishing.",

        // Section 11: Editorial
        edit_h2: "Executive Perspectives from the VeloxPost Engineering Team",
        edit_h3_1: "Why do generic social automation tools consistently fail?",
        edit_p_1: "Most businesses deploy bots that blast static templates at fixed hours, resulting in zero audience attention. Social recommendation algorithms aggressively penalize generic output while rewarding genuine human resonance and high-substance value that readers bookmark and share.",
        edit_h3_2: "Our Dialectical Multi-Agent Architecture: The True Optimum",
        edit_p_2: "Instead of relying on a single sycophantic LLM, VeloxPost organizes 7 specialized agents (Hook, Empathy, Algo, Brand Safety, CFO, SME Operator, Chief Commander). If a user directive would trigger algorithmic reach penalties or damage brand prestige, the council vetoes it and engineers an authoritative alternative.",
        edit_h3_3: "Official API Compliance & Enterprise Brand Security",
        edit_p_3: "VeloxPost connects accounts through the official X API. API access conditions and X policies may change, and users must review their content and usage. API connectivity does not eliminate account or brand risks.",
        edit_h3_4: "Our Commitment to Regulatory Compliance & Global Ethics",
        edit_p_4: "Review the Terms of Service and Privacy Policy before using the service. Users are responsible for applicable laws, X policies, and published content. Specific outcomes and account status are not guaranteed.",

        // Mobile CTA & Footer
        mobile_cta_demo: "⚡ Free Live Demo",
        mobile_cta_unlock: "🔓 Choose Edition →",
        footer_tokushoho: "Commercial Disclosures",
        footer_terms: "Terms of Service",
        footer_privacy: "Privacy Policy",
        footer_company: "Company Information",
        footer_disclosure: "VeloxPost Cloud is a SaaS tool for drafting and scheduling posts using the official X API. Users are responsible for reviewing API requirements, published content, and account status.<br>Payments use Stripe Checkout. See the checkout page and Stripe's guidance for payment methods, taxes, and billing documents.",

        // Auth Modal
        auth_modal_title: "Create Account",
        auth_modal_sub: "Sign in or create an account to access your dedicated VeloxPost Cloud Cockpit.",
        auth_btn_google: "Sign in with Google",
        auth_btn_x: "Sign in with X",
        auth_lbl_or: "or continue with email",
        auth_tab_reg: "Sign Up",
        auth_tab_login: "Log In",
        auth_lbl_email: "📧 Email Address",
        auth_lbl_pass: "🔑 Password (8+ characters)",
        auth_lbl_pass2: "🔑 Confirm Password",
        auth_captcha_lbl: "Verifying human interaction...",
        auth_btn_submit: "✅ Continue to Dashboard →",
        auth_legal_prefix: "By signing in, you agree to our ",
        auth_terms: "Terms of Service",
        auth_legal_and: " and ",
        auth_privacy: "Privacy Policy",
        auth_legal_suffix: "."
      }
    };

    // 🔬 5大アーキテクチャ詳細データ（日英ハイブリッド）
    const EXPLORER_I18N_DATA = {
      ja: [
        {
          img: "/images/feature-cloud-vault-3d.png?v=20261113_6",
          telemTitle: "X Official API v2 / AES-256-GCM Vault",
          telemSub: "● X公式APIを利用した連携",
          telemBadge: "正規暗号化接続中",
          tag: "OFFICIAL API SECURITY",
          title: "X公式API連携 & AES-256-GCM暗号化",
          desc: "X公式APIを利用してアカウントを連携し、保存された認証情報をAES-256-GCMで暗号化します。APIの利用条件やアカウント状態を保証するものではありません。",
          specs: [
            ["PILLAR 01 — X公式API連携", "API利用条件の確認が必要"],
            ["PILLAR 02 — 認証情報暗号化", "AES-256-GCM"],
            ["PILLAR 03 — 7名合議制AI", "多角ディベート推敲"],
            ["PILLAR 04 — 投稿案の見直し", "取得可能な指標を参照"]
          ]
        },
        {
          img: "/images/spec-council-3d.png?v=20261113_6",
          telemTitle: "7-Agent Dialectical Consensus Core",
          telemSub: "● 忖度ゼロ・是々非々の客観的合議審査",
          telemBadge: "合議エンジン稼働中",
          tag: "DIALECTICAL CONSENSUS",
          title: "7名編成AI評議会による批判的ディベート",
          desc: "フック、共感心理、アルゴ逆解析、ブランド品質、辛口CFO、実践社長、最高作戦司令官の7名が激論を戦わせ、安易な妥協を排した客観審査を徹底。成約直結の鋭利な文章のみを生成します。",
          specs: [
            ["ROLE 01 — 親指停止フック官", "0.2秒スクロール停止"],
            ["ROLE 02 — 現場共感ストーリー官", "読者自尊心リスペクト"],
            ["ROLE 03 — 辛口B2B投資家・CFO", "商談獲得ROI至上"],
            ["ROLE 04 — 最高作戦司令官", "妥協ゼロの最終決裁"]
          ]
        },
        {
          img: "/images/feature-growth-3d.png?v=20261113_6",
          telemTitle: "Continuous Reinforcement & Cross-Tenant Analytics",
          telemSub: "● 利用可能な投稿反応データを参照",
          telemBadge: "ナレッジ進化中",
          tag: "SELF-EVOLVING KNOWLEDGE",
          title: "投稿反応を参考にした投稿案の見直し",
          desc: "APIから取得できるいいね、返信、リポスト、ブックマークなどを参照します。インプレッションやプロフィール遷移など、取得できない指標は分析できません。",
          specs: [
            ["METRIC 01 — いいね・返信", "取得可能な場合"],
            ["METRIC 02 — ブックマーク率", "保存意欲の可視化"],
            ["METRIC 03 — リポスト", "取得可能な場合"],
            ["METRIC 04 — 投稿案", "AIで作成・見直し"]
          ]
        },
        {
          img: "/images/spec-satellite-3d.png?v=20261113_6",
          telemTitle: "Multi-account Posting Workflow",
          telemSub: "● プランに応じた接続アカウント枠",
          telemBadge: "アカウント運用",
          tag: "ACCOUNT WORKFLOW",
          title: "複数アカウントの運用管理",
          desc: "プランごとのアカウント枠で投稿を管理できます。アカウント間の相互エンゲージメントや表示拡大を保証する機能ではありません。",
          specs: [
            ["PLAN 01 — Starter", "5アカウント枠"],
            ["PLAN 02 — Pro", "12アカウント枠"],
            ["PLAN 03 — Business", "25アカウント枠"],
            ["NOTE — Policy", "利用者が規約を確認"]
          ]
        },
        {
          img: "/images/aes256-vault-security.png?v=20261113_6",
          telemTitle: "Contextual B2B AI Outreach Radar",
          telemSub: "● BusinessプランのAI返信機能",
          telemBadge: "営業レーダー監視中",
          tag: "CONTEXTUAL OUTREACH AI",
          title: "キーワード対応のAI返信機能",
          desc: "Businessプランでは、設定したキーワードに関連する投稿へのAI返信機能を利用できます。返信内容や送信条件を確認し、Xの規約と自社方針に沿って設定してください。",
          specs: [
            ["FEATURE 01 — キーワード", "設定に応じて利用"],
            ["FEATURE 02 — AI返信", "内容を確認して利用"],
            ["NOTE 01 — Results", "リード獲得を保証しません"],
            ["NOTE 02 — Policy", "Xの規約に沿って利用"]
          ]
        }
      ],
      en: [
        {
          img: "/images/feature-cloud-vault-3d.png?v=20261113_6",
          telemTitle: "X Official API v2 / AES-256-GCM Vault",
          telemSub: "● Connects through the official X API",
          telemBadge: "Encrypted Live Connection",
          tag: "OFFICIAL API SECURITY",
          title: "Official X API connection & AES-256-GCM encryption",
          desc: "Connects accounts through the official X API and encrypts stored credentials with AES-256-GCM. API access conditions and account status are not guaranteed.",
          specs: [
            ["PILLAR 01 — Official X API", "Review API requirements"],
            ["PILLAR 02 — Credential Encryption", "AES-256-GCM"],
            ["PILLAR 03 — 7-Agent Council", "Dialectical Consensus"],
            ["PILLAR 04 — Draft review", "Uses available metrics"]
          ]
        },
        {
          img: "/images/spec-council-3d.png?v=20261113_6",
          telemTitle: "7-Agent Dialectical Consensus Core",
          telemSub: "● Zero-Compromise Objective Council Examination",
          telemBadge: "Council Engine Active",
          tag: "DIALECTICAL CONSENSUS",
          title: "7-Agent Dialectical Deliberation Engine",
          desc: "Eliminates generic AI clichés and sycophantic replies. Seven specialized AI directors (Hook, Empathy, Algo, Brand Safety, CFO, SME Operator, Chief Commander) aggressively cross-examine every post to ensure enterprise conversion quality.",
          specs: [
            ["ROLE 01 — Hook Analyst", "0.2s Thumb-Stop"],
            ["ROLE 02 — Empathy Strategist", "Human Resonance"],
            ["ROLE 03 — Pragmatic CFO", "ROI & Pipeline"],
            ["ROLE 04 — Chief Commander", "Zero Compromise Veto"]
          ]
        },
        {
          img: "/images/feature-growth-3d.png?v=20261113_6",
          telemTitle: "Continuous Reinforcement & Cross-Tenant Analytics",
          telemSub: "● Uses engagement data when available",
          telemBadge: "Knowledge Evolving",
          tag: "SELF-EVOLVING KNOWLEDGE",
          title: "Draft review informed by post engagement",
          desc: "The service can reference API-available metrics such as likes, replies, reposts, and bookmarks. Metrics such as impressions and profile visits may not be available.",
          specs: [
            ["METRIC 01 — Likes & replies", "When available"],
            ["METRIC 02 — Bookmark Rate", "High-Intent Signal"],
            ["METRIC 03 — Reposts", "When available"],
            ["METRIC 04 — Post drafts", "AI-assisted review"]
          ]
        },
        {
          img: "/images/spec-satellite-3d.png?v=20261113_6",
          telemTitle: "Multi-account Posting Workflow",
          telemSub: "● Connected-account slots vary by plan",
          telemBadge: "Account workflow",
          tag: "ACCOUNT WORKFLOW",
          title: "Manage multiple connected accounts",
          desc: "Manage posts for the account slots included in each plan. The service does not coordinate engagement or guarantee wider distribution.",
          specs: [
            ["PLAN 01 — Starter", "5 account slots"],
            ["PLAN 02 — Pro", "12 account slots"],
            ["PLAN 03 — Business", "25 account slots"],
            ["NOTE — Policy", "Users review current policies"]
          ]
        },
        {
          img: "/images/aes256-vault-security.png?v=20261113_6",
          telemTitle: "Contextual B2B AI Outreach Radar",
          telemSub: "● AI reply feature on Business plan",
          telemBadge: "Outreach Radar Scanning",
          tag: "CONTEXTUAL OUTREACH AI",
          title: "Keyword-based AI reply feature",
          desc: "The Business plan includes an AI reply feature for posts related to configured keywords. Review the content and sending conditions and follow X policies and your brand guidelines.",
          specs: [
            ["FEATURE 01 — Keywords", "Based on your settings"],
            ["FEATURE 02 — AI replies", "Review before use"],
            ["NOTE 01 — Results", "Leads are not guaranteed"],
            ["NOTE 02 — Policy", "Use in line with X policies"]
          ]
        }
      ]
    };

    let currentLandingLang = 'ja';
    let currentExplorerIdx = 0;

    function switchExplorerTab(idx) {
      currentExplorerIdx = idx;
      const dataArr = EXPLORER_I18N_DATA[currentLandingLang] || EXPLORER_I18N_DATA.ja;
      const tabData = dataArr[idx] || dataArr[0];

      // Update active tab buttons
      for (let i = 0; i < 5; i++) {
        const btn = document.getElementById('etab_' + i);
        if (btn) {
          if (i === idx) btn.classList.add('active');
          else btn.classList.remove('active');
        }
      }

      // Update Stage
      const img = document.getElementById('explorerStageImg');
      if (img) img.src = tabData.img;

      const tTitle = document.getElementById('expTelemTitle');
      if (tTitle) tTitle.innerText = tabData.telemTitle;

      const tSub = document.getElementById('expTelemSub');
      if (tSub) tSub.innerText = tabData.telemSub;

      const tBadge = document.getElementById('expTelemBadge');
      if (tBadge) tBadge.innerText = tabData.telemBadge;

      const cTag = document.getElementById('expCardTag');
      if (cTag) cTag.innerText = tabData.tag;

      const cTitle = document.getElementById('expCardTitle');
      if (cTitle) cTitle.innerText = tabData.title;

      const cBody = document.getElementById('expCardBody');
      if (cBody) cBody.innerText = tabData.desc;

      const sList = document.getElementById('expSpecList');
      if (sList && Array.isArray(tabData.specs)) {
        sList.innerHTML = tabData.specs.map(s => `
          <div class="spec-mini-row"><span>${s[0]}</span><strong>${s[1]}</strong></div>
        `).join('');
      }
    }

    function toggleLangMenu(e) {
      if (e) e.stopPropagation();
      const pop = document.getElementById('langMenuPop');
      if (pop) {
        pop.style.display = (pop.style.display === 'block') ? 'none' : 'block';
      }
    }

    document.addEventListener('click', () => {
      const pop = document.getElementById('langMenuPop');
      if (pop) pop.style.display = 'none';
    });

    function selectSiteLanguage(lang, btn) {
      currentLandingLang = lang;
      window.currentLandingLang = lang;
      if (!billingCurrencyManuallySelected) {
        switchCurrency(lang === 'en' ? 'usd' : 'jpy', true);
      }
      document.documentElement.lang = lang;
      localStorage.setItem('velox_lang', lang);
      document.cookie = 'velox_lang=' + lang + '; path=/; max-age=31536000';
      
      const lbl = document.getElementById('curLangLabel');
      if (lbl) lbl.innerText = lang === 'en' ? '🌐 EN' : '🌐 JA';

      document.querySelectorAll('.lang-opt').forEach(b => b.classList.remove('active'));
      const activeOpt = document.querySelector(`.lang-opt[data-lang="${lang}"]`);
      if (activeOpt) activeOpt.classList.add('active');
      else if (btn) btn.classList.add('active');
      
      const pop = document.getElementById('langMenuPop');
      if (pop) pop.style.display = 'none';

      const dict = I18N_LANDING[lang] || I18N_LANDING.ja;

      // 1. Replace all data-i18n
      document.querySelectorAll('[data-i18n]').forEach(el => {
        // 認証状態と連動するトップボタンは syncViewByAuthStatus で制御するため個別除外
        if (el.id === 'topAuthBtn' || el.id === 'topUnlockBtn' || el.id === 'topDashboardBtn') return;
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
          el.innerHTML = dict[key];
        }
      });

      // 2. Replace all data-i18n-ph (placeholder)
      document.querySelectorAll('[data-i18n-ph]').forEach(el => {
        const key = el.getAttribute('data-i18n-ph');
        if (dict[key]) {
          el.setAttribute('placeholder', dict[key]);
        }
      });

      // 3. Update current explorer tab stage
      switchExplorerTab(currentExplorerIdx);

      // 4. 認証状態の最新同期（ボタンの多重表示や文言不整合を防止）
      if (typeof syncViewByAuthStatus === 'function') {
        syncViewByAuthStatus();
      }
    }

    function initLandingLanguage() {
      const saved = localStorage.getItem('velox_lang');
      let lang = 'ja';
      if (saved === 'en' || saved === 'ja') {
        lang = saved;
      } else {
        // Detect browser language: If Japanese, default to ja. Otherwise, default to en!
        const navLang = (navigator.languages && navigator.languages.length ? navigator.languages[0] : (navigator.language || navigator.userLanguage || '')).toLowerCase();
        lang = navLang.startsWith('ja') ? 'ja' : 'en';
      }
      selectSiteLanguage(lang);
    }

    function startSocialLogin(provider) {
      if (provider === 'google') {
        window.location.href = '/api/auth/google';
      } else if (provider === 'twitter') {
        window.location.href = '/api/auth/twitter';
      }
    }

    initLandingLanguage();
    setTimeout(() => { 
      if (typeof loadJobs === 'function') loadJobs(); 
    }, 1200);
  