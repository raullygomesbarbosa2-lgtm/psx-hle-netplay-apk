import React from 'react';
import { openDndAccessSettings, setRemotePrivacyEnabled } from '../emulator/remotePrivacy';
import { ShieldCheck, X } from 'lucide-react';

interface RemotePrivacySettingsProps {
  enabled: boolean;
  onClose: () => void;
}

export const RemotePrivacySettings: React.FC<RemotePrivacySettingsProps> = ({ enabled, onClose }) => (
  <div className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="remote-privacy-title">
    <section className="w-full max-w-lg rounded-2xl border border-[#303847] bg-[#151922] p-5 shadow-2xl space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="rounded-xl bg-emerald-500/10 p-2 text-emerald-400"><ShieldCheck className="h-5 w-5" /></div>
          <div>
            <h2 id="remote-privacy-title" className="text-base font-bold text-white">🔒 MODO PRIVACIDADE REMOTE PLAY</h2>
            <p className="mt-1 text-xs text-slate-400">Proteção local enquanto você joga ou participa de uma sessão remota.</p>
          </div>
        </div>
        <button onClick={onClose} aria-label="Fechar" className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-white"><X className="h-5 w-5" /></button>
      </header>

      <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-[#2b3340] bg-[#10141b] p-4">
        <span>
          <span className="block text-sm font-semibold text-white">Ativar proteção automática</span>
          <span className="mt-1 block text-xs text-slate-400">Aplica Não Perturbe temporário no aparelho durante jogo/sessão. Restaura o modo anterior ao sair.</span>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setRemotePrivacyEnabled(e.target.checked)}
          className="h-5 w-5 accent-emerald-500"
          aria-label="Ativar proteção automática"
        />
      </label>

      <div className="rounded-xl border border-blue-900/60 bg-blue-950/25 p-4 text-xs leading-relaxed text-slate-300">
        A transmissão do P1 é composta somente pela imagem do canvas do jogo e pelo áudio do emulador (WebRTC/PCM); não captura a tela, notificações nem microfone. Se você não autorizar o Não Perturbe, essa proteção da transmissão continua valendo, mas notificações ainda podem aparecer no seu próprio aparelho.
      </div>

      <button type="button" onClick={openDndAccessSettings} className="w-full rounded-xl border border-[#354052] bg-[#202633] px-4 py-3 text-sm font-medium text-white hover:bg-[#293243]">
        Configurar autorização do Não Perturbe
      </button>
      <p className="text-[11px] leading-relaxed text-slate-500">O Android pode pedir autorização especial. Ela só é usada temporariamente durante a sessão; o app não desativa notificações permanentemente. Em navegadores sem integração Android, o envio continua restrito ao jogo.</p>
    </section>
  </div>
);
