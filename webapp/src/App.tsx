/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { useCallback, useEffect, useState } from 'react';
import { Settings2 } from 'lucide-react';
import { RemotePrivacySettings } from './components/RemotePrivacySettings';
import { useRemotePrivacyEnabled } from './emulator/remotePrivacy';
import { onIdTokenChanged, signOut, User } from 'firebase/auth';
import { AndroidHleSdkView } from './components/AndroidHleSdkView';
import { AuthGate } from './components/AuthGate';
import { ErrorBoundary } from './components/ErrorBoundary';
import { GameCatalogView } from './components/GameCatalogView';
import { NetPlayPanel } from './components/NetPlayPanel';
import { SoloEmulatorView } from './components/SoloEmulatorView';
import { IsoMountInfo } from './emulator/types';
import { auth, ensureVerifiedUserProfile } from './firebase/firebaseClient';

type ActiveTab = 'solo' | 'netplay' | 'jogos' | 'sdk';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [verifiedReady, setVerifiedReady] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>('solo');
  const [recentIsos, setRecentIsos] = useState<IsoMountInfo[]>([]);
  const [inviteRoomCode, setInviteRoomCode] = useState<string>('');
  const [privacySettingsOpen, setPrivacySettingsOpen] = useState(false);
  const privacyEnabled = useRemotePrivacyEnabled();

  const recordMountedIso = useCallback((info: IsoMountInfo) => {
    setRecentIsos((prev) => {
      const filtered = prev.filter((item) => item.filename !== info.filename);
      return [info, ...filtered].slice(0, 12);
    });
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setInviteRoomCode(roomParam.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
      setActiveTab('netplay');
    }
  }, []);

  const syncVerifiedProfile = useCallback(async (u: User | null) => {
    if (!u || !u.emailVerified) {
      setVerifiedReady(false);
      return;
    }
    const ok = await ensureVerifiedUserProfile(u);
    setVerifiedReady(ok);
  }, []);

  useEffect(() => {
    const unsub = onIdTokenChanged(auth, async (u) => {
      setUser(u);
      setAuthReady(true);
      if (u && u.emailVerified) {
        try {
          await syncVerifiedProfile(u);
        } catch {
          setVerifiedReady(false);
        }
      } else {
        setVerifiedReady(false);
      }
    });
    return () => unsub();
  }, [syncVerifiedProfile]);

  const handleVerifiedRefresh = async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true);
    const current = auth.currentUser;
    setUser(current);
    if (current?.emailVerified) {
      await syncVerifiedProfile(current);
    }
  };

  const isVerifiedSignedIn = Boolean(user && user.emailVerified && verifiedReady);

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#0F1115] text-[#E5E7EB] flex flex-col">
        {/* Strict 3-Zone Top Navigation Bar */}
        <header className="border-b border-[#262B36] bg-[#13161C]">
          <div className="max-w-7xl mx-auto px-6 h-[68px] flex items-center justify-between gap-8">
            {/* Zone 1: Single-line Brand Wordmark */}
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('solo');
              }}
              className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
            >
              PSX HLE
            </a>

            {/* Zone 2: Clean Single-Line Nav Links */}
            <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-400">
              <button
                type="button"
                onClick={() => setActiveTab('solo')}
                className={`whitespace-nowrap shrink-0 transition-colors hover:text-white ${
                  activeTab === 'solo' ? 'text-white underline underline-offset-8 decoration-blue-500' : ''
                }`}
              >
                Solo
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('netplay')}
                className={`whitespace-nowrap shrink-0 transition-colors hover:text-white ${
                  activeTab === 'netplay' ? 'text-white underline underline-offset-8 decoration-blue-500' : ''
                }`}
              >
                NetPlay
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('jogos')}
                className={`whitespace-nowrap shrink-0 transition-colors hover:text-white ${
                  activeTab === 'jogos' ? 'text-white underline underline-offset-8 decoration-blue-500' : ''
                }`}
              >
                Discos
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('sdk')}
                className={`whitespace-nowrap shrink-0 transition-colors hover:text-white ${
                  activeTab === 'sdk' ? 'text-white underline underline-offset-8 decoration-blue-500' : ''
                }`}
              >
                SDK Android
              </button>
            </nav>

            {/* Zone 3: account and privacy settings */}
            <div className="shrink-0 flex items-center gap-2">
              <button type="button" onClick={() => setPrivacySettingsOpen(true)} aria-label="Configurações de privacidade" title="Modo Privacidade Remote Play" className={`relative rounded-lg border p-2 transition-colors ${privacyEnabled ? 'border-emerald-800/70 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/40' : 'border-[#2E3543] bg-[#20242E] text-slate-400 hover:text-white'}`}>
                <Settings2 className="h-4 w-4" />
                {privacyEnabled && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-emerald-400" />}
              </button>
              {isVerifiedSignedIn && user ? (
                <button
                  type="button"
                  onClick={() => signOut(auth)}
                  className="px-4 py-2 text-xs font-medium bg-[#20242E] hover:bg-[#2A303D] text-slate-100 border border-[#2E3543] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Sair ({user.displayName || user.email?.split('@')[0]})
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveTab('solo')}
                  className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Criar Conta
                </button>
              )}
            </div>
          </div>

          {/* Mobile compact nav row */}
          {isVerifiedSignedIn && (
            <div className="md:hidden border-t border-[#262B36] px-4 py-2 flex items-center justify-around text-xs font-medium text-slate-400">
              <button
                type="button"
                onClick={() => setActiveTab('solo')}
                className={`whitespace-nowrap shrink-0 px-2 py-1 ${activeTab === 'solo' ? 'text-white' : ''}`}
              >
                Solo
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('netplay')}
                className={`whitespace-nowrap shrink-0 px-2 py-1 ${activeTab === 'netplay' ? 'text-white' : ''}`}
              >
                NetPlay
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('jogos')}
                className={`whitespace-nowrap shrink-0 px-2 py-1 ${activeTab === 'jogos' ? 'text-white' : ''}`}
              >
                Discos
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('sdk')}
                className={`whitespace-nowrap shrink-0 px-2 py-1 ${activeTab === 'sdk' ? 'text-white' : ''}`}
              >
                SDK Android
              </button>
            </div>
          )}
        </header>

        {/* Main Content */}
        <main className="flex-1">
          {!authReady ? (
            <div className="min-h-[60vh] flex items-center justify-center text-sm text-slate-400">
              Inicializando autenticação Firebase...
            </div>
          ) : !isVerifiedSignedIn || !user ? (
            <AuthGate
              currentUser={user}
              onVerifiedRefresh={handleVerifiedRefresh}
            />
          ) : activeTab === 'solo' ? (
            <SoloEmulatorView user={user} onIsoMounted={recordMountedIso} />
          ) : activeTab === 'netplay' ? (
            <NetPlayPanel
              user={user}
              initialJoinCode={inviteRoomCode}
              onIsoMounted={recordMountedIso}
            />
          ) : activeTab === 'jogos' ? (
            <GameCatalogView
              user={user}
              recentIsos={recentIsos}
              onGoSolo={() => setActiveTab('solo')}
              onOpenNetPlay={() => setActiveTab('netplay')}
            />
          ) : (
            <AndroidHleSdkView />
          )}
        </main>
        {privacySettingsOpen && (
          <RemotePrivacySettings enabled={privacyEnabled} onClose={() => setPrivacySettingsOpen(false)} />
        )}
      </div>
    </ErrorBoundary>
  );
}
