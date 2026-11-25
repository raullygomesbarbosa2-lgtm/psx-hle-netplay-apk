import React, { useCallback, useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  AlertTriangle,
  Bluetooth,
  Disc,
  Gamepad2,
  HardDrive,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Save,
  ShieldCheck,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { PsxConsole } from '../emulator/psxConsole';
import {
  checkBrowserWasmMemorySafety,
  loadEjsRuntime,
  PsxWasmEngine,
  WasmSafetyCheckResult,
} from '../emulator/psxWasmEngine';
import { PsxSpu } from '../emulator/psxSpu';
import { StreamingIsoReader } from '../emulator/streamingIsoReader';
import {
  createIdlePadState,
  IsoMountInfo,
  mergePadStates,
  PsxPadState,
} from '../emulator/types';
import {
  SaveSlotDoc,
  saveMemoryCardSlot,
  subscribeUserSaveSlots,
} from '../firebase/firebaseClient';
import { useHardwareGamepad } from '../hooks/useHardwareGamepad';
import { setPrivacySessionActive, useRemotePrivacyEnabled } from '../emulator/remotePrivacy';
import { Ps1BootSplash } from './Ps1BootSplash';
import { VirtualGamepad } from './VirtualGamepad';

interface SoloEmulatorViewProps {
  user: User;
  onIsoMounted?: (info: IsoMountInfo) => void;
}

interface OomPromptState {
  file: File;
  info: IsoMountInfo;
  safety: WasmSafetyCheckResult;
}

const ACCEPTED_DISC_EXT = /\.(bin|iso|img|chd|pbp|mdf|zip|7z|rar|exe|psx)$/i;

export const SoloEmulatorView: React.FC<SoloEmulatorViewProps> = ({
  user,
  onIsoMounted,
}) => {
  const engineRef = useRef<PsxWasmEngine | null>(null);
  const streamConsoleRef = useRef<PsxConsole | null>(null);
  const streamCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const spuRef = useRef<PsxSpu>(new PsxSpu());
  const ejsHostRef = useRef<HTMLDivElement | null>(null);
  const screenWrapRef = useRef<HTMLDivElement | null>(null);
  const lastFileRef = useRef<File | null>(null);
  const bootTimerRef = useRef<number | null>(null);
  const minLogoTimerRef = useRef<number | null>(null);

  const [mountedIso, setMountedIso] = useState<IsoMountInfo | null>(null);
  const [activeBackend, setActiveBackend] = useState<'idle' | 'wasm' | 'streaming'>('idle');
  const [oomPrompt, setOomPrompt] = useState<OomPromptState | null>(null);
  const [gameStarted, setGameStarted] = useState(false);
  const [bootPhase, setBootPhase] = useState<'idle' | 'sce' | 'ps' | 'done'>('idle');
  const [minLogoDone, setMinLogoDone] = useState(false);
  const [frameCount, setFrameCount] = useState(0);
  const [hleLogs, setHleLogs] = useState<string[]>([]);
  const [audioOn, setAudioOn] = useState(true);
  const [crtScanlines, setCrtScanlines] = useState(false);
  const [virtualGamepadOn, setVirtualGamepadOn] = useState(true);
  const [paused, setPaused] = useState(false);
  const [saveSlots, setSaveSlots] = useState<SaveSlotDoc[]>([]);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [isoLoading, setIsoLoading] = useState(false);
  const privacyEnabled = useRemotePrivacyEnabled();
  const [dragActive, setDragActive] = useState(false);
  const [isoError, setIsoError] = useState<string | null>(null);

  const pushLog = useCallback((msg: string) => {
    setHleLogs((prev) => [...prev.slice(-30), msg]);
  }, []);

  useEffect(() => {
    const active = Boolean(gameStarted && activeBackend !== 'idle' && !paused && privacyEnabled);
    setPrivacySessionActive(active);
    return () => setPrivacySessionActive(false);
  }, [gameStarted, activeBackend, paused, privacyEnabled]);

  useEffect(() => {
    const unsub = subscribeUserSaveSlots(user.uid, (slots) => {
      setSaveSlots(slots);
    });
    return () => unsub();
  }, [user.uid]);

  useEffect(() => {
    const engine = new PsxWasmEngine();
    engineRef.current = engine;
    void loadEjsRuntime().catch(() => {});

    const timer = window.setInterval(() => {
      if (engineRef.current?.isRunning()) {
        setFrameCount(engineRef.current.getFrameCount());
      }
    }, 500);

    return () => {
      window.clearInterval(timer);
      if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current);
      if (minLogoTimerRef.current) window.clearTimeout(minLogoTimerRef.current);
      engine.destroy();
      engineRef.current = null;
      streamConsoleRef.current?.stop();
      streamConsoleRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (gameStarted && minLogoDone && bootPhase !== 'done') {
      setBootPhase('done');
    }
  }, [gameStarted, minLogoDone, bootPhase]);

  const startBootSplashSequence = useCallback(() => {
    if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current);
    if (minLogoTimerRef.current) window.clearTimeout(minLogoTimerRef.current);
    setPaused(false);
    setGameStarted(false);
    setMinLogoDone(false);
    setBootPhase('sce');
    spuRef.current.setEnabled(audioOn);
    spuRef.current.unlock();
    spuRef.current.playSfx('boot');

    bootTimerRef.current = window.setTimeout(() => {
      setBootPhase((cur) => (cur === 'sce' ? 'ps' : cur));
    }, 1100);
    minLogoTimerRef.current = window.setTimeout(() => {
      setMinLogoDone(true);
    }, 2200);
  }, [audioOn]);

  const launchWasmMode = async (file: File, info: IsoMountInfo) => {
    const engine = engineRef.current;
    const host = ejsHostRef.current;
    if (!engine || !host) return;

    streamConsoleRef.current?.stop();
    streamConsoleRef.current = null;

    setOomPrompt(null);
    setIsoError(null);
    setIsoLoading(true);
    setActiveBackend('wasm');
    setFrameCount(0);
    startBootSplashSequence();

    pushLog(`[ISO] Título: ${info.recognizedTitle.title} (${info.serial})`);
    pushLog(
      `[ISO] Formato: ${(info.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB · ${info.bootExePath}`,
    );
    pushLog('[HLE] Inicializando núcleo PCSX-ReARMed WASM (sem BIOS externa)...');

    try {
      await engine.mountDisc({
        container: host,
        containerId: 'psx-solo-ejs-player',
        file,
        audioEnabled: audioOn,
        enableFrameCapture: false,
        onReady: () => {
          pushLog('[HLE] Núcleo PS1 pronto, montando imagem do disco...');
        },
        onGameStart: () => {
          setGameStarted(true);
          pushLog('[GPU] Jogo PS1 iniciado em tempo real.');
        },
      });
    } catch (err) {
      if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current);
      if (minLogoTimerRef.current) window.clearTimeout(minLogoTimerRef.current);
      const message = err instanceof Error ? err.message : 'Falha ao carregar imagem PS1.';
      setIsoError(message);
      setBootPhase('done');
      setActiveBackend('idle');
      pushLog(`[ERRO] ${message}`);
    } finally {
      setIsoLoading(false);
    }
  };

  const launchStreamingMode = async (file: File, info: IsoMountInfo) => {
    engineRef.current?.destroy();
    streamConsoleRef.current?.stop();

    setOomPrompt(null);
    setIsoError(null);
    setIsoLoading(true);
    setActiveBackend('streaming');
    setFrameCount(0);
    startBootSplashSequence();

    pushLog(`[STREAM] Modo Streaming Seguro ativado (${info.serial}) · < 8 MB RAM.`);

    const psx = new PsxConsole();
    psx.spu.setEnabled(audioOn);
    streamConsoleRef.current = psx;

    let localFrames = 0;
    psx.onFrame((rgba) => {
      const canvas = streamCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const imgData = new ImageData(new Uint8ClampedArray(rgba), 320, 240);
      ctx.putImageData(imgData, 0, 0);
      localFrames += 1;
      if (localFrames % 15 === 0) {
        setFrameCount(localFrames);
      }
    });

    try {
      await psx.bootUserFile(file);
      setGameStarted(true);
      pushLog('[STREAM] Disco montado via File.slice() sem risco de fechar a aba.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao montar ISO em streaming.';
      setIsoError(message);
      setBootPhase('done');
      setActiveBackend('idle');
    } finally {
      setIsoLoading(false);
    }
  };

  const bootSelectedFile = async (file: File) => {
    if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current);
    if (minLogoTimerRef.current) window.clearTimeout(minLogoTimerRef.current);

    setIsoLoading(true);
    setIsoError(null);
    setSaveNotice(null);
    setOomPrompt(null);
    setGameStarted(false);
    setMinLogoDone(false);
    setBootPhase('idle');
    setFrameCount(0);
    setHleLogs([`[ISO] Analisando arquivo: ${file.name}...`]);

    if (/\.cue$/i.test(file.name) && file.size < 65536) {
      setIsoError(
        `Você selecionou apenas o índice "${file.name}". Selecione o arquivo principal do disco (.BIN, .ISO, .IMG, .CHD, .PBP ou .ZIP).`,
      );
      setIsoLoading(false);
      return;
    }

    try {
      const reader = new StreamingIsoReader(file);
      const { info } = await reader.mount();
      const safety = checkBrowserWasmMemorySafety(info);

      if (safety.blockedReason) {
        setIsoError(safety.blockedReason);
        setIsoLoading(false);
        return;
      }

      lastFileRef.current = file;
      setMountedIso(info);
      onIsoMounted?.(info);

      if (info.isDirectExe) {
        await launchStreamingMode(file, info);
        return;
      }

      if (safety.requiresStreamingPrompt) {
        engineRef.current?.destroy();
        streamConsoleRef.current?.stop();
        setActiveBackend('idle');
        setOomPrompt({ file, info, safety });
        pushLog(
          `[RAM] ISO de ${safety.sizeMb.toFixed(1)} MB excede limite seguro da aba (${safety.limitMb} MB). Aguardando escolha de modo.`,
        );
        setIsoLoading(false);
        return;
      }

      await launchWasmMode(file, info);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Falha ao carregar imagem PS1.';
      setIsoError(message);
      setBootPhase('done');
      pushLog(`[ERRO] ${message}`);
      setIsoLoading(false);
    }
  };

  const pickBestDiscFile = (files: File[]): File => {
    return files.find((f) => ACCEPTED_DISC_EXT.test(f.name)) ?? files[0];
  };

  const handleIsoFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    await bootSelectedFile(pickBestDiscFile(files));
    e.target.value = '';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;
    await bootSelectedFile(pickBestDiscFile(files));
  };

  const hardwarePadRef = useRef<PsxPadState>(createIdlePadState());
  const virtualPadRef = useRef<PsxPadState>(createIdlePadState());

  const emitMergedPad = useCallback(() => {
    const merged = mergePadStates(hardwarePadRef.current, virtualPadRef.current);
    if (activeBackend === 'streaming') {
      streamConsoleRef.current?.spu.unlock();
      streamConsoleRef.current?.setPadState(1, merged);
    } else {
      engineRef.current?.resumeAudio();
      engineRef.current?.applyPadState(0, merged);
    }
  }, [activeBackend]);

  const handleHardwarePadChange = useCallback(
    (state: PsxPadState) => {
      hardwarePadRef.current = state;
      emitMergedPad();
    },
    [emitMergedPad],
  );

  const handleVirtualPadChange = useCallback(
    (state: PsxPadState) => {
      virtualPadRef.current = state;
      emitMergedPad();
    },
    [emitMergedPad],
  );

  const btPadName = useHardwareGamepad(!mountedIso || !gameStarted, handleHardwarePadChange);

  const handleSaveSlot = async (slotIndex: number) => {
    if (!mountedIso) return;
    const encoded =
      activeBackend === 'streaming'
        ? streamConsoleRef.current?.exportMemoryCardState() ?? null
        : engineRef.current?.exportMemoryCardSram() ?? null;

    if (!encoded) {
      setSaveNotice('Aguarde o jogo iniciar ou gravar no Memory Card para salvar.');
      setTimeout(() => setSaveNotice(null), 3000);
      return;
    }

    await saveMemoryCardSlot({
      uid: user.uid,
      gameId: mountedIso.serial.replace(/[^a-zA-Z0-9_-]/g, '_') || 'PSX_ISO',
      gameTitle: mountedIso.recognizedTitle.title || mountedIso.filename,
      slotIndex,
      label: `${mountedIso.recognizedTitle.title || mountedIso.filename} · Slot ${slotIndex}`,
      memoryCardData: encoded,
    });
    setSaveNotice(`Memory Card salvo na nuvem (Slot ${slotIndex}).`);
    setTimeout(() => setSaveNotice(null), 2500);
  };

  const handleLoadSlot = (slot: SaveSlotDoc) => {
    const ok =
      activeBackend === 'streaming'
        ? streamConsoleRef.current?.importMemoryCardState(slot.memoryCardData) ?? false
        : engineRef.current?.importMemoryCardSram(slot.memoryCardData) ?? false;
    setSaveNotice(
      ok
        ? `Memory Card carregado: ${slot.label}.`
        : 'Inicie o jogo antes de restaurar o Memory Card.',
    );
    setTimeout(() => setSaveNotice(null), 2500);
  };

  const toggleFullscreen = () => {
    if (!screenWrapRef.current) return;
    if (!document.fullscreenElement) {
      screenWrapRef.current.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Main Emulator Viewport + DualShock */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-[#171A21] border border-[#262B36] rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-0.5">
                <div className="text-sm font-semibold text-white">
                  {mountedIso ? mountedIso.recognizedTitle.title : 'Bandeja de Disco PS1 Vazia'}
                </div>
                <div className="text-xs font-mono text-slate-400 tabular-nums">
                  {mountedIso
                    ? `${mountedIso.serial} · ${
                        oomPrompt
                          ? 'Proteção de RAM ativa'
                          : gameStarted
                            ? `Rodando (${activeBackend === 'streaming' ? 'Streaming' : 'WASM'} · Quadro ${frameCount})`
                            : 'Carregando núcleo HLE...'
                      }`
                    : 'Núcleo HLE sem BIOS · Suporta .iso, .bin, .img, .chd, .pbp, .zip, .7z e .exe'}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!mountedIso || !gameStarted}
                  onClick={() => {
                    const next = !paused;
                    setPaused(next);
                    if (activeBackend === 'streaming') {
                      streamConsoleRef.current?.setPaused(next);
                    } else {
                      engineRef.current?.setPaused(next);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#0F1115] hover:bg-[#1E232D] disabled:opacity-50 border border-[#262B36] rounded-md text-slate-200 whitespace-nowrap shrink-0"
                >
                  {paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                  {paused ? 'Continuar' : 'Pausar'}
                </button>

                <button
                  type="button"
                  disabled={!lastFileRef.current || !gameStarted}
                  onClick={() => {
                    if (activeBackend === 'streaming' && lastFileRef.current && mountedIso) {
                      void launchStreamingMode(lastFileRef.current, mountedIso);
                    } else {
                      engineRef.current?.restart();
                    }
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#0F1115] hover:bg-[#1E232D] disabled:opacity-50 border border-[#262B36] rounded-md text-slate-200 whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reiniciar ISO
                </button>

                <button
                  type="button"
                  onClick={() => setVirtualGamepadOn((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border rounded-md whitespace-nowrap shrink-0 transition-colors ${
                    virtualGamepadOn
                      ? 'bg-blue-600/20 border-blue-500/60 text-blue-300'
                      : 'bg-[#0F1115] hover:bg-[#1E232D] border-[#262B36] text-slate-300'
                  }`}
                >
                  <Gamepad2 className="w-3.5 h-3.5" />
                  Gamepad: {virtualGamepadOn ? 'On' : 'Off'}
                </button>

                <button
                  type="button"
                  onClick={() => setCrtScanlines((v) => !v)}
                  className="px-3 py-1.5 text-xs font-medium bg-[#0F1115] hover:bg-[#1E232D] border border-[#262B36] rounded-md text-slate-300 whitespace-nowrap shrink-0"
                >
                  CRT: {crtScanlines ? 'On' : 'Off'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const next = !audioOn;
                    setAudioOn(next);
                    spuRef.current.setEnabled(next);
                    engineRef.current?.setMuted(!next);
                    streamConsoleRef.current?.spu.setEnabled(next);
                  }}
                  className="p-1.5 bg-[#0F1115] hover:bg-[#1E232D] border border-[#262B36] rounded-md text-slate-300"
                  aria-label="Alternar Áudio"
                >
                  {audioOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                </button>

                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="p-1.5 bg-[#0F1115] hover:bg-[#1E232D] border border-[#262B36] rounded-md text-slate-300"
                  aria-label="Tela Cheia"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div
              ref={screenWrapRef}
              onDragOver={(e) => {
                e.preventDefault();
                setDragActive(true);
              }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
              onClick={() => {
                engineRef.current?.resumeAudio();
                streamConsoleRef.current?.spu.unlock();
              }}
              className={`relative aspect-[4/3] w-full bg-[#090B10] border rounded-lg overflow-hidden flex items-center justify-center transition-colors ${
                dragActive ? 'border-blue-500 bg-blue-950/20' : 'border-[#262B36]'
              }`}
            >
              <div
                ref={ejsHostRef}
                className={activeBackend === 'wasm' ? 'ejs-host-wrap w-full h-full' : 'hidden'}
              />
              <canvas
                ref={streamCanvasRef}
                width={320}
                height={240}
                className={
                  activeBackend === 'streaming'
                    ? 'w-full h-full object-contain [image-rendering:pixelated]'
                    : 'hidden'
                }
              />

              {mountedIso && (bootPhase === 'sce' || bootPhase === 'ps') && (
                <Ps1BootSplash iso={mountedIso} phase={bootPhase} />
              )}

              {crtScanlines && mountedIso && activeBackend !== 'idle' && (
                <div className="crt-scanlines absolute inset-0 z-10" />
              )}

              {mountedIso && !oomPrompt && activeBackend !== 'idle' && bootPhase === 'done' && (
                <VirtualGamepad
                  visible={virtualGamepadOn}
                  disabled={!gameStarted}
                  onChange={handleVirtualPadChange}
                  onUserInteract={() => {
                    engineRef.current?.resumeAudio();
                    streamConsoleRef.current?.spu.unlock();
                  }}
                  onToggleVisibility={() => setVirtualGamepadOn(false)}
                />
              )}

              {oomPrompt && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-5 text-center space-y-4 bg-[#090B10]/95 overflow-y-auto">
                  <AlertTriangle className="w-9 h-9 text-amber-400 shrink-0" />
                  <div className="space-y-1.5 max-w-md">
                    <h3 className="font-display text-base font-semibold text-white">
                      {oomPrompt.info.recognizedTitle.title} ({oomPrompt.safety.sizeMb.toFixed(1)} MB)
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {oomPrompt.safety.hardBlockWasm
                        ? `No navegador do celular, carregar uma ISO de ${oomPrompt.safety.sizeMb.toFixed(1)} MB inteira na memória WASM (acima de ${oomPrompt.safety.hardLimitMb} MB) fecha a aba por falta de RAM ("Aw, Snap!").`
                        : `Esta ISO passa de ${oomPrompt.safety.limitMb} MB e pode fechar a aba se carregada inteira no núcleo WASM do navegador.`}
                    </p>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full max-w-md">
                    <button
                      type="button"
                      onClick={() => void launchStreamingMode(oomPrompt.file, oomPrompt.info)}
                      className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                    >
                      <ShieldCheck className="w-4 h-4 shrink-0" />
                      Modo Seguro Streaming (&lt; 8 MB RAM)
                    </button>

                    {!oomPrompt.safety.hardBlockWasm && (
                      <button
                        type="button"
                        onClick={() => void launchWasmMode(oomPrompt.file, oomPrompt.info)}
                        className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium bg-[#1C212B] hover:bg-[#262D3B] text-slate-200 border border-[#2E3543] rounded-lg transition-colors"
                      >
                        Tentar Núcleo WASM Completo
                      </button>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-400 max-w-md">
                    Para jogos grandes (&gt; {oomPrompt.safety.hardLimitMb} MB) em tela cheia com renderização 3D completa, use um arquivo `.CHD`/`.PBP` menor, abra no PC ou compile o app nativo na aba SDK Android (`pread64`).
                  </p>
                </div>
              )}

              {isoError && activeBackend === 'idle' && !oomPrompt && mountedIso && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-5 text-center space-y-4 bg-[#090B10]/95">
                  <AlertTriangle className="w-8 h-8 text-red-400 shrink-0" />
                  <div className="space-y-1 max-w-md">
                    <h3 className="font-display text-base font-semibold text-white">
                      Falha ao iniciar {mountedIso.recognizedTitle.title}
                    </h3>
                    <p className="text-xs text-red-300 leading-relaxed">{isoError}</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    {lastFileRef.current && (
                      <button
                        type="button"
                        onClick={() => {
                          if (lastFileRef.current) {
                            void launchStreamingMode(lastFileRef.current, mountedIso);
                          }
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        Abrir em Modo Streaming Seguro
                      </button>
                    )}
                    <label className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#1C212B] hover:bg-[#262D3B] text-slate-200 border border-[#2E3543] rounded-lg cursor-pointer transition-colors">
                      <Upload className="w-4 h-4" />
                      Escolher Outra ISO
                      <input
                        type="file"
                        multiple
                        accept=".iso,.bin,.cue,.img,.chd,.pbp,.mdf,.zip,.7z,.rar,.exe,.psx"
                        onChange={handleIsoFileSelected}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              )}

              {!mountedIso && !oomPrompt && (
                <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center space-y-4 bg-[#090B10]">
                  <Disc className="w-12 h-12 text-blue-400" />
                  <div className="space-y-1 max-w-md">
                    <h3 className="font-display text-lg font-semibold text-white">
                      Selecione a ISO do seu PlayStation 1
                    </h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Abra ou arraste sua imagem{' '}
                      <span className="font-mono text-slate-300">
                        .iso, .bin, .img, .chd, .pbp, .zip, .7z ou .exe
                      </span>{' '}
                      baixada no aparelho para iniciar o jogo em HLE sem precisar de arquivo de BIOS.
                    </p>
                  </div>

                  <label className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg cursor-pointer transition-colors">
                    <Upload className="w-4 h-4" />
                    {isoLoading ? 'Preparando Disco...' : 'Escolher ISO / BIN / CHD / PBP'}
                    <input
                      type="file"
                      multiple
                      accept=".iso,.bin,.cue,.img,.chd,.pbp,.mdf,.zip,.7z,.rar,.exe,.psx"
                      onChange={handleIsoFileSelected}
                      className="hidden"
                    />
                  </label>
                </div>
              )}
            </div>

            {isoError && (
              <div className="text-xs text-red-300 bg-red-950/40 border border-red-900/60 rounded-lg p-3">
                {isoError}
              </div>
            )}

            <div className="text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="inline-flex items-center gap-1.5">
                <Bluetooth className={`w-3.5 h-3.5 ${btPadName ? 'text-emerald-400' : 'text-slate-500'}`} />
                <span className={btPadName ? 'text-emerald-400' : 'text-slate-400'}>
                  {btPadName ? `Bluetooth: ${btPadName}` : 'Bluetooth pronto · Controles aparecem na tela ao iniciar a ISO'}
                </span>
              </span>
              <span className="font-mono text-slate-300 tabular-nums">
                {mountedIso ? `${mountedIso.recognizedTitle.region} · Quadro ${frameCount}` : 'Aguardando disco PS1'}
              </span>
            </div>
          </div>
        </div>

        {/* Right Side: ISO Inspector + Execution Log + Memory Card */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-[#171A21] border border-[#262B36] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-white">
                Leitor de ISO PS1
              </h3>
              <span className="text-xs text-emerald-400 font-medium">Sem BIOS (HLE)</span>
            </div>

            <label className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg cursor-pointer transition-colors">
              <Disc className="w-4 h-4" />
              {isoLoading ? 'Carregando Disco...' : mountedIso ? 'Trocar ISO / Disco' : 'Carregar ISO / BIN / CHD'}
              <input
                type="file"
                multiple
                accept=".iso,.bin,.cue,.img,.chd,.pbp,.mdf,.zip,.7z,.rar,.exe,.psx"
                onChange={handleIsoFileSelected}
                className="hidden"
              />
            </label>

            {mountedIso ? (
              <div className="p-3.5 bg-[#0F1115] border border-[#262B36] rounded-lg space-y-2 text-xs">
                <div className="font-semibold text-white">{mountedIso.recognizedTitle.title}</div>
                <div className="text-slate-400">
                  {mountedIso.recognizedTitle.genre} · {mountedIso.recognizedTitle.region} ·{' '}
                  {mountedIso.recognizedTitle.maxPlayers === 2 ? '1P / 2P' : '1P'}
                </div>
                <div className="pt-2 border-t border-[#262B36] space-y-1 font-mono text-slate-400 tabular-nums">
                  <div>
                    Serial: <span className="text-emerald-400">{mountedIso.serial}</span>
                  </div>
                  <div>
                    Volume: <span className="text-slate-200">{mountedIso.volumeLabel}</span>
                  </div>
                  <div>
                    Tamanho:{' '}
                    <span className="text-slate-200">
                      {(mountedIso.fileSizeBytes / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  </div>
                  <div>
                    Formato / Boot: <span className="text-amber-300">{mountedIso.bootExePath}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 leading-relaxed">
                Compatível com imagens `.iso`, `.bin`, `.img`, `.chd`, `.pbp`, `.zip`, `.7z` e `.exe` baixadas no seu aparelho.
              </p>
            )}
          </div>

          {/* HLE Execution Log */}
          <div className="bg-[#171A21] border border-[#262B36] rounded-xl p-5 space-y-3">
            <h3 className="font-display text-base font-semibold text-white">
              Registro de Boot HLE
            </h3>
            <div className="bg-[#0F1115] border border-[#262B36] rounded-lg p-3 max-h-44 overflow-y-auto space-y-1 font-mono text-[11px] text-slate-300">
              {hleLogs.length > 0 ? (
                hleLogs.map((line, i) => <div key={i}>{line}</div>)
              ) : (
                <div className="text-slate-500">Aguardando montagem de disco PS1...</div>
              )}
            </div>
          </div>

          {/* Virtual Memory Card (Firestore) */}
          <div className="bg-[#171A21] border border-[#262B36] rounded-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-white flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-blue-400" />
                Memory Card HLE
              </h3>
              <button
                type="button"
                disabled={!mountedIso || !gameStarted}
                onClick={() => handleSaveSlot(1)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-[#20242E] hover:bg-[#2A303D] disabled:opacity-50 text-white border border-[#2E3543] rounded-md transition-colors whitespace-nowrap shrink-0"
              >
                <Save className="w-3.5 h-3.5" />
                Salvar Slot 1
              </button>
            </div>

            {saveNotice && (
              <div className="text-xs text-emerald-300 bg-emerald-950/40 border border-emerald-900/60 rounded-md px-3 py-2">
                {saveNotice}
              </div>
            )}

            {saveSlots.length === 0 ? (
              <p className="text-xs text-slate-400">
                Nenhum bloco salvo ainda na sua conta Firebase.
              </p>
            ) : (
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {saveSlots.map((slot) => (
                  <div
                    key={slot.id}
                    className="flex items-center justify-between gap-2 px-3 py-2 bg-[#0F1115] border border-[#262B36] rounded-lg text-xs"
                  >
                    <span className="truncate text-slate-200">{slot.label}</span>
                    <button
                      type="button"
                      onClick={() => handleLoadSlot(slot)}
                      className="text-blue-400 hover:text-blue-300 font-medium whitespace-nowrap shrink-0"
                    >
                      Carregar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
