import React, { useCallback, useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  AlertTriangle,
  Bluetooth,
  Check,
  Copy,
  Disc,
  Gamepad2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
  UserX,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  getLatestCapturedAudioTrack,
  installGlobalAudioTap,
  PsxRemoteAudioPlayer,
  subscribeCapturedAudioTrack,
  subscribeHostPcmAudio,
} from '../emulator/psxAudioTap';
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
  createNetPlayRoom,
  getNetPlayRoom,
  guestLeaveRoom,
  guestRequestJoinRoom,
  guestUpdateCharacter,
  hostUpdateRoom,
  NetPlayRoomDoc,
  subscribeNetPlayRoom,
  subscribeUserRooms,
} from '../firebase/firebaseClient';
import { useHardwareGamepad } from '../hooks/useHardwareGamepad';
import { setPrivacySessionActive, useRemotePrivacyEnabled } from '../emulator/remotePrivacy';
import { Ps1BootSplash } from './Ps1BootSplash';
import { VirtualGamepad } from './VirtualGamepad';

interface NetPlayPanelProps {
  user: User;
  initialJoinCode?: string;
  onIsoMounted?: (info: IsoMountInfo) => void;
}

interface WsRoomSnapshot {
  type: 'room:state';
  roomCode: string;
  p1Connected: boolean;
  p1Name: string;
  p2Connected: boolean;
  p2Uid: string;
  p2Name: string;
  p2Approved: boolean;
  p2CanSelectCharacter: boolean;
  gameId: string;
  gameTitle: string;
  p1Character: string;
  p2Character: string;
}

const SLOT_OPTIONS = [
  'Controle 1 / Slot A',
  'Controle 2 / Slot B',
  'Lutador / Piloto 1',
  'Lutador / Piloto 2',
  'Time Casa (Home)',
  'Time Visitante (Away)',
];

const ACCEPTED_DISC_EXT = /\.(bin|iso|img|chd|pbp|mdf|zip|7z|rar|exe|psx)$/i;

