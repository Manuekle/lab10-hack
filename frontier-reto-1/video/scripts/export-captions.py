import json
import re
from pathlib import Path

project = Path(__file__).resolve().parents[1]
output = project.parent / 'output' / 'video'
output.mkdir(parents=True, exist_ok=True)
scenes = [('Intro', 10), ('Architecture', 14), ('Demo', 32), ('Safety', 12), ('Incident', 28), ('Results', 12), ('Closing', 8)]
all_captions = []
script = ['# Guion de voz — demo Frontier v3 (1:56)', 'Lee las frases siguiendo estos tiempos. El MP4 tiene subtítulos y no tiene narración. Graba tu voz mientras lo reproduces; deja pausas hasta la siguiente frase.']
script.append('El segmento del incidente usa el modal oficial y una captura pasiva de SIGECOM 4.2. La demo inicial es la línea base de SIGECOM 3.9. Los resultados de la UI nueva corresponden a pruebas locales; no se atribuyen al servicio de Railway ni al set oculto.')
srt = []
offset = 0

def fmt(ms):
    h, rem = divmod(ms, 3600000)
    m, rem = divmod(rem, 60000)
    s, milli = divmod(rem, 1000)
    return f'{h:02}:{m:02}:{s:02},{milli:03}'

for scene, duration in scenes:
    source = (project / 'src' / f'{scene}.tsx').read_text()
    captions = json.loads(re.search(r'captions=\{(\[[\s\S]*?\])\}', source).group(1))
    for local in captions:
        caption = {**local, 'startMs': local['startMs'] + offset, 'endMs': local['endMs'] + offset}
        assert 0 <= caption['startMs'] < caption['endMs'] <= 116000
        all_captions.append(caption)
        srt.append(f"{len(all_captions)}\n{fmt(caption['startMs'])} --> {fmt(caption['endMs'])}\n{caption['text']}\n")
        start, end = caption['startMs'] // 1000, caption['endMs'] // 1000
        script.append(f"**{start // 60}:{start % 60:02}–{end // 60}:{end % 60:02}** · {caption['text']}")
    offset += duration * 1000
assert offset == 116000
(output / 'subtitulos-v3.srt').write_text('\n'.join(srt))
(output / 'subtitulos-v3.json').write_text(json.dumps(all_captions, indent=2, ensure_ascii=False) + '\n')
(output / 'guion-voz-v3.md').write_text('\n\n'.join(script) + '\n')
print(f'{len(all_captions)} subtítulos exportados; guion sincronizado, 1:56.')
