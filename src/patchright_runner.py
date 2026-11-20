import sys
import os
import re
import json
import time
import shutil
import random
import tempfile
import subprocess
from patchright.sync_api import sync_playwright

def rand_sleep(a, b):
    time.sleep(random.uniform(a, b))

def save_snap(page, shots_dir, root_dir, filename, desc=""):
    try:
        snap_path = os.path.join(shots_dir, filename)
        page.screenshot(path=snap_path)
        for dst in [os.path.join(root_dir, filename), os.path.join(root_dir, "signup_step.png")]:
            with open(snap_path, "rb") as rf, open(dst, "wb") as wf:
                wf.write(rf.read())
        size_kb = os.path.getsize(snap_path) / 1024.0
        print(f"  📸 [Patchright スクショ] {filename} ({size_kb:.1f}KB / {desc}) -> /signup-step.png 更新済", flush=True)
        return size_kb
    except Exception:
        return 0.0

def extract_readable_body(raw_bytes):
    if not raw_bytes:
        return ""
    try:
        txt = raw_bytes.decode("utf-8", errors="ignore")
        cleaned = re.sub(r"[\x00-\x1f\x7f]+", " ", txt)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned[:320]
    except Exception:
        return ""

def detect_page_state(page):
    url = page.url or ""
    body_txt = ""
    try:
        dialog = page.locator('[role="dialog"], [aria-modal="true"]')
        if dialog.count() > 0 and dialog.first.is_visible():
            body_txt = dialog.first.inner_text()
        else:
            body_txt = page.locator("body").inner_text()
    except Exception:
        pass

    lines = [l.strip() for l in body_txt.splitlines() if l.strip()][:28]
    joined = " ".join(lines)

    if "/home" in url:
        state = "home_screen"
    elif "13歳以上" in joined or "年齢条件を満たしていません" in joined or "meet the age requirements" in joined:
        state = "age_restricted_error"
    elif "興味関心を選んでください" in joined or "トピックを" in joined or "What do you want to see on X" in joined:
        state = "interests_screen"
    elif "signup_preferences" in url or "プライバシー設定" in joined or "Customize your experience" in joined:
        state = "signup_preferences_screen"
    elif "prelude_gate" in url or "本人確認の準備中" in joined or "Preparing" in joined:
        state = "prelude_gate_loading"
    elif "face_liveness" in url or "顔で認証" in joined or "人間による操作であることを確認" in joined or "Confirm with Face" in joined:
        state = "face_liveness_screen"
    elif "mode=login" in url or (("パスワードを入力" in joined or "Enter your password" in joined) and "アカウントを設定" not in joined and "Set up your account" not in joined):
        state = "existing_login_screen"
    elif "signup_phone" in url or "電話番号を入力" in joined or "Enter your phone number" in joined:
        state = "phone_screen"
    elif ("verify_code" in url or "verify_phone" in url or "verification" in url or
          "コードを送信しました" in joined or "認証コードを入力" in joined or
          "確認コード" in joined or "We sent you a code" in joined):
        state = "code_screen"
    elif ("unified_signup" in url or "アカウントを設定" in joined or
          "Set up your account" in joined or "Choose your name" in joined or
          "パスワードが必要になります" in joined or "You'll need a password" in joined):
        state = "account_setup_screen"
    elif ("signup_dob" in url or "誕生日はいつですか" in joined or "What's your birth date" in joined):
        state = "birth_screen"
    elif "すべての話題が、ここに" in joined or "以下のオプションから選択" in joined or "Happening now" in joined or "Join today" in joined:
        state = "landing_signup_modal"
    else:
        state = "other"

    return state, url, lines

def human_move_mouse_curve(page, start_x, start_y, target_x, target_y):
    steps = random.randint(14, 24)
    ctrl_x = (start_x + target_x) / 2.0 + random.uniform(-45, 45)
    ctrl_y = (start_y + target_y) / 2.0 + random.uniform(-30, 30)
    for i in range(1, steps + 1):
        t = i / float(steps)
        u = 1.0 - t
        bx = int(u * u * start_x + 2 * u * t * ctrl_x + t * t * target_x)
        by = int(u * u * start_y + 2 * u * t * ctrl_y + t * t * target_y)
        try:
            page.mouse.move(bx, by)
        except Exception:
            pass
        time.sleep(random.uniform(0.008, 0.018))

