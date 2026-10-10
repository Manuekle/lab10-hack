# Incidente de las 15:30 · Registro y adaptación

Estado: **pendiente**. El anuncio aún no ha ocurrido. Este documento fija el procedimiento y se completará con lo que se observe; no se anticipa el contenido.

## Preparación previa

- **Línea base:** ronda E1–E5 desde reset antes de las 15:30 (filas en [ejecucion.md](ejecucion.md)) y captura de referencia de la cabecera de la app (`npm run canary` guarda `.artifacts/canary-baseline.png`).
- **Detección:** `npm run canary -- --interval 60 --minutes 60 --verify E3` vigila en sólo lectura salud, tamaño, cabecera y versión de la app, y tiempos de conexión y captura. Ante un cambio guarda la captura como evidencia y corre E3 desde reset contra el agente.
- **Adaptación en tiempo de ejecución (sin cambiar código):**
  - reconexión del VNC sin repetir escrituras inciertas;
  - esperas que se alargan si la app repinta más lento;
  - respaldo de modelo y reinicio del worker;
  - F5 ante pantallas en blanco;
  - lecciones aprendidas que se corrigen cuando la UI cambia.

## Procedimiento al ocurrir

1. Leer el anuncio en el portal y copiar aquí su texto literal, con la hora.
2. Reproducir: alerta del canario, captura antes/después y prueba afectada desde reset.
3. Diagnosticar en qué capa está: red/VNC, tiempos, UI, modelo o política.
4. Si la adaptación automática no basta, cambiar lo mínimo, siempre genérico y sin rutas, coordenadas ni textos de SIGECOM. Prueba antes/después y nueva ronda E1–E5.
5. Desplegar y repetir la comprobación contra el servicio público.

## Registro

| Hora | Observación | Evidencia |
| --- | --- | --- |
| | | |

## Diagnóstico

## Adaptación y verificación
