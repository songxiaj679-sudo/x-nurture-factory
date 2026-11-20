with open('views/dashboard_view.html', 'r', encoding='utf-8') as f:
    content = f.read()

start_marker = '          function renderJobCard(job, isPendingQueue) {'
end_marker = 'cont.innerHTML = html;\n\n        } else {'

if start_marker not in content:
    print('ERROR: start_marker not found')
    exit(1)
if end_marker not in content:
    print('ERROR: end_marker not found')
    exit(1)

start_pos = content.find(start_marker)
end_pos = content.find(end_marker)

new_code = """          function renderJobCard(job, isPendingQueue) {
            const isDone = job.status === 'posted';
            const isPending = job.status === 'pending';
            const timeZone = job.scheduleTimeZone || document.getElementById('workspaceScheduleTimeZone')?.value || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
            const dateStr = job.scheduledAt
              ? `${new Date(job.scheduledAt._seconds ? job.scheduledAt._seconds * 1000 : job.scheduledAt).toLocaleString(isEn ? 'en-US' : 'ja-JP', { timeZone })} (${timeZone})`
              : '';

            let slotNameText = '☕ 戦略スロット';
            const slot = job.timeSlot || 'morning';
            if (slot === 'morning') slotNameText = isEn ? '🌅 MORNING PEAK (08:30)' : '🌅 朝枠 (08:30 JST)';
            else if (slot === 'noon') slotNameText = isEn ? '☀️ NOON LUNCH (12:30)' : '☀️ 昼枠 (12:30 JST)';
            else if (slot === 'evening') slotNameText = isEn ? '🌙 EVENING PRIME (20:00)' : '🌙 夜枠 (20:00 JST)';

            // 1. 待機中スロット (Pending Job) - 時間だけ決めて、投稿直前にAI自動生成＆発射
            if (isPending) {
              return `
                <div class="p-4 sm:p-5 rounded-2xl bg-white border border-blue-200 shadow-xs mb-3 transition-all hover:border-blue-300" id="jobCard_${job.id}">
                  <div class="flex flex-wrap items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-100">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200">${slotNameText}</span>
                      <span class="text-xs text-slate-500 font-mono">${dateStr}</span>
                    </div>
                    <span class="px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-700 text-xs font-bold font-mono">
                      ● ${isEn ? 'AUTOPILOT ARMED' : '自動待機中'}
                    </span>
                  </div>

                  <div class="p-3.5 rounded-xl bg-blue-50/50 border border-blue-100 text-xs text-slate-700 leading-relaxed flex items-start gap-3">
                    <span class="text-base shrink-0">🤖</span>
                    <div>
                      <div class="font-bold text-blue-900">${isEn ? 'Dynamic Just-In-Time Generation & Instant Dispatch' : '投稿直前AI自動生成 ＆ 即時自動配信'}</div>
                      <div class="text-[11px] text-slate-600 mt-0.5">${isEn ? 'At this scheduled time, the 7-agent AI council will dynamically incorporate real-time viral trends to craft optimal content and dispatch directly to X. No manual editing or re-deliberation required.' : '配信時間の直前に、7名のAI評議会が最新トレンドを自動で取り込んで文章を作成し、Xへ直接発射します。確認ややり直し作業は一切不要です。'}</div>
                    </div>
                  </div>

                  <div class="mt-3 pt-2.5 flex items-center justify-end gap-2">
                    <button type="button" onclick="cancelAutopilotJob('${job.id}')" class="px-3 py-1.5 rounded-xl bg-white border border-rose-200 hover:bg-rose-50 text-xs font-bold text-rose-600 transition-all cursor-pointer">
                      <span>🗑️ ${isEn ? 'Cancel Slot' : '予約取消'}</span>
                    </button>
                    <button type="button" id="btnPostNow_${job.id}" onclick="executePostNow('${job.id}')" class="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-xs font-bold text-white transition-all shadow-sm flex items-center gap-1 cursor-pointer">
                      <span>🚀 ${isEn ? 'Post Now' : '今すぐ投稿'}</span>
                    </button>
                  </div>
                </div>
              `;
            }

            // 2. 投稿完了ログ (Posted Job) - 結果だけ見れればいい
            if (isDone) {
              let postText = '';
              if (isEn) {
                if (Array.isArray(job.tweets_en) && job.tweets_en.length > 0) postText = job.tweets_en[0];
                else if (job.text_en) postText = job.text_en;
                else postText = (Array.isArray(job.tweets) && job.tweets.length > 0) ? job.tweets[0] : (job.text || '');
              } else {
                const tweets = Array.isArray(job.tweets) && job.tweets.length > 0 ? job.tweets : [job.text || ''];
                postText = tweets[0];
              }

              const allDisplayTweets = Array.isArray(job.tweets) && job.tweets.length > 0 ? job.tweets : [postText];
              let tweetHtml = '<div class="text-xs sm:text-sm text-slate-800 leading-relaxed whitespace-pre-wrap mt-1">' + (allDisplayTweets[0] || postText) + '</div>';
              if (allDisplayTweets.length > 1) {
                tweetHtml += '<div class="mt-2.5 p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">' +
                  '<span class="font-bold text-blue-600 block mb-1">💬 ' + (isEn ? 'Reply Thread (Tweet #2):' : 'リプライ続き (2段目):') + '</span>' +
                  '<div class="whitespace-pre-wrap">' + escHtml(allDisplayTweets[1]) + '</div>' +
                  '</div>';
              }

              const impVal = job.impressions != null ? Number(job.impressions).toLocaleString() : (isEn ? 'Tracking...' : '集計中');
              const likesVal = job.likes != null ? Number(job.likes).toLocaleString() : 0;
              const rtVal = job.retweets != null ? Number(job.retweets).toLocaleString() : 0;
              const bmVal = job.bookmarks != null ? Number(job.bookmarks).toLocaleString() : 0;

              return `
                <div class="p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-xs mb-3 transition-all hover:border-slate-300" id="jobCard_${job.id}">
                  <div class="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-100">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="px-2.5 py-0.5 rounded-full text-xs font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">${slotNameText}</span>
                      <span class="text-xs text-slate-400 font-mono">${dateStr}</span>
                    </div>
                    <a href="${job.tweetUrl || '#'}" target="_blank" class="px-3 py-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all inline-flex items-center gap-1 shadow-sm">
                      <span>✅ ${isEn ? 'View on X ↗' : 'Xで投稿を確認する ↗'}</span>
                    </a>
                  </div>

                  ${tweetHtml}

                  <!-- 成果メトリクス -->
                  <div class="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-4 text-xs font-mono text-slate-600">
                    <div class="flex items-center gap-1"><span class="text-slate-400">👀 Imp:</span> <b class="text-slate-800">${impVal}</b></div>
                    <div class="flex items-center gap-1"><span class="text-rose-400">❤️ Likes:</span> <b class="text-slate-800">${likesVal}</b></div>
                    <div class="flex items-center gap-1"><span class="text-emerald-500">🔁 RT:</span> <b class="text-slate-800">${rtVal}</b></div>
                    <div class="flex items-center gap-1"><span class="text-blue-500">🔖 Bookmarks:</span> <b class="text-slate-800">${bmVal}</b></div>
                  </div>
                </div>
              `;
            }

            // 3. エラー時 (Failed Job)
            return `
              <div class="p-4 rounded-2xl bg-rose-50/60 border border-rose-200 mb-3" id="jobCard_${job.id}">
                <div class="flex items-center justify-between gap-2 mb-2">
                  <span class="text-xs font-bold text-rose-800 font-mono">⚠️ ${isEn ? 'Delivery Failed' : '配信エラー'} (${dateStr})</span>
                  <button type="button" onclick="cancelAutopilotJob('${job.id}')" class="text-xs text-rose-600 underline cursor-pointer">${isEn ? 'Dismiss' : '削除'}</button>
                </div>
                <div class="text-xs text-rose-700 font-mono">${escHtml(job.error || 'Failed to dispatch')}</div>
              </div>
            `;
          }

          let html = '';

          // 1. 【予約投稿スロット（配信待機中）】
          html += `
            <div class="mb-6">
              <div class="flex items-center justify-between mb-3 pb-2 border-b border-slate-200">
                <div class="flex items-center gap-2">
                  <span class="text-base">⏳</span>
                  <h3 class="font-bold text-slate-800 text-sm sm:text-base">${isEn ? 'Autopilot Posting Slots (Armed & In Queue)' : '自律投稿スロット（配信待機中）'}</h3>
                  <span class="px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-700 font-mono font-bold text-xs">${pendingJobs.length}枠</span>
                </div>
                <div class="text-xs text-slate-500 font-medium hidden sm:block">
                  ${isEn ? 'AI will auto-generate & post right at scheduled times' : '指定時刻にAIが自動生成＆投稿します（放置でOK）'}
                </div>
              </div>
          `;

          if (pendingJobs.length > 0) {
            pendingJobs.forEach(job => {
              html += renderJobCard(job, true);
            });
          } else {
            html += `
              <div class="p-6 rounded-2xl bg-slate-50 border border-dashed border-slate-300 text-center text-slate-500 mb-4">
                <p class="font-bold text-xs sm:text-sm text-slate-700 mb-1">${isEn ? 'No pending slots in queue.' : '現在待機中の予約枠はありません。'}</p>
                <p class="text-[11px] text-slate-400 mb-3">${isEn ? 'Autopilot is ready. Click below to start autonomous posting schedule:' : '基本設定を完了後、「自律運用をスタートする」を押すとゴールデンタイム枠が自動予約されます。'}</p>
                <button type="button" onclick="launchAutopilot()" class="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-xs shadow transition-all inline-flex items-center gap-1.5 cursor-pointer">
                  <span>🚀</span> <span>${isEn ? 'Launch Autopilot Schedule' : '自律運用スケジュールを起動する'}</span>
                </button>
              </div>
            `;
          }
          html += `</div>`;

          // 2. 【投稿完了ログ（結果一覧）】
          if (postedJobs.length > 0) {
            html += `
              <div class="mt-6">
                <div class="flex items-center justify-between mb-3 pb-2 border-b border-slate-200">
                  <div class="flex items-center gap-2">
                    <span class="text-base">📁</span>
                    <h3 class="font-bold text-slate-800 text-sm sm:text-base">${isEn ? 'Published Posts Log (' + postedJobs.length + ' Posts)' : '配信結果ログ（全 ' + postedJobs.length + ' 件・配信完了）'}</h3>
                  </div>
                  <span class="text-xs text-slate-400 font-mono">LATEST RESULTS</span>
                </div>
                <div class="space-y-3">
                  ${postedJobs.map(job => renderJobCard(job, false)).join('')}
                </div>
              </div>
            `;
          }

          // 3. 【エラー投稿（もしあれば）】
          if (failedJobs.length > 0) {
            html += `
              <div class="mt-4 p-4 rounded-2xl bg-rose-50/60 border border-rose-200">
                <div class="text-xs font-bold text-rose-800 mb-2">
                  ⚠️ ${isEn ? 'Delivery Failed Posts (' + failedJobs.length + ')' : '配信エラーとなった投稿（' + failedJobs.length + '件）'}
                </div>
                <div class="space-y-2">
                  ${failedJobs.map(job => renderJobCard(job, false)).join('')}
                </div>
              </div>
            `;
          }

          cont.innerHTML = html;
"""

updated = content[:start_pos] + new_code + '\n' + content[end_pos:]

with open('views/dashboard_view.html', 'w', encoding='utf-8') as f:
    f.write(updated)

print('SUCCESS: views/dashboard_view.html patched cleanly!')