def human_type_into(page, locator, text, clear_first=False):
    target_loc = locator
    try:
        for _i in range(locator.count()):
            if locator.nth(_i).is_visible():
                target_loc = locator.nth(_i)
                break
    except Exception:
        pass
    try:
        box = target_loc.bounding_box()
        if box:
            tx = int(box["x"] + box["width"] * random.uniform(0.32, 0.68))
            ty = int(box["y"] + box["height"] * random.uniform(0.35, 0.65))
            human_move_mouse_curve(page, random.randint(420, 680), random.randint(320, 520), tx, ty)
            rand_sleep(0.22, 0.48)
            page.mouse.click(tx, ty)
        else:
            target_loc.click(timeout=4000)
    except Exception:
        pass
    rand_sleep(0.55, 0.95)
    if clear_first:
        try:
            page.keyboard.press("Control+A")
            rand_sleep(0.08, 0.16)
            page.keyboard.press("Backspace")
            rand_sleep(0.15, 0.3)
        except Exception:
            pass
    s_text = str(text)
    for idx, ch in enumerate(s_text):
        if ch in ['@', '.', '_', '!']:
            rand_sleep(0.22, 0.42)
        elif idx > 0 and idx % 6 == 0:
            rand_sleep(0.14, 0.28)
        d_ms = random.randint(48, 95) if ch in "aeiou" else random.randint(72, 165)
        page.keyboard.type(ch, delay=d_ms)
    rand_sleep(0.75, 1.25)
    try:
        cur_val = target_loc.input_value() or ""
        if len(cur_val.strip()) < 2:
            target_loc.fill(s_text)
    except Exception:
        pass
    rand_sleep(0.65, 1.1)

def click_modal_continue(page):
    btn_info = page.evaluate("""() => {
        const targets = ['続ける', '次へ', '登録', '確認', '完了', 'Continue', 'Next', 'Sign up', 'Submit'];
        const excludes = ['電話', 'Phone', 'Google', 'Apple', 'Cookie', 'ログイン', 'Sign in', 'Log in'];
        const dialog = document.querySelector('[role="dialog"], [aria-modal="true"], [data-base-ui-portal]');
        const isModalOpen = Boolean(dialog && dialog.getBoundingClientRect().width > 200) || window.location.href.includes('onboarding');
        const els = Array.from(document.querySelectorAll('button, [role="button"]'));
        let best = null;
        let minArea = 9999999;
        for (const el of els) {
            if (el.getAttribute('aria-disabled') === 'true' || el.disabled || el.hasAttribute('data-disabled')) continue;
            const txt = (el.innerText || el.textContent || '').trim();
            if (!txt || excludes.some(ex => txt.includes(ex))) continue;
            const lines = txt.split(String.fromCharCode(10)).map(s => s.trim());
            if (targets.includes(txt) || lines.some(l => targets.includes(l))) {
                const r = el.getBoundingClientRect();
                const cx = Math.round(r.left + r.width / 2);
                const cy = Math.round(r.top + r.height / 2);
                if (isModalOpen && cx < 600) continue;
                const area = r.width * r.height;
                if (r.width >= 40 && r.width <= 520 && r.height >= 24 && r.height <= 95 && r.top > 50 && area < minArea) {
                    minArea = area;
                    best = { text: txt.split(String.fromCharCode(10)).join(' '), x: cx, y: cy };
                }
            }
        }
        return best;
    }""")
    if btn_info:
        tx = btn_info["x"] + random.randint(-10, 10)
        ty = btn_info["y"] + random.randint(-4, 4)
        print(f"  🖱️ [Patchright 人間軌道クリック] ボタン「{btn_info['text']}」 (X:{tx}, Y:{ty}) へホバーしてクリックします...", flush=True)
        try:
            human_move_mouse_curve(page, tx - random.randint(45, 95), ty - random.randint(25, 55), tx, ty)
            rand_sleep(0.25, 0.55)
            page.mouse.down()
            rand_sleep(0.06, 0.14)
            page.mouse.up()
        except Exception as e:
            print(f"  ⚠️ マウスクリック例外: {e}", flush=True)
        return True

    return False

def click_any_skip_button(page):
    clicked_txt = page.evaluate("""() => {
        const words = ['スキップ', '今はスキップ', '後で', '今はしない', 'Skip', 'Skip for now', 'Not now'];
        const els = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'));
        let best = null;
        let bestArea = 9999999;
        for (const el of els) {
            const t = (el.innerText || el.textContent || '').trim();
            if (!words.includes(t)) continue;
            const r = el.getBoundingClientRect();
            const area = r.width * r.height;
            const dialog = document.querySelector('[role="dialog"], [aria-modal="true"], [data-base-ui-portal]');
            const isModal = Boolean(dialog && dialog.getBoundingClientRect().width > 200) || window.location.href.includes('onboarding');
            if (isModal && (r.left + r.width / 2) < 600) continue;
            if (r.width > 16 && r.width < 360 && r.height > 10 && r.height < 90 && r.top >= 0 && r.bottom <= window.innerHeight) {
                if (area < bestArea) {
                    bestArea = area;
                    best = { el, text: t, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
                }
            }
        }
        if (best) {
            best.el.click();
            return { text: best.text, x: best.x, y: best.y };
        }
        return null;
    }""")
    if clicked_txt:
        print(f"  ⏭️ [スキップ実行] 「{clicked_txt['text']}」 (X:{clicked_txt['x']}, Y:{clicked_txt['y']}) をクリックしました", flush=True)
        try:
            page.mouse.click(clicked_txt["x"], clicked_txt["y"])
        except Exception:
            pass
        return True
    return False

