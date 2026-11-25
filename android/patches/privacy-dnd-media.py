from pathlib import Path

p = Path('android/app/src/main/java/com/psxhle/netplay/MainActivity.kt')
s = p.read_text()
start = s.find('    private fun activateTemporaryDndOrAsk() {')
end = s.find('    private fun openDndSettingsPage() {', start)
if start < 0 or end < 0: raise SystemExit('Could not locate native notification privacy functions')
replacement = '''    private fun makeNotificationPolicy(categories: Int, callSenders: Int, messageSenders: Int, visuals: Int): NotificationManager.Policy =
        if (Build.VERSION.SDK_INT >= 28) {
            NotificationManager.Policy(categories, callSenders, messageSenders, visuals)
        } else {
            @Suppress("DEPRECATION")
            NotificationManager.Policy(categories, callSenders, messageSenders)
        }

    private fun activateTemporaryDndOrAsk() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        if (privacyPrefs.getBoolean("active", false)) return
        if (!hasDndAccess()) {
            pendingDndActivation = true
            if (!dndAccessPromptShown) {
                dndAccessPromptShown = true
                AlertDialog.Builder(this)
                    .setTitle("Ativar proteção de notificações?")
                    .setMessage("Com sua autorização, o app usa temporariamente Não Perturbe em modo Prioridade: notificações pessoais são filtradas e áudio de mídia do jogo permanece permitido. A configuração anterior é restaurada ao encerrar. Isso não altera o volume nem suspende o áudio do emulador.")
                    .setPositiveButton("Configurar") { _, _ -> openDndSettingsPage() }
                    .setNegativeButton("Agora não") { _, _ -> pendingDndActivation = false }
                    .setOnCancelListener { pendingDndActivation = false }
                    .show()
            }
            return
        }
        pendingDndActivation = false
        val manager = notificationManager() ?: return
        try {
            val previous = manager.currentInterruptionFilter
            val oldPolicy = manager.notificationPolicy
            val oldVisuals = if (Build.VERSION.SDK_INT >= 28) oldPolicy.suppressedVisualEffects else 0
            privacyPrefs.edit()
                .putInt("previous_filter", previous)
                .putInt("previous_policy_categories", oldPolicy.priorityCategories)
                .putInt("previous_policy_calls", oldPolicy.priorityCallSenders)
                .putInt("previous_policy_messages", oldPolicy.priorityMessageSenders)
                .putInt("previous_policy_visuals", oldVisuals)
                .putBoolean("active", true)
                .apply()
            // DND is independent from emulation/audio. Allow Android media output; suppress
            // calls/messages/notification visuals. No volume, AudioContext, AudioTrack or PCM API
            // is changed by this privacy handler.
            val visuals = if (Build.VERSION.SDK_INT >= 28) NotificationManager.Policy.SUPPRESSED_EFFECT_ALL else 0
            manager.setNotificationPolicy(makeNotificationPolicy(
                NotificationManager.Policy.PRIORITY_CATEGORY_MEDIA,
                0,
                0,
                visuals
            ))
            manager.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
        } catch (_: SecurityException) {
            runCatching { restorePreviousDndFilter() }
            Toast.makeText(this, "Não foi possível ativar a proteção de notificações. O áudio do jogo não foi alterado.", Toast.LENGTH_LONG).show()
        } catch (_: Throwable) {
            runCatching { restorePreviousDndFilter() }
        }
    }

    private fun restorePreviousDndFilter() {
        pendingDndActivation = false
        if (!privacyPrefs.getBoolean("active", false)) return
        if (!hasDndAccess()) {
            pendingDndRestore = true
            return
        }
        try {
            val manager = notificationManager() ?: return
            if (privacyPrefs.contains("previous_policy_categories")) {
                manager.setNotificationPolicy(makeNotificationPolicy(
                    privacyPrefs.getInt("previous_policy_categories", 0),
                    privacyPrefs.getInt("previous_policy_calls", NotificationManager.Policy.PRIORITY_SENDERS_ANY),
                    privacyPrefs.getInt("previous_policy_messages", NotificationManager.Policy.PRIORITY_SENDERS_ANY),
                    privacyPrefs.getInt("previous_policy_visuals", 0)
                ))
            }
            val previous = privacyPrefs.getInt("previous_filter", NotificationManager.INTERRUPTION_FILTER_ALL)
            manager.setInterruptionFilter(previous)
        } catch (_: Throwable) {
            pendingDndRestore = true
            return
        }
        privacyPrefs.edit()
            .putBoolean("active", false)
            .remove("previous_filter")
            .remove("previous_policy_categories")
            .remove("previous_policy_calls")
            .remove("previous_policy_messages")
            .remove("previous_policy_visuals")
            .apply()
        pendingDndRestore = false
    }

'''
s = s[:start] + replacement + s[end:]
p.write_text(s)
print('Android privacy filter now allows media, filters notifications, and restores the previous DND policy.')
