# Cooper (Cooper Lt BT) — informes del chat

Serif de Bitstream para los informes del chat y su PDF. El resto de la interfaz sigue en SF Pro.

## Contenido

| Archivo | Peso | Glifos |
|---|---|---|
| `CooperLtBT_400-latin.woff2` | 400 | latino básico (218) |
| `CooperLtBT_400-s.p.*.woff2` | 400 | latino extendido (257) |
| `CooperLtBT_500-latin.woff2` | 500 | latino básico (218) |
| `CooperLtBT_500-s.p.*.woff2` | 500 | latino extendido (257) |

No hay cursiva ni pesos por encima de 500.

## Uso en la app

Se usan las variantes `s.p.` (cubren todo el latino del subset `-latin` y algo más):

- `app/fonts/cooper-{400,500}.woff2`: web, con `next/font/local` (`--font-cooper` → `--font-serif`), sin precarga.
- `public/fonts/cooper-{400,500}.ttf`: las mismas convertidas a TTF para incrustarlas en el PDF (`lib/report-pdf.ts`),
  porque pdf-lib no lee woff2. Se regeneran con fontTools:
  `python3 -c "from fontTools.ttLib import TTFont as F; f=F('app/fonts/cooper-400.woff2'); f.flavor=None; f.save('public/fonts/cooper-400.ttf')"`.

La cursiva se sintetiza: el navegador inclina la regular y el PDF la dibuja con 12° de inclinación. El énfasis de los
informes usa 500 (la más gruesa disponible), nunca 600, para que el navegador no simule una negrita.

Licencia: Cooper Lt BT es comercial (Bitstream). Confirmar que la licencia cubre uso web e incrustación en PDF antes de
un despliegue público o de repartir informes.
