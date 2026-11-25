from pathlib import Path
p = Path('android/app/src/main/java/com/psxhle/netplay/MainActivity.kt')
s = p.read_text()
start = s.find('    private fun makeNotificationPolicy(')
end = s.find('    private fun activateTemporaryDndOrAsk()', start)
if start < 0 or end < 0: raise SystemExit('Policy helper not found')
s = s[:start] + '''    @Suppress("DEPRECATION")
    private fun makeNotificationPolicy(categories: Int, callSenders: Int, messageSenders: Int): NotificationManager.Policy =
        NotificationManager.Policy(categories, callSenders, messageSenders)

'''+s[end:]
s = s.replace('''            val oldVisuals = if (Build.VERSION.SDK_INT >= 28) oldPolicy.suppressedVisualEffects else 0
''','')
s = s.replace('''                .putInt("previous_policy_visuals", oldVisuals)
''','')
s = s.replace('''            val visuals = if (Build.VERSION.SDK_INT >= 28) NotificationManager.Policy.SUPPRESSED_EFFECT_ALL else 0
            manager.setNotificationPolicy(makeNotificationPolicy(
                NotificationManager.Policy.PRIORITY_CATEGORY_MEDIA,
                0,
                0,
                visuals
            ))
''','''            manager.setNotificationPolicy(makeNotificationPolicy(
                NotificationManager.Policy.PRIORITY_CATEGORY_MEDIA,
                0,
                0
            ))
''')
s = s.replace('''                    privacyPrefs.getInt("previous_policy_messages", NotificationManager.Policy.PRIORITY_SENDERS_ANY),
                    privacyPrefs.getInt("previous_policy_visuals", 0)
''','''                    privacyPrefs.getInt("previous_policy_messages", NotificationManager.Policy.PRIORITY_SENDERS_ANY)
''')
s = s.replace('''            .remove("previous_policy_visuals")
''','')
if 'SUPPRESSED_EFFECT_ALL' in s or 'previous_policy_visuals' in s:
    raise SystemExit('Could not remove API-28-only DND policy fields')
p.write_text(s)
print('Used the Android 6-compatible three-argument priority policy constructor while preserving media audio.')