def set_birth_date_reliably(page, by, bm, bd):
    dom_diag = page.evaluate("""() => {
        const vw = window.innerWidth || 1918;
        const vh = window.innerHeight || 894;
        function findBox(lbls, ratio) {
            const defY = Math.round(vh * 0.395);
            const els = Array.from(document.querySelectorAll('span, div, label'));
            for (const el of els) {
                const t = (el.innerText || el.textContent || '').trim();
                if (lbls.includes(t)) {
                    const box = el.closest('[role="combobox"], button') || el.parentElement;
                    if (box) {
                        const r = box.getBoundingClientRect();
                        if (r.width >= 50 && r.width <= 260 && r.height >= 30 && r.height <= 95 && r.top >= 180 && r.top <= 520) {
                            return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), found: true };
                        }
                    }
                }
            }
            return { x: Math.round(vw * ratio), y: defY, found: false };
        }
        return {
            vw, vh,
            yearBox: findBox(['年', 'Year'], 0.415),
            monthBox: findBox(['月', 'Month'], 0.500),
            dayBox: findBox(['日', 'Day'], 0.580)
        };
    }""")
    print(f"  🔍 [誕生日DOM診断] 年={dom_diag['yearBox']} | 月={dom_diag['monthBox']} | 日={dom_diag['dayBox']}", flush=True)

    def pick_from_top_exactly(label_name, box_obj, reset_ups, down_steps):
        px, py = box_obj["x"], box_obj["y"]
        print(f"  🖱️ [{label_name}選択] (X:{px}, Y:{py}) -> 先頭リセット(ArrowUp {reset_ups}回) -> ArrowDown {down_steps}回 + Enter", flush=True)
        page.mouse.click(px, py)
        rand_sleep(0.55, 0.85)
        for _ in range(reset_ups):
            page.keyboard.press("ArrowUp")
            time.sleep(0.015)
        rand_sleep(0.15, 0.25)
        for _ in range(max(0, down_steps)):
            page.keyboard.press("ArrowDown")
            time.sleep(0.025)
        rand_sleep(0.25, 0.45)
        page.keyboard.press("Enter")
        rand_sleep(0.55, 0.85)

    now_year = time.localtime().tm_year
    year_down = max(18, now_year - int(by))
    month_down = max(0, min(11, int(bm) - 1))
    day_down = max(0, min(27, int(bd) - 1))

    pick_from_top_exactly("年", dom_diag["yearBox"], 15, year_down)
    pick_from_top_exactly("月", dom_diag["monthBox"], 15, month_down)
    pick_from_top_exactly("日", dom_diag["dayBox"], 33, day_down)
    print(f"  ✅ [誕生日設定完了] {by}年{bm}月{bd}日 に設定しました", flush=True)

def fetch_firstmail_code_via_node(root_dir, email, password):
    print(f"  ⏳ Firstmail IMAP ({email}) でXからの6桁確認コード到着を待機しています (最大55秒)...", flush=True)
    js_cmd = (
        "const { waitForFirstmailXCode } = require('./src/email_firstmail');"
        f"waitForFirstmailXCode({json.dumps(email)}, {json.dumps(password)}, 55)"
        ".then(c => { console.log('CODE_RESULT:' + (c || '')); process.exit(0); })"
        ".catch(e => { console.log('CODE_ERR:' + e.message); process.exit(0); });"
    )
    try:
        out = subprocess.check_output(["node", "-e", js_cmd], cwd=root_dir, text=True, timeout=65)
        for line in out.splitlines():
            if line.startswith("CODE_RESULT:"):
                code = line.split("CODE_RESULT:")[1].strip()
                if len(code) == 6 and code.isdigit():
                    return code
            elif not line.startswith("CODE_"):
                print("  " + line, flush=True)
    except Exception as e:
        print(f"  ⚠️ IMAPコード取得エラー: {e}", flush=True)
    return None

def fetch_gemini_persona_via_node(root_dir, seed_user, age_num, target_locale="ja-JP", target_country="jp"):
    is_en = str(target_locale or "").lower().startswith("en")
    origin = "pure_en" if is_en else "pure_jp"
    print(f"  🤖 [ペルソナ生成] 実年齢({age_num})の{'英語' if is_en else '日本語'}ペルソナを生成します...", flush=True)
    seed_val = seed_user + "_" + str(int(time.time()))
    age_str = str(age_num) if is_en else f"{age_num}歳"
    account = {
        "source": "setup_worker",
        "originType": origin,
        "signupCountry": target_country or ("us" if is_en else "jp"),
        "signupLocale": target_locale or ("en-US" if is_en else "ja-JP"),
        "attributes": {"age": age_str},
    }
    js_cmd = (
        "const { generateUniquePersonaProfileViaGemini } = require('./src/persona_engine');"
        f"generateUniquePersonaProfileViaGemini({json.dumps(seed_val)}, new Set(), {json.dumps(account, ensure_ascii=False)})"
        ".then(p => { console.log('PERSONA_JSON:' + JSON.stringify(p)); process.exit(0); })"
        ".catch(e => { console.log('PERSONA_ERR:' + e.message); process.exit(0); });"
    )
    try:
        out = subprocess.check_output(["node", "-e", js_cmd], cwd=root_dir, text=True, timeout=30)
        for line in out.splitlines():
            if line.startswith("PERSONA_JSON:"):
                return json.loads(line.split("PERSONA_JSON:", 1)[1].strip())
            elif not line.startswith("PERSONA_"):
                print("  " + line, flush=True)
    except Exception as e:
        print(f"  ⚠️ Gemini取得警告: {e}", flush=True)
    return None

