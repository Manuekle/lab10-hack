# Selección del modelo · 10 de octubre de 2026

Medición sobre una captura real del escritorio de práctica: SIGECOM, listado de clientes, 1280×800, obtenida por nuestro driver RFB. Las respuestas esperadas solo las conoce el harness; no entran al prompt del agente. Script: `npm run benchmark` en `frontier-reto-1/agent/`. Las cifras son de esta sesión y no garantizan el resultado en la app oculta.

## Decisión

| Variable | Valor | Motivo |
| --- | --- | --- |
| `OPENROUTER_MODEL` | `anthropic/claude-sonnet-5.5` | Acertó 8/8 coordenadas al píxel exacto, tanto en píxeles como en 0–1000; respuestas exactas en conteo e identidad. Prioriza la corrección en la app desconocida |
| `OPENROUTER_FALLBACK_MODEL` | `anthropic/claude-haiku-5.5` | Misma convención de coordenadas y mismo nivel en estas pruebas. Unas 20 veces más barato; se usa tras timeout, red, 429 o 5xx |
| `OPENROUTER_COORDS` | `pixel` | Claude y GPT aciertan en píxeles. Gemini y Qwen solo aciertan en 0–1000 |

## Resultados

Coordenadas: caja del campo Nombre (tarea de búsqueda) y del botón Siguiente (tarea de paginación); dos corridas por convención.

| Modelo | Aciertos de clic (píxel) | Aciertos (0–1000) | Latencia por paso | Costo por paso |
| --- | ---: | ---: | ---: | ---: |
| Claude Sonnet 5.5 | 4/4 | 4/4 | 3,5–4,9 s | ~US$0,011 |
| Claude Haiku 5.5 | 4/4 | 2/4 | 3,1–4,0 s | ~US$0,00055 |
| GPT-6 Luna | 4/4 | 4/4 | 2,8–5,1 s | US$0,0001–0,0004 |
| Gemini 3.8 Flash | 0/4 (responde en 0–1000) | 4/4 | 5,2–17,7 s; un JSON truncado | ~US$0,004–0,012 |
| Qwen3.8 Flash | 2/3 | 4/4 | 7,7–17,3 s; un 504 | ~US$0,0003 |

Lectura y juicio, con Sonnet, Haiku y Luna, dos corridas cada uno: los tres respondieron bien en todas.

- Clientes de Bogotá en la página: `7`.
- Clientes con nombre exacto «Abarrotes Moreno»: `2; CL-0121, CL-0136`. Se excluyen las variantes «Abarrotes Moreno Central».
- Fecha de la app `14/10/2026`, 20 filas y el texto pequeño transcrito literalmente.

## Recorrido C1

`npm run walk` con la tarea «Abre el listado de facturas sin modificar ningún dato», usando Sonnet 5.5:

- 5 pasos: Comercial, Ventas (callejón sin salida), Cartera, Facturas y `finish terminada`.
- 29,8 s y US$0,058. Inferencia de 3,5–4,9 s y acción con repintado de ~1,2 s por paso.
- La captura final muestra el listado de facturas. No se escribió texto ni se guardó nada.

Con ~5,6 s por paso caben unas 45 propuestas en 260 s. El tope de 40 del diseño es compatible.

## Hallazgos que cambiaron el código

- Claude 5.5 y GPT-6 no aceptan `temperature`: con `provider.require_parameters` OpenRouter responde 404. Ahora es opcional y no se envía.
- Anthropic rechaza `enum` con `null` dentro de `type: [t, "null"]`. El esquema usa `anyOf`.
- Gemini y Qwen devuelven coordenadas normalizadas 0–1000. `OPENROUTER_COORDS=norm1000` las convierte a píxeles nativos al validar.

## TypeSafe / Jev

No se usa por ahora. Jev 1.13 acepta solo texto («No image, audio, or video input»), así que no puede leer capturas. Además, su idioma principal es el inglés y no hay clave configurada. Usarlo en cada paso agregaría una llamada después de la lectura visual, lo que hace el paso más lento, no más rápido.

Uso posible más adelante (T09): una verificación rápida, solo antes de escribir, sobre texto que ya extrajo el modelo visual. Por ejemplo, una pregunta Noul: «¿la acción cambia solo lo que pide la tarea?». Antes de adoptarlo habría que medirlo en español.
