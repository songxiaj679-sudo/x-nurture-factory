with open('views/dashboard_view.html', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Add checkIsEn() helper right after <script>
script_idx = content.find('<script>')
if script_idx == -1:
    print("ERROR: <script> not found")
    exit(1)

insert_pos = script_idx + len('<script>\n')
helper_code = """    function checkIsEn() {
      return (typeof currentLang !== 'undefined' && currentLang === 'en') ||
             (typeof window !== 'undefined' && window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');
    }
"""

if 'function checkIsEn()' not in content:
    content = content[:insert_pos] + helper_code + content[insert_pos:]
    print("Inserted checkIsEn() helper")

# 2. Replace all 16 occurrences of broken isEn assignment
broken_str = "const isEn = (currentLang === 'en') || (d.lang === 'en') || (window.__DASHBOARD_CONFIG__ && window.__DASHBOARD_CONFIG__.configuredAiLang === 'en');"
fixed_str = "const isEn = checkIsEn();"

count = content.count(broken_str)
content = content.replace(broken_str, fixed_str)
print(f"Replaced {count} occurrences of broken isEn string")

# 3. Enhance slotNameText in renderJobCard to support all 5 slots
old_slot_logic = """            let slotNameText = '☕ 戦略スロット';
            const slot = job.timeSlot || 'morning';
            if (slot === 'morning') slotNameText = isEn ? '🌅 MORNING PEAK (08:30)' : '🌅 朝枠 (08:30 JST)';
            else if (slot === 'noon') slotNameText = isEn ? '☀️ NOON LUNCH (12:30)' : '☀️ 昼枠 (12:30 JST)';
            else if (slot === 'evening') slotNameText = isEn ? '🌙 EVENING PRIME (20:00)' : '🌙 夜枠 (20:00 JST)';"""

new_slot_logic = """            let slotNameText = isEn ? '☕ STRATEGIC SLOT' : '☕ 戦略スロット';
            const slot = job.timeSlot || 'morning';
            if (slot === 'morning') slotNameText = isEn ? '🌅 MORNING PEAK (08:30)' : '🌅 朝枠 (08:30 JST)';
            else if (slot === 'noon') slotNameText = isEn ? '☀️ NOON LUNCH (12:30)' : '☀️ 昼枠 (12:30 JST)';
            else if (slot === 'afternoon') slotNameText = isEn ? '☕ AFTERNOON DRIVE (17:30)' : '☕ 夕方枠 (17:30 JST)';
            else if (slot === 'evening') slotNameText = isEn ? '🌙 EVENING PRIME (20:00)' : '🌙 夜枠 (20:00 JST)';
            else if (slot === 'night' || slot === 'late_night') slotNameText = isEn ? '🌌 LATE NIGHT (22:30)' : '🌌 深夜枠 (22:30 JST)';"""

if old_slot_logic in content:
    content = content.replace(old_slot_logic, new_slot_logic, 1)
    print("Enhanced slotNameText to support all 5 golden-hour slots!")
else:
    print("Warning: old_slot_logic not found in content")

# 4. Remove duplicate cont.innerHTML = html;
content = content.replace("cont.innerHTML = html;\n\ncont.innerHTML = html;", "cont.innerHTML = html;")

with open('views/dashboard_view.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("SUCCESS: views/dashboard_view.html updated!")
