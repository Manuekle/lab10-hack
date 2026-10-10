# Video de entrega — Frontier / Lab10 · v3

1:56, 1920 × 1080, 30 fps. Subtítulos incorporados, sin narración ni música, preparado para añadir la voz de Manuel.

## Diseño y captura

Cooper Light BT para títulos; SF Pro Text para textos, datos y subtítulos. Las fuentes locales se cargan desde `public/fonts` con `@remotion/fonts`, bloqueando el render hasta que estén listas. Paleta azul cobalto, niebla azul y amarillo; el ticket de las 15:30 guía la secuencia del incidente.

La grabación E2 ocupa casi todo el ancho. Se muestra la lista completa y se amplía la ficha sólo cuando se abre, conservando todos sus campos y los botones Guardar y Volver. Los subtítulos están fuera de la grabación. Los acercamientos de la dirección y la nota usan la captura real, sin reescribir su contenido.

## Abrir y editar

Vista previa: http://localhost:3127/FrontierDemo

Este proyecto está separado del proyecto Oruka de `/Users/manudev/Dev/remotion`. En esta computadora reutiliza sus dependencias mediante un enlace a `node_modules`. En otra computadora, ejecuta `npm install`.

```sh
npm run studio
npm run render
python3 scripts/export-captions.py
```

Cada escena, grabación y subtítulos aparecen como elementos editables en Remotion Studio. Si cambias texto o tiempos, vuelve a exportar el guion y renderiza.

## Grabar tu voz

1. Abre `../output/video/frontier-demo-v3.mp4` y `../output/video/guion-voz-v3.md`.
2. En QuickTime, Archivo → Nueva grabación de audio. Selecciona tu micrófono y graba mientras reproduces el video. Lee cada frase en su tiempo y deja las pausas.
3. Guarda la toma como `voz.m4a` junto al MP4.
4. Añádela en tu editor habitual, o ejecuta desde la carpeta de los videos:

```sh
ffmpeg -i frontier-demo-v3.mp4 -i voz.m4a -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -af apad -t 116 -movflags +faststart frontier-demo-con-voz.mp4
```

El resultado sigue durando 1:56, dentro del límite de dos minutos. Sube el archivo con voz a un alojamiento accesible mediante enlace y usa ese enlace público en la entrega.

## Evidencia y alcance

- E2: grabación real desde el canvas de noVNC con Computer Use, 1280 × 800. Original: `../output/video/e2-grabacion-original.mp4`; resultado: `../output/video/e2-demo.txt`. En el montaje se reproduce a 2×, indicado en pantalla.
- E2 pasa en 54,1 s: cambia la dirección del cliente CL-0007 a Calle 80 # 24-15, confirma el guardado y no realiza cambios ajenos.
- 10/10: dos rondas completas de práctica en Railway, anteriores al incidente. Fuente: `../output/audit/ejecucion.md`.
- Incidente de las 15:30: ticket #FR-0153. La app oficial pasó de SIGECOM 3.9 a 4.2: tema verde, modal de Novedades, acciones a la derecha, nuevos botones y formularios que permanecen abiertos tras aplicar. El video incluye el modal oficial aportado por Manuel y una observación pasiva real del escritorio durante E3, al doble de velocidad.
- Resultado posterior al incidente: 5/5 casos E1–E5 desde reset, agente local contra el escritorio oficial 4.2. En E1 se verificó “Cambios aplicados” antes de cualquier nueva escritura; no se repitió Aplicar ni se creó un duplicado. E5 devuelve fallida correctamente ante homónimos. Fuentes: `../output/audit/incidente-1530.md` y `../output/audit/ejecucion.md`. Los 5/5 corresponden al agente local, y se rotulan así en el video.
- El material se seleccionó sin modificar las tareas de Claude, la aplicación compartida o la entrega de Frontier. No contiene tokens ni claves.

La demo E2 de la primera mitad conserva SIGECOM 3.9 y se rotula como línea base anterior al incidente. La captura nueva está en `public/v42-observacion-real.mp4`; el registro de fotogramas y la comprobación están en `../output/video/capture-v42` y `../output/video/ui-v42-verificacion.md`.
