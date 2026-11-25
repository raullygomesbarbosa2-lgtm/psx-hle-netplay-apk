from pathlib import Path
p = Path('webapp/src/emulator/streamingIsoReader.ts')
s = p.read_text()
needle = "  private detectContainerTag(header: Uint8Array): { tag: string; label: string } | null {\n"
method = '''  private async hasValidRawCdSectorSync(): Promise<boolean> {
    // Raw PS1 BIN/IMG sectors carry the 12-byte CD sync pattern and mode byte.
    // A filename alone is not evidence that a file is a disc image.
    const head = await this.readBytes(0, Math.min(this.file.size, 2352 * 64));
    for (let i = 0; i + 16 <= head.length; i++) {
      if (head[i] !== 0x00 || head[i + 11] !== 0x00) continue;
      let sync = true;
      for (let j = 1; j <= 10; j++) {
        if (head[i + j] !== 0xff) { sync = false; break; }
      }
      if (sync && (head[i + 15] === 1 || head[i + 15] === 2)) return true;
    }
    return false;
  }

'''
if s.count(needle) != 1:
    raise SystemExit(f'Expected one container detector insertion point, got {s.count(needle)}')
s = s.replace(needle, method + needle)
old = '''    if (!isIso9660) {
      const label = this.file.name.replace(/\\.[^.]+$/, '').toUpperCase().slice(0, 48);
      const recognized = lookupPs1TitleBySerial('RAW-IMG', label);
'''
new = '''    if (!isIso9660) {
      if (!(await this.hasValidRawCdSectorSync())) {
        throw new Error(
          `O arquivo "${this.file.name}" foi reconhecido pelo nome, mas não contém um disco PS1 válido (sem ISO9660 nem assinatura de setor CD-ROM). Selecione a imagem completa do jogo, não um arquivo parcial ou renomeado.`,
        );
      }
      // Never infer a commercial game's identity from a filename alone.
      const label = 'DISC IMAGE WITHOUT VOLUME ID';
      const recognized = lookupPs1TitleBySerial('RAW-IMG', label);
'''
if s.count(old) != 1:
    raise SystemExit(f'Expected one raw-image fallback, got {s.count(old)}')
s = s.replace(old, new)
p.write_text(s)
print('Added raw CD sector validation and removed filename-only title identification; original ZIP remains unchanged.')