export const NetPlayPanel: React.FC<NetPlayPanelProps> = ({
  user,
  initialJoinCode,
  onIsoMounted,
}) => {
  const gamerTag = user.displayName || user.email?.split('@')[0] || 'Jogador';

  const [activeRoomCode, setActiveRoomCode] = useState<string>(initialJoinCode || '');
  const [joinCodeInput, setJoinCodeInput] = useState<string>(initialJoinCode || '');
  const [roomDoc, setRoomDoc] = useState<NetPlayRoomDoc | null>(null);
  const [myRooms, setMyRooms] = useState<NetPlayRoomDoc[]>([]);
  const [wsSnapshot, setWsSnapshot] = useState<WsRoomSnapshot | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [isoLoading, setIsoLoading] = useState(false);
  const [hostGameStarted, setHostGameStarted] = useState(false);
  const [hostFrameNum, setHostFrameNum] = useState(0);
  const [bootPhase, setBootPhase] = useState<'idle' | 'sce' | 'ps' | 'done'>('idle');
  const [minLogoDone, setMinLogoDone] = useState(false);

  const [hostBackend, setHostBackend] = useState<'idle' | 'wasm' | 'streaming'>('idle');
  const [hostOomPrompt, setHostOomPrompt] = useState<{
    file: File;
    info: IsoMountInfo;
    safety: WasmSafetyCheckResult;
  } | null>(null);
  const [hostRtcConnected, setHostRtcConnected] = useState(false);
  const [guestRtcConnected, setGuestRtcConnected] = useState(false);
  const [guestHasRtcAudio, setGuestHasRtcAudio] = useState(false);
  const [p2AudioMuted, setP2AudioMuted] = useState(false);
  const guestHasRtcAudioRef = useRef(false);
  const p2AudioMutedRef = useRef(false);

  const hostEngineRef = useRef<PsxWasmEngine | null>(null);
  const hostStreamConsoleRef = useRef<PsxConsole | null>(null);
  const hostStreamCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostPcRef = useRef<RTCPeerConnection | null>(null);
  const guestPcRef = useRef<RTCPeerConnection | null>(null);
  const guestVideoRef = useRef<HTMLVideoElement | null>(null);
  const guestAudioPlayerRef = useRef<PsxRemoteAudioPlayer | null>(null);
  const spuRef = useRef<PsxSpu>(new PsxSpu());
  const bootTimerRef = useRef<number | null>(null);
  const minLogoTimerRef = useRef<number | null>(null);
  const hostEjsRef = useRef<HTMLDivElement | null>(null);
  const guestCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [mountedIso, setMountedIso] = useState<IsoMountInfo | null>(null);
  const [audioOn, setAudioOn] = useState(true);
  const privacyEnabled = useRemotePrivacyEnabled();
  const [crtScanlines, setCrtScanlines] = useState(false);
  const [virtualGamepadOn, setVirtualGamepadOn] = useState(true);
  const p1HardwareRef = useRef<PsxPadState>(createIdlePadState());
  const p1VirtualRef = useRef<PsxPadState>(createIdlePadState());
  const p2HardwareRef = useRef<PsxPadState>(createIdlePadState());
  const p2VirtualRef = useRef<PsxPadState>(createIdlePadState());
  const seqRef = useRef<number>(0);

  const isHost = Boolean(roomDoc && roomDoc.hostUid === user.uid);
  const isGuest = Boolean(roomDoc && roomDoc.hostUid !== user.uid);
  const remotePrivacySession = Boolean(
    roomDoc?.status === 'playing' &&
      roomDoc.p2AccessStatus === 'approved' &&
      (isHost ? wsSnapshot?.p2Connected : wsSnapshot?.p1Connected),
  );

  useEffect(() => {
    setPrivacySessionActive(remotePrivacySession && privacyEnabled);
    return () => setPrivacySessionActive(false);
  }, [remotePrivacySession, privacyEnabled]);

  useEffect(() => {
    installGlobalAudioTap();
    void loadEjsRuntime().catch(() => {});
    const unsub = subscribeUserRooms(user.uid, (rooms) => {
      setMyRooms(rooms);
    });
    return () => {
      unsub();
      if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current);
      if (minLogoTimerRef.current) window.clearTimeout(minLogoTimerRef.current);
    };
  }, [user.uid]);

  useEffect(() => {
    guestHasRtcAudioRef.current = guestHasRtcAudio;
  }, [guestHasRtcAudio]);

  useEffect(() => {
    p2AudioMutedRef.current = p2AudioMuted;
  }, [p2AudioMuted]);

  useEffect(() => {
    if (hostGameStarted && minLogoDone && bootPhase !== 'done') {
      setBootPhase('done');
    }
  }, [hostGameStarted, minLogoDone, bootPhase]);

  useEffect(() => {
    if (!activeRoomCode || activeRoomCode.length !== 6) {
      setRoomDoc(null);
      return;
    }
    const unsub = subscribeNetPlayRoom(
      activeRoomCode,
      (docData) => {
        setRoomDoc(docData);
      },
      (err) => {
        setStatusError(err.message);
      },
    );
    return () => unsub();
  }, [activeRoomCode]);

  const unlockGuestAudio = useCallback(() => {
    if (!guestAudioPlayerRef.current) {
      guestAudioPlayerRef.current = new PsxRemoteAudioPlayer();
    }
    guestAudioPlayerRef.current.setMuted(p2AudioMuted);
    guestAudioPlayerRef.current.unlock();
    if (guestVideoRef.current) {
      guestVideoRef.current.muted = p2AudioMuted;
      void guestVideoRef.current.play().catch(() => {});
    }
  }, [p2AudioMuted]);

  useEffect(() => {
    if (!roomDoc || roomDoc.status === 'closed') {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      setWsSnapshot(null);
      hostPcRef.current?.close();
      hostPcRef.current = null;
      guestPcRef.current?.close();
      guestPcRef.current = null;
      setHostRtcConnected(false);
      setGuestRtcConnected(false);
      setGuestHasRtcAudio(false);
      return;
    }

    const role = roomDoc.hostUid === user.uid ? 'p1' : 'p2';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const relayBase = (import.meta.env.VITE_NETPLAY_WS_BASE as string | undefined)?.trim();
    const wsUrl = `${relayBase || `${proto}//${window.location.host}/ws/netplay`}?roomCode=${encodeURIComponent(
      roomDoc.roomCode,
    )}&uid=${encodeURIComponent(user.uid)}&gamerTag=${encodeURIComponent(gamerTag)}&role=${role}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onclose = () => {
      if (wsRef.current === ws) setWsSnapshot(null);
    };
    ws.onerror = () => {
      if (wsRef.current === ws) setWsSnapshot(null);
    };

    const handleGuestRtcSignal = async (signal: Record<string, unknown>) => {
      if (signal.kind === 'offer' && signal.sdp) {
        guestPcRef.current?.close();
        const pc = new RTCPeerConnection({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
          ],
        });
        guestPcRef.current = pc;

        pc.onicecandidate = (ev) => {
          if (ev.candidate && ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'rtc:signal',
                signal: { kind: 'ice', candidate: ev.candidate.toJSON() },
              }),
            );
          }
        };

        pc.onconnectionstatechange = () => {
          const st = pc.connectionState;
          if (st === 'connected') {
            setGuestRtcConnected(true);
            const stream = guestVideoRef.current?.srcObject as MediaStream | null;
            const hasAudio = Boolean(stream && stream.getAudioTracks().length > 0);
            guestHasRtcAudioRef.current = hasAudio;
            setGuestHasRtcAudio(hasAudio);
          } else if (st === 'failed' || st === 'disconnected' || st === 'closed') {
            setGuestRtcConnected(false);
            guestHasRtcAudioRef.current = false;
            setGuestHasRtcAudio(false);
          }
        };

        pc.ontrack = (ev) => {
          const stream = ev.streams[0] ?? new MediaStream([ev.track]);
          if (guestVideoRef.current) {
            guestVideoRef.current.srcObject = stream;
            guestVideoRef.current.muted = p2AudioMutedRef.current;
            void guestVideoRef.current.play().catch(() => {});
          }
          if (pc.connectionState === 'connected') {
            const hasAudio = stream.getAudioTracks().length > 0 || ev.track.kind === 'audio';
            guestHasRtcAudioRef.current = hasAudio;
            setGuestHasRtcAudio(hasAudio);
            setGuestRtcConnected(true);
          }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp as RTCSessionDescriptionInit));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              type: 'rtc:signal',
              signal: { kind: 'answer', sdp: answer },
            }),
          );
        }
      } else if (signal.kind === 'ice' && signal.candidate && guestPcRef.current) {
        await guestPcRef.current
          .addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit))
          .catch(() => {});
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        if (msg.type === 'room:state') {
          setWsSnapshot(msg as unknown as WsRoomSnapshot);
        } else if (msg.type === 'room:kicked') {
          setStatusError(String(msg.message || 'Acesso removido pelo administrador P1.'));
          guestPcRef.current?.close();
          guestPcRef.current = null;
          setGuestRtcConnected(false);
          setGuestHasRtcAudio(false);
        } else if (msg.type === 'netplay:input' && role === 'p1') {
          const pad2: PsxPadState = {
            ...createIdlePadState(),
            buttons: typeof msg.buttons === 'number' ? msg.buttons : 0xffff,
            lx: typeof msg.lx === 'number' ? msg.lx : 128,
            ly: typeof msg.ly === 'number' ? msg.ly : 128,
            rx: typeof msg.rx === 'number' ? msg.rx : 128,
            ry: typeof msg.ry === 'number' ? msg.ry : 128,
          };
          hostEngineRef.current?.applyPadState(1, pad2);
          hostStreamConsoleRef.current?.setPadState(2, pad2);
        } else if (msg.type === 'netplay:frame' && role === 'p2') {
          const payload = msg.data as { img?: string } | undefined;
          if (payload?.img && guestCanvasRef.current) {
            const ctx = guestCanvasRef.current.getContext('2d');
            if (!ctx) return;
            const img = new Image();
            img.onload = () => {
              ctx.imageSmoothingEnabled = false;
              ctx.drawImage(img, 0, 0, 320, 240);
            };
            img.src = payload.img;
          }
        } else if (msg.type === 'netplay:audio' && role === 'p2') {
          if (!guestHasRtcAudioRef.current && !p2AudioMutedRef.current) {
            const payload = msg.data as { sr?: number; pcm?: string } | undefined;
            if (payload?.pcm) {
              if (!guestAudioPlayerRef.current) {
                guestAudioPlayerRef.current = new PsxRemoteAudioPlayer();
              }
              guestAudioPlayerRef.current.enqueuePcm(payload.sr ?? 22050, payload.pcm);
            }
          }
        } else if (msg.type === 'rtc:signal') {
          const signal = msg.signal as Record<string, unknown> | undefined;
          if (!signal) return;
          if (role === 'p2' && msg.from === 'p1') {
            void handleGuestRtcSignal(signal).catch(() => {});
          } else if (role === 'p1' && msg.from === 'p2' && hostPcRef.current) {
            if (signal.kind === 'answer' && signal.sdp) {
              void hostPcRef.current
                .setRemoteDescription(new RTCSessionDescription(signal.sdp as RTCSessionDescriptionInit))
                .catch(() => {});
            } else if (signal.kind === 'ice' && signal.candidate) {
              void hostPcRef.current
                .addIceCandidate(new RTCIceCandidate(signal.candidate as RTCIceCandidateInit))
                .catch(() => {});
            }
          }
        }
      } catch {
        // Ignore malformed packets
      }
    };

    return () => {
      ws.close();
      wsRef.current = null;
      hostPcRef.current?.close();
      hostPcRef.current = null;
      guestPcRef.current?.close();
      guestPcRef.current = null;
      setHostRtcConnected(false);
      setGuestRtcConnected(false);
      setGuestHasRtcAudio(false);
    };
  }, [roomDoc?.roomCode, roomDoc?.hostUid, roomDoc?.status, user.uid, gamerTag]);

  useEffect(() => {
    if (!isHost || !roomDoc || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      return;
    }
    wsRef.current.send(
      JSON.stringify({
        type: 'room:control',
        p2Approved: roomDoc.p2AccessStatus === 'approved',
        p2CanSelectCharacter: roomDoc.p2CanSelectCharacter,
        gameId: roomDoc.gameId,
        gameTitle: roomDoc.gameTitle,
        p1Character: roomDoc.p1Character,
        p2Character: roomDoc.p2Character,
      }),
    );
  }, [
    isHost,
    roomDoc?.p2AccessStatus,
    roomDoc?.p2CanSelectCharacter,
    roomDoc?.gameId,
    roomDoc?.gameTitle,
    roomDoc?.p1Character,
    roomDoc?.p2Character,
  ]);

  // Host P1 WebRTC live screen + audio mirroring to approved P2 Guest
  useEffect(() => {
    const p2ApprovedNow = roomDoc?.p2AccessStatus === 'approved';
    const p2OnlineNow = Boolean(wsSnapshot?.p2Connected);

    if (!isHost || !p2ApprovedNow || !p2OnlineNow || !hostGameStarted || hostBackend === 'idle') {
      hostPcRef.current?.close();
      hostPcRef.current = null;
      setHostRtcConnected(false);
      return;
    }

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    let cancelled = false;
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
    hostPcRef.current = pc;

    pc.onicecandidate = (ev) => {
      if (ev.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'rtc:signal',
            signal: { kind: 'ice', candidate: ev.candidate.toJSON() },
          }),
        );
      }
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      setHostRtcConnected(st === 'connected');
    };

    // Isolated game-only MediaStream: captures ONLY the PS1 game canvas + game audio (never OS/WhatsApp/Facebook notifications)
    const outgoingStream = new MediaStream();
    const srcCanvas =
      hostBackend === 'streaming'
        ? hostStreamCanvasRef.current
        : hostEngineRef.current?.getCanvasElement() ?? null;
    if (srcCanvas && typeof srcCanvas.captureStream === 'function') {
      try {
        const canvasStream = srcCanvas.captureStream(30);
        const vTrack = canvasStream.getVideoTracks()[0];
        if (vTrack) {
          outgoingStream.addTrack(vTrack);
          pc.addTrack(vTrack, outgoingStream);
        }
      } catch {
        // Fallback to WebSocket JPEG frame stream
      }
    }
    const aTrack = getLatestCapturedAudioTrack();
    if (aTrack) {
      outgoingStream.addTrack(aTrack);
      pc.addTrack(aTrack, outgoingStream);
    }

    let audioSender: RTCRtpSender | null =
      pc.getSenders().find((s) => s.track?.kind === 'audio') ?? null;

    const sendOffer = async () => {
      if (cancelled || ws.readyState !== WebSocket.OPEN) return;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(
          JSON.stringify({
            type: 'rtc:signal',
            signal: { kind: 'offer', sdp: offer },
          }),
        );
      } catch {
        // Ignore transient negotiation errors
      }
    };

    if (pc.getSenders().length > 0) {
      void sendOffer();
    }

    const unsubTrack = subscribeCapturedAudioTrack((newTrack) => {
      if (cancelled) return;
      if (audioSender) {
        void audioSender.replaceTrack(newTrack).catch(() => {});
      } else {
        try {
          outgoingStream.addTrack(newTrack);
          audioSender = pc.addTrack(newTrack, outgoingStream);
          void sendOffer();
        } catch {
          // Ignore if closed
        }
      }
    });

    return () => {
      cancelled = true;
      unsubTrack();
      pc.close();
      if (hostPcRef.current === pc) {
        hostPcRef.current = null;
      }
      setHostRtcConnected(false);
    };
  }, [
    isHost,
    roomDoc?.p2AccessStatus,
    wsSnapshot?.p2Connected,
    hostGameStarted,
    hostBackend,
  ]);

  // Host P1 WebSocket fallback frame + audio PCM pump (active whenever WebRTC direct stream isn't connected yet)
  useEffect(() => {
    if (!isHost || !hostGameStarted) return;

    if (!offscreenRef.current) {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 240;
      offscreenRef.current = c;
    }

    const unsubPcm = subscribeHostPcmAudio((chunk) => {
      if (hostRtcConnected) return;
      if (roomDoc?.p2AccessStatus !== 'approved') return;
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(
        JSON.stringify({
          type: 'netplay:audio',
          data: chunk,
        }),
      );
    });

    const frameTimer = window.setInterval(() => {
      const off = offscreenRef.current;
      if (!off) return;

      let jpgUrl: string | null = null;
      if (hostBackend === 'streaming') {
        const srcCanvas = hostStreamCanvasRef.current;
        if (!srcCanvas) return;
        setHostFrameNum((n) => n + 1);
        if (!hostRtcConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          const ctx = off.getContext('2d');
          if (ctx) {
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(srcCanvas, 0, 0, 320, 240);
            jpgUrl = off.toDataURL('image/jpeg', 0.62);
          }
        }
      } else {
        const engine = hostEngineRef.current;
        if (!engine || !engine.isRunning()) return;
        setHostFrameNum(engine.getFrameCount());
        if (!hostRtcConnected && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          jpgUrl = engine.captureFrameDataUrl(off);
        }
      }

      if (jpgUrl && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'netplay:frame',
            data: { img: jpgUrl },
          }),
        );
      }
    }, 45);

    return () => {
      unsubPcm();
      window.clearInterval(frameTimer);
    };
  }, [isHost, hostGameStarted, hostBackend, hostRtcConnected, roomDoc?.p2AccessStatus]);

  useEffect(() => {
    return () => {
      hostEngineRef.current?.destroy();
      hostEngineRef.current = null;
      hostStreamConsoleRef.current?.stop();
      hostStreamConsoleRef.current = null;
      hostPcRef.current?.close();
      guestPcRef.current?.close();
      guestAudioPlayerRef.current?.destroy();
    };
  }, []);

  const handleCreateRoom = async () => {
    setStatusError(null);
    setBusy(true);
    try {
      const code = await createNetPlayRoom({
        hostUid: user.uid,
        hostName: gamerTag,
        gameId: 'aguardando-iso',
        gameTitle: 'Aguardando ISO PS1 do Host',
        isoFilename: '',
        p1Character: SLOT_OPTIONS[0],
        p2Character: SLOT_OPTIONS[1],
      });
      setActiveRoomCode(code);
      setJoinCodeInput(code);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Erro ao criar sala NetPlay.');
    } finally {
      setBusy(false);
    }
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusError(null);
    const code = joinCodeInput.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (code.length !== 6) {
      setStatusError('Digite o código da sala com 6 caracteres.');
      return;
    }
    setBusy(true);
    try {
      const found = await getNetPlayRoom(code);
      if (!found || found.status === 'closed') {
        setStatusError('Sala não encontrada ou já encerrada.');
        setBusy(false);
        return;
      }
      setActiveRoomCode(code);
      if (found.hostUid !== user.uid && found.p2Uid !== user.uid) {
        await guestRequestJoinRoom(code, user.uid, gamerTag);
      }
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Erro ao entrar na sala.');
    } finally {
      setBusy(false);
    }
  };

  const startHostBootSplash = useCallback(() => {
    if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current);
    if (minLogoTimerRef.current) window.clearTimeout(minLogoTimerRef.current);
    spuRef.current.setEnabled(audioOn);
    spuRef.current.unlock();
    spuRef.current.playSfx('boot');
    setHostGameStarted(false);
    setMinLogoDone(false);
    setBootPhase('sce');

    bootTimerRef.current = window.setTimeout(() => {
      setBootPhase((cur) => (cur === 'sce' ? 'ps' : cur));
    }, 1100);
    minLogoTimerRef.current = window.setTimeout(() => {
      setMinLogoDone(true);
    }, 2200);
  }, [audioOn]);

  const launchHostWasm = async (file: File) => {
    if (!roomDoc || !hostEjsRef.current) return;
    hostStreamConsoleRef.current?.stop();
    hostStreamConsoleRef.current = null;
    if (!hostEngineRef.current) {
      hostEngineRef.current = new PsxWasmEngine();
    }

    setHostOomPrompt(null);
    setIsoLoading(true);
    setStatusError(null);
    setHostBackend('wasm');
    setHostFrameNum(0);
    startHostBootSplash();

    try {
      await hostEngineRef.current.mountDisc({
        container: hostEjsRef.current,
        containerId: `psx-netplay-host-${roomDoc.roomCode}`,
        file,
        audioEnabled: audioOn,
        enableFrameCapture: true,
        onGameStart: () => {
          setHostGameStarted(true);
        },
      });
    } catch (err) {
      if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current);
      if (minLogoTimerRef.current) window.clearTimeout(minLogoTimerRef.current);
      setStatusError(err instanceof Error ? err.message : 'Erro ao montar ISO na sala.');
      setBootPhase('done');
      setHostBackend('idle');
    } finally {
      setIsoLoading(false);
    }
  };

  const launchHostStreaming = async (file: File) => {
    hostEngineRef.current?.destroy();
    hostStreamConsoleRef.current?.stop();

    setHostOomPrompt(null);
    setIsoLoading(true);
    setStatusError(null);
    setHostBackend('streaming');
    setHostFrameNum(0);
    startHostBootSplash();

    const psx = new PsxConsole();
    psx.spu.setEnabled(audioOn);
    hostStreamConsoleRef.current = psx;

    psx.onFrame((rgba) => {
      const canvas = hostStreamCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), 320, 240), 0, 0);
    });

    try {
      await psx.bootUserFile(file);
      setHostGameStarted(true);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Erro ao montar ISO em streaming.');
      setBootPhase('done');
      setHostBackend('idle');
    } finally {
      setIsoLoading(false);
    }
  };

  const handleHostLoadIso = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const file = files.find((f) => ACCEPTED_DISC_EXT.test(f.name)) ?? files[0];
    if (!file || !roomDoc || !isHost) return;

    if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current);
    if (minLogoTimerRef.current) window.clearTimeout(minLogoTimerRef.current);

    setIsoLoading(true);
    setStatusError(null);
    setHostOomPrompt(null);
    setHostGameStarted(false);
    setMinLogoDone(false);
    setBootPhase('idle');
    setHostFrameNum(0);

    if (/\.cue$/i.test(file.name) && file.size < 65536) {
      setStatusError(
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
        setStatusError(safety.blockedReason);
        setIsoLoading(false);
        return;
      }

      setMountedIso(info);
      onIsoMounted?.(info);

      await hostUpdateRoom(roomDoc.roomCode, {
        gameId: info.serial.replace(/[^a-zA-Z0-9_-]/g, '_'),
        gameTitle: info.recognizedTitle.title || info.volumeLabel || file.name,
        isoFilename: file.name,
        status: 'playing',
      });

      if (info.isDirectExe) {
        await launchHostStreaming(file);
        return;
      }

      if (safety.requiresStreamingPrompt) {
        hostEngineRef.current?.destroy();
        hostStreamConsoleRef.current?.stop();
        setHostBackend('idle');
        setHostOomPrompt({ file, info, safety });
        setIsoLoading(false);
        return;
      }

      await launchHostWasm(file);
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Erro ao montar ISO na sala.');
      setBootPhase('done');
      setIsoLoading(false);
    } finally {
      e.target.value = '';
    }
  };

  const emitMergedP1Pad = useCallback(() => {
    const merged = mergePadStates(p1HardwareRef.current, p1VirtualRef.current);
    if (hostBackend === 'streaming') {
      hostStreamConsoleRef.current?.spu.unlock();
      hostStreamConsoleRef.current?.setPadState(1, merged);
    } else {
      hostEngineRef.current?.resumeAudio();
      hostEngineRef.current?.applyPadState(0, merged);
    }
  }, [hostBackend]);

  const handleP1HardwareChange = useCallback(
    (state: PsxPadState) => {
      p1HardwareRef.current = state;
      emitMergedP1Pad();
    },
    [emitMergedP1Pad],
  );

  const handleP1VirtualChange = useCallback(
    (state: PsxPadState) => {
      p1VirtualRef.current = state;
      emitMergedP1Pad();
    },
    [emitMergedP1Pad],
  );

  const emitMergedP2Pad = useCallback(() => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    const merged = mergePadStates(p2HardwareRef.current, p2VirtualRef.current);
    seqRef.current += 1;
    wsRef.current.send(
      JSON.stringify({
        type: 'netplay:input',
        buttons: merged.buttons,
        lx: merged.lx,
        ly: merged.ly,
        rx: merged.rx,
        ry: merged.ry,
        seq: seqRef.current,
      }),
    );
  }, []);

  const handleP2HardwareChange = useCallback(
    (state: PsxPadState) => {
      p2HardwareRef.current = state;
      emitMergedP2Pad();
    },
    [emitMergedP2Pad],
  );

  const handleP2VirtualChange = useCallback(
    (state: PsxPadState) => {
      p2VirtualRef.current = state;
      emitMergedP2Pad();
    },
    [emitMergedP2Pad],
  );

  const p2ApprovedNow = Boolean(roomDoc && roomDoc.p2AccessStatus === 'approved');
  const p1PadDisabled = !roomDoc || !isHost || !hostGameStarted;
  const p2PadDisabled = !roomDoc || !isGuest || !p2ApprovedNow;

  const p1BtName = useHardwareGamepad(p1PadDisabled, handleP1HardwareChange);
  const p2BtName = useHardwareGamepad(p2PadDisabled, handleP2HardwareChange);
  const activeBtName = isHost ? p1BtName : p2BtName;

  const copyInviteLink = () => {
    if (!roomDoc) return;
    const url = `${window.location.origin}?room=${roomDoc.roomCode}`;
    navigator.clipboard.writeText(url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  if (!roomDoc) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        <div className="space-y-1">
          <h2 className="font-display text-2xl font-bold text-white">
            NetPlay · Multiplayer PS1 à Distância (Base ISO)
          </h2>
          <p className="text-sm text-slate-400">
            O jogador P1 cria a sala como administrador, carrega a ISO do jogo baixada no aparelho e libera manualmente o acesso do convidado P2.
          </p>
        </div>

        {statusError && (
          <div className="text-sm text-red-300 bg-red-950/40 border border-red-900/60 rounded-lg p-3">
            {statusError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
          <div className="bg-[#171A21] border border-[#262B36] rounded-xl p-6 flex flex-col justify-between space-y-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Shield className="w-4 h-4 text-blue-400" />
                Criar Sala como Host (Administrador P1)
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Ao criar a sala você recebe um código de 6 dígitos para enviar ao P2. Dentro da sala, selecione sua ISO/BIN/CHD/PBP PS1 e libere o P2 quando ele solicitar acesso.
              </p>
            </div>

            <button
              type="button"
              disabled={busy}
              onClick={handleCreateRoom}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Users className="w-4 h-4" />
              Criar Sala NetPlay (P1)
            </button>
          </div>

          <div className="bg-[#171A21] border border-[#262B36] rounded-xl p-6 flex flex-col justify-between space-y-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <UserCheck className="w-4 h-4 text-emerald-400" />
                Entrar em Sala como Convidado (P2)
              </div>
              <p className="text-xs text-slate-400 leading-relaxed">
                Digite o código de 6 caracteres enviado pelo P1. Sua entrada ficará aguardando aprovação do administrador P1 para liberar a tela e o controle Port 2.
              </p>

              <form onSubmit={handleJoinByCode} className="space-y-3">
                <label className="block text-xs font-medium text-slate-300">
                  Código da Sala
                </label>
                <input
                  type="text"
                  maxLength={6}
                  value={joinCodeInput}
                  onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
                  placeholder="EX: PSX492"
                  className="w-full px-4 py-3 text-lg font-mono tracking-widest uppercase bg-[#0F1115] border border-[#262B36] focus:border-blue-500 rounded-lg text-white placeholder-slate-600 outline-none"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium bg-[#20242E] hover:bg-[#2A303D] text-white border border-[#2E3543] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  Solicitar Acesso ao P1
                </button>
              </form>
            </div>

            {myRooms.length > 0 && (
              <div className="pt-4 border-t border-[#262B36] space-y-2">
                <div className="text-xs font-medium text-slate-400">Suas Salas Abertas</div>
                <div className="space-y-2">
                  {myRooms.map((r) => (
                    <button
                      key={r.roomCode}
                      type="button"
                      onClick={() => setActiveRoomCode(r.roomCode)}
                      className="w-full flex items-center justify-between px-3 py-2 text-xs bg-[#0F1115] hover:bg-[#1E232D] border border-[#262B36] rounded-lg text-slate-200 transition-colors"
                    >
                      <span className="font-mono font-semibold text-blue-400">{r.roomCode}</span>
                      <span className="truncate mx-3">{r.gameTitle}</span>
                      <span className="text-slate-400 shrink-0">Reabrir</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  const p2Approved = roomDoc.p2AccessStatus === 'approved';
  const p2Pending = roomDoc.p2AccessStatus === 'pending';

  return (
    <div className="max-w-7xl mx-auto px-6 py-6 space-y-6">
      <div className="bg-[#171A21] border border-[#262B36] rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div>
            <div className="text-xs text-slate-400">Código da Sala NetPlay</div>
            <div className="font-mono text-xl font-bold text-white tracking-wider tabular-nums">
              {roomDoc.roomCode}
            </div>
          </div>
          <div className="h-8 w-px bg-[#262B36] hidden sm:block" />
          <div>
            <div className="text-xs text-slate-400">Disco / Jogo Ativo · HLE sem BIOS</div>
            <div className="text-sm font-semibold text-white">{roomDoc.gameTitle}</div>
          </div>
          <div className="h-8 w-px bg-[#262B36] hidden sm:block" />
          <div className="text-xs text-slate-300">
            <span className="text-slate-400">Função: </span>
            <span className="font-semibold text-blue-400">
              {isHost ? 'P1 · Administrador Host' : 'P2 · Convidado'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyInviteLink}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium bg-[#20242E] hover:bg-[#2A303D] text-slate-200 border border-[#2E3543] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Link Copiado' : 'Copiar Convite'}
          </button>

          {isHost ? (
            <button
              type="button"
              onClick={async () => {
                hostEngineRef.current?.destroy();
                hostStreamConsoleRef.current?.stop();
                setHostGameStarted(false);
                setHostBackend('idle');
                await hostUpdateRoom(roomDoc.roomCode, { status: 'closed' });
                setActiveRoomCode('');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-red-950/60 hover:bg-red-900/70 text-red-200 border border-red-800/70 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <X className="w-3.5 h-3.5" />
              Encerrar Sala
            </button>
          ) : (
            <button
              type="button"
              onClick={async () => {
                await guestLeaveRoom(roomDoc.roomCode);
                setActiveRoomCode('');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#20242E] hover:bg-[#2A303D] text-slate-200 border border-[#2E3543] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              Sair da Sala
            </button>
          )}
        </div>
      </div>

      {statusError && (
        <div className="text-xs text-red-300 bg-red-950/40 border border-red-900/60 rounded-lg p-3">
          {statusError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-[#171A21] border border-[#262B36] rounded-xl p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs font-mono text-slate-300 tabular-nums">
                {isHost
                  ? hostGameStarted
                    ? `P1 HOST REMOTE · ${hostRtcConnected ? 'WebRTC Isolado (Só Jogo)' : `Stream Isolado · Q${hostFrameNum}`}`
                    : 'P1 HOST · Carregue a ISO para iniciar o Remote Play'
                  : p2Approved
                    ? `P2 REMOTE DE ${roomDoc.hostName}${guestRtcConnected ? ' (WebRTC)' : ' (Live)'} · PORT 2`
                    : 'AGUARDANDO LIBERAÇÃO DO ADMINISTRADOR P1'}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setVirtualGamepadOn((v) => !v)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium border rounded-md whitespace-nowrap shrink-0 transition-colors ${
                    virtualGamepadOn
                      ? 'bg-blue-600/20 border-blue-500/60 text-blue-300'
                      : 'bg-[#0F1115] border-[#262B36] text-slate-300 hover:text-white'
                  }`}
                >
                  <Gamepad2 className="w-3.5 h-3.5" />
                  Gamepad: {virtualGamepadOn ? 'On' : 'Off'}
                </button>
                <button
                  type="button"
                  onClick={() => setCrtScanlines((v) => !v)}
                  className="px-2.5 py-1 text-xs font-medium bg-[#0F1115] border border-[#262B36] rounded-md text-slate-300 hover:text-white whitespace-nowrap shrink-0"
                >
                  CRT: {crtScanlines ? 'Ligado' : 'Desligado'}
                </button>
                {isHost ? (
                  <button
                    type="button"
                    onClick={() => {
                      const next = !audioOn;
                      setAudioOn(next);
                      spuRef.current.setEnabled(next);
                      hostEngineRef.current?.setMuted(!next);
                      hostStreamConsoleRef.current?.spu.setEnabled(next);
                    }}
                    className="p-1.5 bg-[#0F1115] border border-[#262B36] rounded-md text-slate-300 hover:text-white"
                    aria-label="Alternar Áudio"
                  >
                    {audioOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      const nextMuted = !p2AudioMuted;
                      setP2AudioMuted(nextMuted);
                      guestAudioPlayerRef.current?.setMuted(nextMuted);
                      if (!nextMuted) {
                        guestAudioPlayerRef.current?.unlock();
                      }
                      if (guestVideoRef.current) {
                        guestVideoRef.current.muted = nextMuted;
                        void guestVideoRef.current.play().catch(() => {});
                      }
                    }}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#0F1115] border border-[#262B36] rounded-md text-xs text-slate-200 hover:text-white whitespace-nowrap shrink-0"
                    aria-label="Alternar Som Recebido do P1"
                  >
                    {p2AudioMuted ? <VolumeX className="w-3.5 h-3.5 text-red-400" /> : <Volume2 className="w-3.5 h-3.5 text-emerald-400" />}
                    {p2AudioMuted ? 'Som P1: Mudo' : 'Som P1: Ativo'}
                  </button>
                )}
              </div>
            </div>

            <div
              onClick={() => {
                if (isHost) {
                  hostEngineRef.current?.resumeAudio();
                  hostStreamConsoleRef.current?.spu.unlock();
                } else {
                  unlockGuestAudio();
                }
              }}
              className="relative aspect-[4/3] w-full bg-[#090B10] border border-[#262B36] rounded-lg overflow-hidden flex items-center justify-center"
            >
              {isHost ? (
                <>
                  <div
                    ref={hostEjsRef}
                    className={hostBackend === 'wasm' ? 'ejs-host-wrap w-full h-full' : 'hidden'}
                  />
                  <canvas
                    ref={hostStreamCanvasRef}
                    width={320}
                    height={240}
                    className={
                      hostBackend === 'streaming'
                        ? 'w-full h-full object-contain [image-rendering:pixelated]'
                        : 'hidden'
                    }
                  />
                  {mountedIso && (bootPhase === 'sce' || bootPhase === 'ps') && (
                    <Ps1BootSplash iso={mountedIso} phase={bootPhase} />
                  )}
                  {crtScanlines && hostBackend !== 'idle' && (
                    <div className="crt-scanlines absolute inset-0 z-10" />
                  )}
                  {hostBackend !== 'idle' && !hostOomPrompt && bootPhase === 'done' && (
                    <VirtualGamepad
                      visible={virtualGamepadOn}
                      disabled={!hostGameStarted}
                      onChange={handleP1VirtualChange}
                      onUserInteract={() => {
                        hostEngineRef.current?.resumeAudio();
                        hostStreamConsoleRef.current?.spu.unlock();
                      }}
                      onToggleVisibility={() => setVirtualGamepadOn(false)}
                    />
                  )}
                  {hostOomPrompt && (
                    <div className="absolute inset-0 z-20 bg-[#090B10]/95 flex flex-col items-center justify-center p-5 text-center space-y-4 overflow-y-auto">
                      <AlertTriangle className="w-8 h-8 text-amber-400 shrink-0" />
                      <div className="space-y-1 max-w-md">
                        <h3 className="font-display text-base font-semibold text-white">
                          {hostOomPrompt.info.recognizedTitle.title} ({hostOomPrompt.safety.sizeMb.toFixed(1)} MB)
                        </h3>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {hostOomPrompt.safety.hardBlockWasm
                            ? `No navegador do celular, carregar uma ISO de ${hostOomPrompt.safety.sizeMb.toFixed(1)} MB inteira na memória WASM (acima de ${hostOomPrompt.safety.hardLimitMb} MB) fecha a aba por falta de RAM ("Aw, Snap!").`
                            : `Esta ISO passa de ${hostOomPrompt.safety.limitMb} MB e pode fechar a aba no celular se carregada inteira no núcleo WASM.`}
                        </p>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2.5 w-full max-w-md">
                        <button
                          type="button"
                          onClick={() => void launchHostStreaming(hostOomPrompt.file)}
                          className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
                        >
                          <ShieldCheck className="w-4 h-4 shrink-0" />
                          Modo Seguro Streaming (&lt; 8 MB)
                        </button>
                        {!hostOomPrompt.safety.hardBlockWasm && (
                          <button
                            type="button"
                            onClick={() => void launchHostWasm(hostOomPrompt.file)}
                            className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-medium bg-[#1C212B] hover:bg-[#262D3B] text-slate-200 border border-[#2E3543] rounded-lg transition-colors"
                          >
                            Tentar WASM Completo
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {!mountedIso && !hostOomPrompt && (
                    <div className="absolute inset-0 z-20 bg-[#090B10]/95 flex flex-col items-center justify-center p-6 text-center space-y-4">
                      <Disc className="w-10 h-10 text-blue-400" />
                      <p className="text-sm text-slate-300 max-w-md">
                        Somente o P1 carrega a ISO. O P2 joga via Remote Play recebendo apenas vídeo e áudio isolados do jogo (nenhuma notificação do seu celular aparece para o P2).
                      </p>
                      <label className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg cursor-pointer transition-colors">
                        <Disc className="w-4 h-4" />
                        {isoLoading ? 'Preparando Disco...' : 'Carregar ISO PS1 na Sala'}
                        <input
                          type="file"
                          multiple
                          accept=".iso,.bin,.cue,.img,.chd,.pbp,.mdf,.zip,.7z,.rar,.exe,.psx"
                          onChange={handleHostLoadIso}
                          className="hidden"
                        />
                      </label>
                    </div>
                  )}
                </>
              ) : !p2Approved ? (
                <div className="text-center p-6 max-w-md space-y-3">
                  <ShieldAlert className="w-8 h-8 text-amber-400 mx-auto" />
                  <h3 className="font-display text-lg font-semibold text-white">
                    {roomDoc.p2AccessStatus === 'denied'
                      ? 'Acesso Negado pelo Administrador P1'
                      : 'Aguardando Liberação do P1'}
                  </h3>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Você não precisa baixar nenhuma ISO. Assim que o Host P1 ({roomDoc.hostName}) clicar em &quot;Liberar Acesso P2&quot;, o Remote Play isolado do jogo (vídeo + áudio) aparecerá aqui com seus controles e analógicos na tela.
                  </p>
                  {roomDoc.p2AccessStatus === 'denied' && (
                    <button
                      type="button"
                      onClick={() => guestRequestJoinRoom(roomDoc.roomCode, user.uid, gamerTag)}
                      className="px-4 py-2 text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white rounded-lg"
                    >
                      Solicitar Novamente
                    </button>
                  )}
                </div>
              ) : (
                <>
                  <video
                    ref={guestVideoRef}
                    autoPlay
                    playsInline
                    muted={p2AudioMuted}
                    className={
                      guestRtcConnected ? 'w-full h-full object-contain' : 'hidden'
                    }
                  />
                  <canvas
                    ref={guestCanvasRef}
                    width={320}
                    height={240}
                    className={
                      !guestRtcConnected
                        ? 'w-full h-full object-contain [image-rendering:pixelated]'
                        : 'hidden'
                    }
                  />
                  {crtScanlines && <div className="crt-scanlines absolute inset-0" />}
                  <VirtualGamepad
                    visible={virtualGamepadOn}
                    disabled={!p2Approved}
                    onChange={handleP2VirtualChange}
                    onUserInteract={unlockGuestAudio}
                    onToggleVisibility={() => setVirtualGamepadOn(false)}
                  />
                </>
              )}
            </div>

            <div className="text-xs text-slate-400 flex flex-wrap items-center justify-between gap-2 pt-1">
              <span className="inline-flex items-center gap-1.5">
                <Bluetooth className={`w-3.5 h-3.5 ${activeBtName ? 'text-emerald-400' : 'text-slate-500'}`} />
                <span className={activeBtName ? 'text-emerald-400' : 'text-slate-400'}>
                  {activeBtName ? `Bluetooth: ${activeBtName}` : 'Bluetooth pronto · Remote Play transmite só a imagem e o áudio do jogo'}
                </span>
              </span>
              <span className="font-mono text-slate-300">
                {isHost ? 'Porta 1 (Host)' : 'Porta 2 (Convidado)'}
              </span>
            </div>
          </div>
        </div>

        <div className="lg:col-span-4 space-y-4">
          <div className="bg-[#171A21] border border-[#262B36] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-base font-semibold text-white">
                Controle de Acesso P2
              </h3>
              <span className="text-xs font-mono text-slate-400">
                {wsSnapshot?.p2Connected ? 'P2 Online' : 'P2 Offline'}
              </span>
            </div>

            {!roomDoc.p2Uid ? (
              <div className="p-3 bg-[#0F1115] border border-[#262B36] rounded-lg text-xs text-slate-400">
                Nenhum convidado P2 solicitou entrada ainda. Compartilhe o código{' '}
                <span className="font-mono text-white font-semibold">{roomDoc.roomCode}</span>.
              </div>
            ) : (
              <div className="p-3 bg-[#0F1115] border border-[#262B36] rounded-lg space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-white">{roomDoc.p2Name}</span>
                  <span
                    className={`font-semibold ${
                      p2Approved
                        ? 'text-emerald-400'
                        : p2Pending
                          ? 'text-amber-400'
                          : 'text-red-400'
                    }`}
                  >
                    {p2Approved
                      ? 'Liberado'
                      : p2Pending
                        ? 'Aguardando Aprovação'
                        : 'Bloqueado'}
                  </span>
                </div>

                {isHost && (
                  <div className="flex flex-wrap gap-2">
                    {!p2Approved && (
                      <button
                        type="button"
                        onClick={() =>
                          hostUpdateRoom(roomDoc.roomCode, {
                            p2AccessStatus: 'approved',
                            status: roomDoc.status === 'waiting' ? 'approved' : roomDoc.status,
                          })
                        }
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        <UserCheck className="w-3.5 h-3.5" />
                        Liberar Acesso P2
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        hostUpdateRoom(roomDoc.roomCode, {
                          p2AccessStatus: 'denied',
                        })
                      }
                      className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#20242E] hover:bg-red-950 text-red-300 border border-[#2E3543] rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      <UserX className="w-3.5 h-3.5" />
                      {p2Approved ? 'Revogar' : 'Recusar'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {isHost && (
              <label className="flex items-start gap-3 p-3 bg-[#0F1115] border border-[#262B36] rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={roomDoc.p2CanSelectCharacter}
                  onChange={(e) =>
                    hostUpdateRoom(roomDoc.roomCode, {
                      p2CanSelectCharacter: e.target.checked,
                    })
                  }
                  className="mt-0.5 rounded border-slate-600 bg-slate-900 text-blue-600"
                />
                <div className="space-y-0.5">
                  <div className="text-xs font-medium text-white">
                    Permitir que P2 escolha personagem / slot
                  </div>
                  <div className="text-xs text-slate-400">
                    Desmarque para que somente o P1 defina o papel do P2 no jogo.
                  </div>
                </div>
              </label>
            )}
          </div>

          <div className="bg-[#171A21] border border-[#262B36] rounded-xl p-5 space-y-4">
            <h3 className="font-display text-base font-semibold text-white">
              Papel / Seleção no Jogo
            </h3>

            <div className="space-y-1.5">
              <div className="text-xs text-slate-400">Slot P1 ({roomDoc.hostName})</div>
              {isHost ? (
                <select
                  value={roomDoc.p1Character}
                  onChange={(e) =>
                    hostUpdateRoom(roomDoc.roomCode, { p1Character: e.target.value })
                  }
                  className="w-full px-3 py-2 text-xs bg-[#0F1115] border border-[#262B36] rounded-lg text-white outline-none"
                >
                  {SLOT_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="px-3 py-2 text-xs bg-[#0F1115] border border-[#262B36] rounded-lg text-slate-200">
                  {roomDoc.p1Character}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="text-xs text-slate-400">
                Slot P2 ({roomDoc.p2Name || 'Aguardando'})
              </div>
              {isHost || (isGuest && p2Approved && roomDoc.p2CanSelectCharacter) ? (
                <select
                  value={roomDoc.p2Character}
                  onChange={(e) => {
                    if (isHost) {
                      hostUpdateRoom(roomDoc.roomCode, { p2Character: e.target.value });
                    } else {
                      guestUpdateCharacter(roomDoc.roomCode, e.target.value);
                    }
                  }}
                  className="w-full px-3 py-2 text-xs bg-[#0F1115] border border-[#262B36] rounded-lg text-white outline-none"
                >
                  {SLOT_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="px-3 py-2 text-xs bg-[#0F1115] border border-[#262B36] rounded-lg text-slate-300">
                  {roomDoc.p2Character} (gerenciado pelo P1)
                </div>
              )}
            </div>
          </div>

          {isHost && (
            <div className="bg-[#171A21] border border-[#262B36] rounded-xl p-5 space-y-3">
              <h3 className="font-display text-base font-semibold text-white">
                ISO da Sala NetPlay
              </h3>
              {mountedIso && (
                <div className="p-3 bg-[#0F1115] border border-[#262B36] rounded-lg text-xs space-y-1">
                  <div className="text-white font-semibold">{mountedIso.recognizedTitle.title}</div>
                  <div className="font-mono text-emerald-400">{mountedIso.serial}</div>
                  <div className="font-mono text-slate-400">
                    {(mountedIso.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB · {mountedIso.bootExePath}
                  </div>
                </div>
              )}
              <label className="w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 text-xs font-medium bg-[#0F1115] hover:bg-[#1C212B] text-slate-200 border border-[#262B36] rounded-lg cursor-pointer transition-colors">
                <Disc className="w-4 h-4 text-blue-400" />
                {isoLoading ? 'Lendo ISO...' : mountedIso ? 'Trocar ISO da Sala' : 'Selecionar ISO / BIN / CHD'}
                <input
                  type="file"
                  multiple
                  accept=".iso,.bin,.cue,.img,.chd,.pbp,.mdf,.zip,.7z,.rar,.exe,.psx"
                  onChange={handleHostLoadIso}
                  className="hidden"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