def detect_installed_chrome_version():
    for bin_path in ["/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/usr/bin/chromium-browser"]:
        if os.path.exists(bin_path):
            try:
                out = subprocess.check_output([bin_path, "--version"], text=True, timeout=5).strip()
                m = re.search(r"(\d+\.\d+\.\d+\.\d+)", out)
                if m:
                    full_v = m.group(1)
                    return bin_path, full_v, full_v.split(".")[0]
            except Exception:
                pass
    return "/usr/bin/google-chrome-stable", "131.0.6778.86", "131"

def resolve_timezone(proxy_ip, target_locale):
    if isinstance(proxy_ip, str) and re.match(r"^\d+\.\d+\.\d+\.\d+$", proxy_ip):
        try:
            from camoufox.geolocation import get_geolocation
            geo = get_geolocation(proxy_ip)
            if geo and getattr(geo, "timezone", None):
                return str(geo.timezone)
        except Exception:
            pass
    loc_low = target_locale.lower()
    if loc_low.startswith("ja"):
        return "Asia/Tokyo"
    if "gb" in loc_low:
        return "Europe/London"
    if "ca" in loc_low:
        return "America/Toronto"
    if "au" in loc_low:
        return "Australia/Sydney"
    return "America/New_York"

def main():
    cfg = json.loads(sys.argv[1])
    proxy_port = cfg["localProxyPort"]
    proxy_ip = cfg.get("proxyIp", True)
    email = cfg["email"]
    email_pass = cfg.get("emailPassword", "")
    profile = cfg["profile"]
    shots_dir = cfg["shotsDir"]
    root_dir = cfg["rootDir"]

    req_os = str(cfg.get("targetOs") or "windows").strip().lower()
    target_os = "macos" if req_os in ("macos", "mac") else ("linux" if req_os == "linux" else "windows")
    target_locale = str(cfg.get("targetLocale") or "ja-JP").strip()
    target_country = str(cfg.get("targetCountry") or "").strip().lower() or ("us" if target_locale.lower().startswith("en") else "jp")
    accept_langs = f"{target_locale},en-US;q=0.9,en;q=0.8" if target_locale.lower().startswith("en") and target_locale != "en-US" else ("en-US,en;q=0.9" if target_locale.lower().startswith("en") else "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7")
    tz_id = resolve_timezone(proxy_ip, target_locale)

    chrome_bin, full_ver, major_ver = detect_installed_chrome_version()
    so_file = os.path.join(root_dir, "src", "libgl_morph.so")

    if target_os == "macos":
        ua_str = f"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{major_ver}.0.0.0 Safari/537.36"
        plat_str = "MacIntel"
        ch_plat = "macOS"
        ch_plat_ver = "14.5.0"
        ch_arch = "arm"
        gl_pool = [
            ("Google Inc. (Apple)", "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)"),
            ("Google Inc. (Apple)", "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)"),
        ]
    elif target_os == "linux":
        ua_str = f"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{major_ver}.0.0.0 Safari/537.36"
        plat_str = "Linux x86_64"
        ch_plat = "Linux"
        ch_plat_ver = "6.8.0"
        ch_arch = "x86"
        gl_pool = [
            ("Intel", "Mesa Intel(R) UHD Graphics 630 (CFL GT2)"),
            ("NVIDIA Corporation", "NVIDIA GeForce RTX 3060/PCIe/SSE2"),
        ]
    else:
        ua_str = f"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{major_ver}.0.0.0 Safari/537.36"
        plat_str = "Win32"
        ch_plat = "Windows"
        ch_plat_ver = "15.0.0"
        ch_arch = "x86"
        gl_pool = [
            ("Intel", "Intel(R) UHD Graphics 630"),
            ("Intel", "Intel(R) UHD Graphics 770"),
            ("NVIDIA Corporation", "NVIDIA GeForce GTX 1660 SUPER/PCIe/SSE2"),
            ("NVIDIA Corporation", "NVIDIA GeForce RTX 3060/PCIe/SSE2"),
        ]

    gl_vendor, gl_renderer = random.choice(gl_pool)
    user_data_dir = tempfile.mkdtemp(prefix="patchright_prof_")

    launch_env = dict(os.environ)
    launch_env["DISPLAY"] = ":99"
    launch_env["TZ"] = tz_id
    launch_env["LANG"] = "en_US.UTF-8" if target_locale.lower().startswith("en") else "ja_JP.UTF-8"
    launch_env["MORPH_GL_VENDOR"] = gl_vendor
    launch_env["MORPH_GL_RENDERER"] = gl_renderer
    if os.path.exists(so_file):
        launch_env["LD_PRELOAD"] = so_file

    print(f"  🛡️ [Patchright Chrome C++起動] OS={target_os.upper()} (Chrome/{full_ver}) | Locale={target_locale} | TZ={tz_id} | GeoIP={proxy_ip}", flush=True)

    try:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir=user_data_dir,
                executable_path=chrome_bin,
                headless=False,
                no_viewport=True,
                locale=target_locale,
                timezone_id=tz_id,
                user_agent=ua_str,
                proxy={"server": f"http://127.0.0.1:{proxy_port}"},
                env=launch_env,
                ignore_default_args=["--enable-automation"],
                args=[
                    "--window-position=0,0",
                    "--window-size=1920,1080",
                    "--enable-webgl",
                    "--ignore-gpu-blocklist",
                    "--disable-gpu-sandbox",
                    "--use-fake-device-for-media-stream",
                    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
                    "--enforce-webrtc-ip-permission-check",
                    "--disable-blink-features=AutomationControlled",
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--password-store=basic",
                    f"--lang={target_locale.split('-')[0]}"
                ]
            )
            page = context.pages[0] if context.pages else context.new_page()

            try:
                cdp = context.new_cdp_session(page)
                brands = [
                    {"brand": "Not(A:Brand", "version": "99"},
                    {"brand": "Google Chrome", "version": major_ver},
                    {"brand": "Chromium", "version": major_ver},
                ]
                full_list = [
                    {"brand": "Not(A:Brand", "version": "99.0.0.0"},
                    {"brand": "Google Chrome", "version": full_ver},
                    {"brand": "Chromium", "version": full_ver},
                ]
                cdp.send("Emulation.setUserAgentOverride", {
                    "userAgent": ua_str,
                    "acceptLanguage": accept_langs,
                    "platform": plat_str,
                    "userAgentMetadata": {
                        "brands": brands,
                        "fullVersionList": full_list,
                        "fullVersion": full_ver,
                        "platform": ch_plat,
                        "platformVersion": ch_plat_ver,
                        "architecture": ch_arch,
                        "model": "",
                        "mobile": False,
                        "bitness": "64",
                        "wow64": False
                    }
                })
            except Exception as e:
                print(f"  ⚠️ CDP Emulation警告: {e}", flush=True)

            api_logs = []

            def on_response(res):
                try:
                    u = res.url
                    st = res.status
                    if st >= 400 or any(k in u for k in ["jf.x.com", "begin_login", "viewer.json", "onboarding", "task.json", "signup", "activate.json"]):
                        body_preview = ""
                        if any(k in u for k in ["begin_login", "viewer.json", "task.json", "activate.json"]) or st >= 400:
                            try:
                                body_preview = extract_readable_body(res.body())[:240]
                            except Exception:
                                pass
                        api_logs.append({"url": u[:95], "status": st, "body": body_preview})
                except Exception:
                    pass

            page.on("response", on_response)

            try:
                print("  🌐 https://x.com/ を開いています...", flush=True)
                page.goto("https://x.com/", wait_until="domcontentloaded", timeout=45000)
            except Exception as e:
                print(f"  ⚠️ ページ読み込み警告: {e}", flush=True)

            inp_locator = None
            for w in range(1, 7):
                rand_sleep(3.5, 4.2)
                try:
                    page.mouse.move(480 + w * 18, 410 + w * 12)
                except Exception:
                    pass
                has_gsi = page.locator('iframe[src*="accounts.google.com/gsi"]').count() > 0
                size_kb = save_snap(page, shots_dir, root_dir, "shot_01_top_ready_japan.png", f"起動{w*4}秒後 (GSI:{has_gsi})")

                loc = page.locator('input[name="username_or_email"], input[autocomplete="username"]')
                if loc.count() > 0 and loc.first.is_visible() and ((has_gsi and w >= 2) or (w >= 4 and size_kb >= 90.0)):
                    inp_locator = loc.first
                    print(f"  ✅ トップページ完全描画を確認しました ({size_kb:.1f}KB / GSI:{has_gsi})！さらに3.5秒間安定化を待ちます...", flush=True)
                    rand_sleep(3.2, 4.0)
                    break

                reload_btn = page.locator('button:has-text("更新"), [role="button"]:has-text("更新"), button:has-text("Retry")')
                if w >= 3 and reload_btn.count() > 0 and reload_btn.first.is_visible():
                    reload_btn.first.click()
                    continue

            if not inp_locator:
                print("RESULT_JSON:" + json.dumps({"ok": False, "reason": "page_not_ready", "emailConsumed": False}), flush=True)
                return

            try:
                page.bring_to_front()
                subprocess.run("DISPLAY=:99 xdotool search --onlyvisible --class 'chrome' windowactivate windowfocus 2>/dev/null || true", shell=True, timeout=2)
            except Exception:
                pass

            diag_info = page.evaluate("""() => {
                let gpu = 'none';
                try {
                    const c = document.createElement('canvas');
                    const gl = c.getContext('webgl');
                    if (gl) {
                        const ext = gl.getExtension('WEBGL_debug_renderer_info');
                        gpu = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : 37446);
                    }
                } catch (e) {}
                return {
                    ua: navigator.userAgent,
                    platform: navigator.platform,
                    uaPlat: navigator.userAgentData ? navigator.userAgentData.platform : 'n/a',
                    webdriver: navigator.webdriver,
                    lang: navigator.language + ' (' + (navigator.languages || []).join(',') + ')',
                    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    screen: screen.width + 'x' + screen.height,
                    viewport: window.innerWidth + 'x' + window.innerHeight,
                    hasFocus: document.hasFocus(),
                    gpu
                };
            }""")
            print(f"  📊 [Patchright 実機診断] UA={diag_info['ua']} | Plat={diag_info['platform']}/{diag_info['uaPlat']} | WD={diag_info['webdriver']} | Lang={diag_info.get('lang')} | TZ={diag_info.get('tz')} | Screen={diag_info['screen']} | Focus={diag_info.get('hasFocus')} | WebGL={diag_info['gpu']}", flush=True)

            try:
                for px, py in [
                    (random.randint(380, 620), random.randint(260, 360)),
                    (random.randint(820, 1180), random.randint(340, 580)),
                    (random.randint(440, 610), random.randint(520, 620))
                ]:
                    human_move_mouse_curve(page, 640, 480, px, py)
                    rand_sleep(0.45, 0.95)
                page.mouse.wheel(0, random.randint(35, 80))
                rand_sleep(0.35, 0.65)
                page.mouse.wheel(0, -random.randint(35, 80))
                rand_sleep(0.5, 0.9)
            except Exception:
                pass

            print(f"\n📧 [Step 2: メール打鍵] \"{email}\" を人間リズムで入力します...", flush=True)
            human_type_into(page, inp_locator, email, clear_first=False)
            rand_sleep(2.2, 3.2)
            save_snap(page, shots_dir, root_dir, "shot_02_email_typed.png", f"メール ({email}) 打鍵完了")

            print("\n⏳ [Step 3: メール送信] 「続ける」ボタンを人間軌道でクリックします...", flush=True)
            click_modal_continue(page)

            state = "landing_signup_modal"
            cur_url = page.url
            lines = []
            for wait_i in range(1, 7):
                rand_sleep(3.8, 4.4)
                state, cur_url, lines = detect_page_state(page)
                print(f"  🔍 [送信後監視 ({wait_i*3}秒)] State={state} | URL={cur_url} | 文字={lines[:3]}", flush=True)
                if state in ["code_screen", "birth_screen", "account_setup_screen", "existing_login_screen", "face_liveness_screen", "prelude_gate_loading", "age_restricted_error"]:
                    rand_sleep(1.5, 2.5)
                    break
                has_begin_err = any("begin_login" in x.get("url", "") and ("おかしいです" in x.get("body", "") or "error" in x.get("body", "").lower()) for x in api_logs)
                if has_begin_err:
                    print("  ⚡ [ドメイン保護・即時中断] begin_login で拒絶応答を検知したため、同一ドメインでの再クリックを行わず即座に中断します", flush=True)
                    break

            save_snap(page, shots_dir, root_dir, "shot_03_after_email_submit.png", f"メール送信後 ({state})")
            if api_logs:
                print(f"  📡 [X内部API通信ログ (直近3件)] {json.dumps(api_logs[-3:], ensure_ascii=False)}", flush=True)
            else:
                print("  ⚠️ [X内部API通信ログ] 送信後のAPI通信が0件です（クリック未発火またはJSブロック）", flush=True)

            if state == "existing_login_screen":
                print("RESULT_JSON:" + json.dumps({"ok": False, "state": state, "reason": "already_registered", "emailConsumed": True}), flush=True)
                return

            if state in ["landing_signup_modal", "other", "face_liveness_screen", "age_restricted_error"]:
                print("RESULT_JSON:" + json.dumps({"ok": False, "state": state, "reason": state, "emailConsumed": False}), flush=True)
                return

            code_entered = False
            email_consumed = False
            birth_attempts = 0
            setup_attempts = 0
            setup_done = False
            post_auth_steps = 0
            final_user = profile["username"]
            final_auth_token = None
            final_cookies = []
            gemini_persona = None

            for step in range(1, 22):
                state, cur_url, lines = detect_page_state(page)
                save_snap(page, shots_dir, root_dir, f"shot_step_{step}_{state}.png", f"Onboarding Step {step}: {state}")
                print(f"\n🔄 [Onboarding Step {step}] State={state} | URL={cur_url} | 文字={lines[:4]}", flush=True)

                try:
                    all_c = context.cookies(["https://x.com", "https://twitter.com"])
                    auth_c = next((c for c in all_c if c.get("name") == "auth_token" and c.get("value")), None)
                    if auth_c:
                        if not final_auth_token:
                            print(f"🎉🎉 auth_token の発行を確認しました！ ({auth_c['value'][:12]}...)", flush=True)
                        final_auth_token = auth_c["value"]
                        final_cookies = all_c
                        if state == "home_screen":
                            print("  🏠 ホーム画面 (/home) への到達を確認しました！オンボーディング完了です！", flush=True)
                            break
                        post_auth_steps += 1
                        if "enable_notifications" in cur_url or "大切な瞬間を逃さない" in " ".join(lines):
                            if not click_any_skip_button(page):
                                try:
                                    page.mouse.click(1255, 124)
                                except Exception:
                                    pass
                            rand_sleep(3.2, 4.2)
                            save_snap(page, shots_dir, root_dir, "shot_10_home_reached.png", "通知スキップ後のホーム到達確認")
                            all_c = context.cookies(["https://x.com", "https://twitter.com"])
                            final_cookies = all_c
                            print("  ✅ 通知設定（「今はしない」）スキップ完了＆ホーム画面の最終Cookieを確定しました！", flush=True)
                            break
                        if post_auth_steps >= 6:
                            print("  ✅ auth_token 取得後の事後ステップ上限に達したため完了します！", flush=True)
                            break
                except Exception:
                    pass

                if state in ["age_restricted_error", "landing_signup_modal"]:
                    print(f"  ⚠️ 画面状態 ({state}) のため中断します...", flush=True)
                    break

                if state == "face_liveness_screen":
                    print("  ⚠️ オンボーディング中に顔認証 (face_liveness) が発生したため中断します...", flush=True)
                    break

                if state == "prelude_gate_loading":
                    print("  ⏳ 「本人確認の準備中」です。5秒間待機します...", flush=True)
                    rand_sleep(4.8, 5.5)
                    continue

                if state == "code_screen" and not code_entered:
                    email_consumed = True
                    print(f"  🎉🎉 メールアドレス ({email}) で6桁認証コード入力画面に到達しました！", flush=True)
                    if not email_pass:
                        print("RESULT_JSON:" + json.dumps({"ok": False, "state": "code_screen", "reason": "probe_success", "emailConsumed": False}), flush=True)
                        return
                    rand_sleep(3.0, 4.0)
                    sms_code = fetch_firstmail_code_via_node(root_dir, email, email_pass)
                    if not sms_code:
                        print("  ⚠️ 6桁確認コードが受信できなかったため中断します...", flush=True)
                        break

                    print(f"  🔢 受信した6桁確認コード [{sms_code}] を入力します...", flush=True)
                    code_inps = page.locator('[data-base-ui-portal] input:not([type="hidden"]), [role="dialog"] input:not([type="hidden"]), input:not([type="hidden"]):not(#landing-identifier):not([name="username_or_email"])')
                    if code_inps.count() >= 6:
                        code_inps.first.click()
                        rand_sleep(0.3, 0.6)
                        for d in sms_code:
                            page.keyboard.type(d, delay=random.randint(70, 140))
                    elif code_inps.count() >= 1:
                        human_type_into(page, code_inps.first, sms_code, clear_first=False)
                    else:
                        page.keyboard.type(sms_code, delay=random.randint(70, 140))

                    save_snap(page, shots_dir, root_dir, "shot_07_code_typed.png", "6桁コード打鍵完了")
                    for wait_i in range(7):
                        rand_sleep(1.8, 2.2)
                        st_after, _, _ = detect_page_state(page)
                        if st_after != "code_screen":
                            print(f"  ✅ 6桁コード自動検証完了！画面が [{st_after}] に遷移しました", flush=True)
                            break
                        if wait_i >= 2:
                            try:
                                modal_btns = page.locator('[role="dialog"] button:not([disabled]):not([aria-disabled="true"]), [data-base-ui-portal] button:not([disabled]):not([aria-disabled="true"])')
                                clicked_in_modal = False
                                for b_idx in range(modal_btns.count()):
                                    b_el = modal_btns.nth(b_idx)
                                    if not b_el.is_visible():
                                        continue
                                    b_txt = (b_el.inner_text() or "").strip()
                                    if any(k in b_txt for k in ["続ける", "次へ", "確認", "Continue", "Next", "Verify"]):
                                        box = b_el.bounding_box()
                                        if box and box["x"] > 600:
                                            print(f"  🖱️ [モーダル内ボタンクリック] 「{b_txt}」 (X:{int(box['x']+box['width']/2)}, Y:{int(box['y']+box['height']/2)})", flush=True)
                                            b_el.click()
                                            clicked_in_modal = True
                                            rand_sleep(3.0, 4.0)
                                            break
                                if not clicked_in_modal and wait_i == 4:
                                    page.keyboard.press("Enter")
                            except Exception:
                                pass
                    code_entered = True
                    continue

                if state == "birth_screen" and birth_attempts < 1:
                    birth_attempts += 1
                    by = str(profile["birthYear"])
                    bm = str(profile["birthMonth"])
                    bd = str(profile["birthDay"])
                    print(f"  🎂 [誕生日設定 (試行{birth_attempts})] 生年月日 ({by}-{bm}-{bd}) を設定します...", flush=True)
                    set_birth_date_reliably(page, by, bm, bd)
                    save_snap(page, shots_dir, root_dir, "shot_08_birth_set.png", "誕生日設定完了")
                    rand_sleep(1.2, 2.0)
                    click_modal_continue(page)
                    rand_sleep(4.5, 6.0)
                    continue

                if state == "account_setup_screen" and setup_attempts < 4:
                    setup_attempts += 1
                    if setup_attempts == 1 and gemini_persona is None:
                        age_num = int(profile.get("age", 30))
                        is_en_locale = target_locale.lower().startswith("en")
                        gemini_persona = fetch_gemini_persona_via_node(root_dir, final_user, age_num, target_locale, target_country)
                        persona_name = (gemini_persona or {}).get("name") or ""
                        name_is_japanese = any("\u3040" <= ch <= "\u30ff" or "\u4e00" <= ch <= "\u9fff" for ch in persona_name)
                        if persona_name and not (is_en_locale and name_is_japanese):
                            profile["displayName"] = persona_name

                    joined_lines = " ".join(lines)
                    if setup_attempts >= 2 and ("検証できません" in joined_lines or "validate" in joined_lines.lower()):
                        safe_names = ["Alex Turner", "Ryan Cooper", "Noah Bennett", "Liam Brooks", "Emma Collins", "Maya Foster"] if target_locale.lower().startswith("en") else ["たかし", "ちづる", "みなみ", "けんた", "はるき", "さくら", "なおと", "あかり"]
                        profile["displayName"] = random.choice(safe_names)
                        if gemini_persona:
                            gemini_persona["name"] = profile["displayName"]
                        print(f"  🔄 [名前再設定] シンプルな日本語名「{profile['displayName']}」へ変更します...", flush=True)

                    disp_name = profile["displayName"]
                    pw = profile["password"]
                    print(f"  🔐 [アカウント設定 (Step {setup_attempts})] 名前({disp_name}) / ID(@{final_user}) / PW({pw})", flush=True)

                    name_inp = page.locator('[data-base-ui-portal] input[name="name"]:not([type="hidden"]), [role="dialog"] input[name="name"]:not([type="hidden"])')
                    if name_inp.count() > 0 and name_inp.first.is_visible():
                        val = (name_inp.first.input_value() or "").strip()
                        is_inv = (name_inp.first.get_attribute("aria-invalid") == "true") or ("検証できません" in joined_lines)
                        if not val or is_inv or val != disp_name:
                            human_type_into(page, name_inp.first, disp_name, clear_first=True)

                    user_inp = page.locator('[data-base-ui-portal] input[name="username"]:not([type="hidden"]), [role="dialog"] input[name="username"]:not([type="hidden"])')
                    if user_inp.count() > 0 and user_inp.first.is_visible():
                        cur_u = (user_inp.first.input_value() or "").replace("@", "").strip()
                        if setup_attempts == 1 or len(cur_u) < 4:
                            human_type_into(page, user_inp.first, final_user, clear_first=True)
                        else:
                            final_user = cur_u
                        rand_sleep(1.8, 2.5)
                        now_txt = " ".join(detect_page_state(page)[2])
                        if user_inp.first.get_attribute("aria-invalid") == "true" or "利用できません" in now_txt or "使われています" in now_txt:
                            r_tail = "".join(random.choices("abcdefghjkmnpqrstuvwxyz23456789", k=5))
                            final_user = (final_user.split("_")[0][:6] + "_" + r_tail)[:14]
                            print(f"  🔄 [ID重複回避] 新ID (@{final_user}) を再入力します...", flush=True)
                            human_type_into(page, user_inp.first, final_user, clear_first=True)
                            rand_sleep(1.8, 2.4)

                    pw_inp = page.locator('[data-base-ui-portal] input[type="password"], [role="dialog"] input[type="password"], input[type="password"]')
                    if pw_inp.count() > 0 and pw_inp.first.is_visible():
                        cur_pw = pw_inp.first.input_value() or ""
                        if not cur_pw.strip():
                            human_type_into(page, pw_inp.first, pw, clear_first=False)
                        setup_done = True

                    save_snap(page, shots_dir, root_dir, "shot_09_account_setup_typed.png", "アカウント情報入力完了")
                    rand_sleep(1.5, 2.5)
                    click_modal_continue(page)
                    rand_sleep(6.5, 8.0)
                    continue

                if state == "interests_screen" or click_any_skip_button(page):
                    if state == "interests_screen":
                        click_any_skip_button(page)
                    rand_sleep(4.0, 5.5)
                    continue

                if state == "signup_preferences_screen" or setup_done:
                    page.evaluate("""() => {
                        const sw = document.querySelector('[role="switch"][aria-checked="true"], input[type="checkbox"]:checked');
                        if (sw) sw.click();
                    }""")
                    rand_sleep(0.6, 1.0)
                    if click_modal_continue(page):
                        rand_sleep(5.0, 6.5)
                        continue

                rand_sleep(3.5, 4.5)

            if not final_auth_token:
                try:
                    all_c = context.cookies(["https://x.com", "https://twitter.com"])
                    auth_c = next((c for c in all_c if c.get("name") == "auth_token" and c.get("value")), None)
                    if auth_c:
                        final_auth_token = auth_c["value"]
                        final_cookies = all_c
                except Exception:
                    pass

            print("RESULT_JSON:" + json.dumps({
                "ok": bool(final_auth_token),
                "state": state,
                "reason": state,
                "authToken": final_auth_token,
                "cookies": final_cookies,
                "finalUser": final_user,
                "finalName": profile.get("displayName", ""),
                "geminiPersona": gemini_persona,
                "ua": diag_info.get("ua", ""),
                "userAgent": diag_info.get("ua", ""),
                "emailConsumed": bool(final_auth_token or email_consumed or code_entered)
            }), flush=True)
    finally:
        shutil.rmtree(user_data_dir, ignore_errors=True)

if __name__ == "__main__":
    main()
