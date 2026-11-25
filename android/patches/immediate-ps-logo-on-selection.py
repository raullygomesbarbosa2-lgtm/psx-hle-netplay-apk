from pathlib import Path

# Show the PlayStation logo immediately at ISO selection, then keep it up until the
# actual emulator start callback; do not simulate a loading percentage or hide it by timer.
for filename, function_name, host in [
    ('webapp/src/components/SoloEmulatorView.tsx', 'startBootSplashSequence', False),
    ('webapp/src/components/NetPlayPanel.tsx', 'startHostBootSplash', True),
]:
    p = Path(filename)
    s = p.read_text()
    start = s.find(f'  const {function_name} = useCallback(() => {{')
    if start < 0: raise SystemExit(f'{function_name} not found in {filename}')
    end = s.find('\n  }, [audioOn]);', start)
    if end < 0: raise SystemExit(f'{function_name} ending not found in {filename}')
    end += len('\n  }, [audioOn]);')
    reset_game = 'setHostGameStarted(false);' if host else 'setPaused(false);\n    setGameStarted(false);'
    body = f'''  const {function_name} = useCallback(() => {{
    if (bootTimerRef.current) window.clearTimeout(bootTimerRef.current);
    if (minLogoTimerRef.current) window.clearTimeout(minLogoTimerRef.current);
    setMinLogoDone(true);
    setBootPhase('ps');
    {reset_game}
    spuRef.current.setEnabled(audioOn);
    spuRef.current.unlock();
    spuRef.current.playSfx('boot');
  }}, [audioOn]);'''
    s = s[:start] + body + s[end:]
    p.write_text(s)
print('PlayStation logo now shows immediately and remains until actual game start in Solo and P1 NetPlay.')
