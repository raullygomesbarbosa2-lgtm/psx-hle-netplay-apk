from pathlib import Path

splash = Path('webapp/src/components/Ps1BootSplash.tsx')
s = splash.read_text()
s = s.replace('  iso: IsoMountInfo;\n', '  iso: IsoMountInfo | null;\n', 1)
s = s.replace('''          High-Level BIOS · {iso.recognizedTitle.region}
''','''          High-Level BIOS · {iso?.recognizedTitle.region || 'NTSC'}
''')
s = s.replace('''        {iso.recognizedTitle.title} · {iso.serial}
''','''        {iso?.recognizedTitle.title || 'Preparando disco PS1'}{iso?.serial ? ` · ${iso.serial}` : ''}
''')
s = s.replace('''        Licensed HLE Mode · {iso.recognizedTitle.region}
''','''        Licensed HLE Mode · {iso?.recognizedTitle.region || 'NTSC'}
''')
splash.write_text(s)

solo = Path('webapp/src/components/SoloEmulatorView.tsx')
s = solo.read_text()
# The PlayStation startup logo should begin immediately on file selection, during directory
# inspection and safety checks, instead of appearing only after those steps finish.
needle = '''    setGameStarted(false);
    setMinLogoDone(false);
    setBootPhase('idle');
    setFrameCount(0);
'''
replacement = '''    setGameStarted(false);
    setMountedIso(null);
    setMinLogoDone(false);
    setFrameCount(0);
    startBootSplashSequence();
'''
if s.count(needle) != 1: raise SystemExit('Solo selection-state block did not match')
s = s.replace(needle, replacement, 1)
# Remove the second splash reset after disc parsing; it caused a logo flash/restart.
s = s.replace('''    setFrameCount(0);
    startBootSplashSequence();

    pushLog(`[ISO] Título:''','''    setFrameCount(0);

    pushLog(`[ISO] Título:''',1)
s = s.replace('''    setFrameCount(0);
    startBootSplashSequence();

    pushLog(`[STREAM]''','''    setFrameCount(0);

    pushLog(`[STREAM]''',1)
# All preflight exits must remove the immediate boot splash, not leave a stuck logo.
s = s.replace('''      setIsoError(
        `Você selecionou apenas o índice "${file.name}".''','''      setIsoError(
        `Você selecionou apenas o índice "${file.name}".''',1)
# Render immediately while loading even before ISO metadata is available.
s = s.replace('''              {mountedIso && (bootPhase === 'sce' || bootPhase === 'ps') && (
                <Ps1BootSplash iso={mountedIso} phase={bootPhase} />
              )}
''','''              {(mountedIso || isoLoading) && (bootPhase === 'sce' || bootPhase === 'ps') && (
                <Ps1BootSplash iso={mountedIso} phase={bootPhase} />
              )}
''',1)
# Invalid CUE exits clear the splash; the other error exits already transition to done.
s = s.replace('''      setIsoLoading(false);
      return;
    }

    try {
      const reader = new StreamingIsoReader(file);''','''      setIsoLoading(false);
      setBootPhase('done');
      return;
    }

    try {
      const reader = new StreamingIsoReader(file);''',1)
# Blocked safety check exits clear the splash.
s = s.replace('''        setIsoError(safety.blockedReason);
        setIsoLoading(false);
        return;
''','''        setIsoError(safety.blockedReason);
        setIsoLoading(false);
        setBootPhase('done');
        return;
''',1)
solo.write_text(s)

net = Path('webapp/src/components/NetPlayPanel.tsx')
s = net.read_text()
# Begin the PS1 boot logo as soon as the host chooses a game; not after filesystem inspection.
needle = '''    setHostGameStarted(false);
    setMinLogoDone(false);
    setBootPhase('idle');
    setHostFrameNum(0);
'''
replacement = '''    setHostGameStarted(false);
    setMountedIso(null);
    setMinLogoDone(false);
    setHostFrameNum(0);
    startHostBootSplash();
'''
if s.count(needle) != 1: raise SystemExit('NetPlay selection-state block did not match')
s = s.replace(needle, replacement, 1)
s = s.replace('''    setHostFrameNum(0);
    startHostBootSplash();

    try {
''','''    setHostFrameNum(0);

    try {
''',1)
s = s.replace('''    setHostFrameNum(0);
    startHostBootSplash();

    const psx = new PsxConsole();''','''    setHostFrameNum(0);

    const psx = new PsxConsole();''',1)
# Do not leave a loading logo visible after rejected CUE/preflight.
s = s.replace('''      setStatusError(
        `Você selecionou apenas o índice "${file.name}".''','''      setStatusError(
        `Você selecionou apenas o índice "${file.name}".''',1)
s = s.replace('''      setIsoLoading(false);
      return;
    }

    try {
      const reader = new StreamingIsoReader(file);''','''      setIsoLoading(false);
      setBootPhase('done');
      return;
    }

    try {
      const reader = new StreamingIsoReader(file);''',1)
s = s.replace('''        setStatusError(safety.blockedReason);
        setIsoLoading(false);
        return;
''','''        setStatusError(safety.blockedReason);
        setIsoLoading(false);
        setBootPhase('done');
        return;
''',1)
s = s.replace('''                  {mountedIso && (bootPhase === 'sce' || bootPhase === 'ps') && (
                    <Ps1BootSplash iso={mountedIso} phase={bootPhase} />
                  )}
''','''                  {(mountedIso || isoLoading) && (bootPhase === 'sce' || bootPhase === 'ps') && (
                    <Ps1BootSplash iso={mountedIso} phase={bootPhase} />
                  )}
''',1)
needle = '''      setStatusError(err instanceof Error ? err.message : 'Erro ao montar ISO na sala.');
      setBootPhase('done');
      setHostBackend('idle');
'''
replacement = needle + '''      if (roomDoc) await hostUpdateRoom(roomDoc.roomCode, { status: 'waiting' }).catch(() => {});
'''
if s.count(needle) != 1: raise SystemExit('NetPlay error cleanup point did not match')
s = s.replace(needle, replacement, 1)
net.write_text(s)
print('Boot logo begins immediately upon Solo/P1 ISO selection; P1 failure returns the room to waiting.')
