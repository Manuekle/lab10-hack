# Agente · Reto 1

Servicio en TypeScript / Node.js que opera aplicaciones sin API por VNC. Plan y criterios: [plan de fase 2](../../tasks/plan.md) y [tareas](../../tasks/todo.md).

Estado: T01–T08. Servicio con API, supervisor, worker y driver en procesos separados; falta la política de escrituras verificadas (T09–T10), el harness de práctica y el despliegue.

## Requisitos

- Node.js 24 o superior (probado con 26). Sin dependencias nativas: WebSocket, SQLite, DES y zlib vienen con Node.
- Docker, sólo para la prueba con el escritorio VNC local.

## Uso

```sh
npm ci
cp .env.template .env  # completar; .env no se versiona
npm run check-env      # dice qué falta, sin mostrar valores
npm run typecheck
npm test
npm run build
```

En el checkout local de Manuel, `.env.example` contiene las credenciales del entorno de Frontier y está fuera de Git. Puede copiarse a `.env` para la práctica; completar `OPENROUTER_API_KEY` y elegir `OPENROUTER_MODEL`. La plantilla publicable es `.env.template`, sin secretos.

`TEAM_TOKEN` autentica las llamadas del evaluador a `/health`, `/tasks` y `/tasks/{task_id}` con `Authorization: Bearer <token>`. Frontier llama «equipo» también a un participante individual: usa el token asignado a Manuel aunque trabaje solo. `PRACTICE_DESKTOP_TOKEN` es distinto: autoriza `/__reset` y `/__check` del escritorio de desarrollo; no se utiliza para autenticar el servicio.

Servicio local y tarea de prueba como el evaluador:

```sh
PORT=18080 npm run dev                       # ALLOW_PRIVATE_DESKTOPS=true para el escritorio Docker local
npm run task -- --task "¿Cuántas facturas vencidas tiene Ferretería Ruiz?"
npm run build && npm start                   # producción, desde dist/
```

| Script | Qué hace | Toca el escritorio del evento |
| --- | --- | --- |
| `npm test` | Protocolo RFB con servidor falso y fragmentación, entradas, validación de propuestas, adaptador OpenRouter con dobles, SQLite | No |
| `npm run test:local-desktop` | Levanta Xvnc + websockify en Docker y valida auth, captura Raw, clic mantenido y texto con acentos | No |
| `npm run capture [-- --observe 5]` | Captura el escritorio de práctica y guarda PNG en `.artifacts/`. No envía entradas | Sólo lectura |
| `npm run benchmark -- --image <png> --models a,b [--read] [--runs 2]` | Mide modelos: JSON válido, acción propuesta, latencia, tokens y costo. Marca el punto de clic sobre la captura | No (salvo `--live`, sólo lectura) |
| `npm run task -- --task "..." [--local]` | Cliente del contrato: POST y consulta cada 2 s, como el evaluador | Según la tarea |
| `npm run walk -- --task "..." [--steps 3] [--allow-typing]` | Recorrido C1: captura, propuesta, acción, captura posterior. Rechaza objetivos de guardar, borrar, crear o exportar | Sí, navegación |

## Estructura

| Ruta | Responsabilidad |
| --- | --- |
| `src/config.ts` | Variables validadas; errores con nombres, nunca valores. Práctica separada del servicio |
| `src/rfb/protocol.ts` | Mensajes RFB y autenticación VNC |
| `src/rfb/client.ts` | Socket WebSocket, negociación, cola de bytes, composición del framebuffer, espera de repintado |
| `src/rfb/framebuffer.ts` | Framebuffer B,G,R,X, PNG con recorte y zoom, diferencia entre capturas |
| `src/rfb/input.ts` | Clic de 160 ms, combinaciones, texto carácter por carácter, liberación de entradas |
| `src/rfb/session.ts` | Ejecuta acciones ya validadas y devuelve la captura posterior |
| `src/model/actions.ts` | Esquema JSON de propuestas y validación local (frame vigente, límites, teclas permitidas) |
| `src/model/openrouter.ts` | Imagen + texto a OpenRouter; timeout limitado al plazo; bloquea secretos en la petición |
| `src/agent/prompt.ts` | Prompt genérico del worker: sin menús, rutas ni respuestas de SIGECOM |
| `src/store.ts` | Tareas y eventos en SQLite; terminal inmutable; reinicio marca abiertas como fallidas |
| `src/main.ts`, `src/server.ts` | Entrada del servicio; contrato HTTP autenticado; parada ordenada con SIGTERM |
| `src/admission.ts`, `src/desktop-url.ts` | Slots y lease por escritorio normalizado; rechazo de redes privadas |
| `src/supervisor.ts` | Plazo de 270/280 s, re-validación de propuestas, parada de procesos antes de publicar |
| `src/worker.ts`, `src/agent/memory.ts` | Proceso de inferencia sin socket VNC; memoria y avisos de falta de progreso |
| `src/driver.ts` | Proceso dueño del socket RFB; ejecuta sólo órdenes del supervisor |
| `src/summary.ts` | Resumen final con `respuesta:` sólo en preguntas terminadas y sin secretos |
| `scripts/` | Harness local. No forma parte del agente desplegado |

Las credenciales del escritorio sólo viven en memoria. `.artifacts/` guarda capturas de desarrollo y está fuera de git.

## Railway

La [preparación de Railway](RAILWAY.md) define el servicio, volumen y variables productivas. El `Dockerfile` compila el código y excluye credenciales del contexto. El contenedor arranca `node dist/main.js`.
