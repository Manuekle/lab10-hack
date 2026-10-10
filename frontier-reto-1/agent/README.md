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
| `npm run practice -- [E1 … E5\|all] [--base URL] [--rounds N]` | Harness: `/__reset`, tarea con sólo `instruccion`, consulta cada 5 s, `/__check` y evaluación aparte del resumen; agrega filas a `output/audit/ejecucion.md` | Sí (reset y escrituras) |
| `npm run canary -- [--interval 60] [--minutes 45] [--verify E3]` | Vigila el escritorio en sólo lectura (salud, tamaño, cabecera de la app, tiempos); ante un cambio guarda evidencia y, con `--verify`, prueba al agente | Sólo lectura (salvo `--verify`) |
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
| `src/observatory.ts`, `src/ui.ts`, `src/ui/` | Observatorio de sólo lectura (`/ui`): última captura por tarea, aprendizaje y olvidos, panel del incidente |
| `scripts/` | Harness local. No forma parte del agente desplegado |

Las credenciales del escritorio sólo viven en memoria. `.artifacts/` guarda capturas de desarrollo y está fuera de git.

## Observatorio (`/ui`)

Página de sólo lectura para seguir al agente y explicar el incidente de las 15:30. `GET /ui` es pública porque no trae datos: pide el token del equipo, lo guarda en `sessionStorage` de esa pestaña y lo envía como `Authorization: Bearer` a estas rutas, con el mismo token y el mismo freno a la fuerza bruta que el contrato:

| Ruta | Devuelve |
| --- | --- |
| `GET /tasks` | Últimas 50 tareas: estado, fase, tarea, resumen, inicio, fin, costo y pasos |
| `GET /tasks/{id}/events` | La tarea y su línea de tiempo (pasos, rechazos, verificaciones, cierre, aprendizaje) |
| `GET /tasks/{id}/frame.png` | Última captura que vio el supervisor (en memoria, 6 tareas); `X-Frame-Points` marca el último clic |
| `GET /knowledge` | Lecciones por app e historial de aprendizajes y olvidos |
| `GET /ui/incidente.json`, `/ui/assets/*.png` | Datos fijos del incidente (editar `src/ui/incidente.json`) y capturas antes/después |

El observatorio se engancha en `main.ts` sin tocar el supervisor: envuelve el driver para guardar la referencia de cada captura y persiste como eventos los logs de app, aprendizaje y olvido. Ninguna respuesta incluye `desktop_key`, la contraseña del escritorio, el token ni claves; los textos pasan otra vez por `redact`. La página usa CSP con hash y escribe datos en el DOM sólo como texto.

## Railway

La [preparación de Railway](RAILWAY.md) define el servicio, volumen y variables productivas. El `Dockerfile` compila el código y excluye credenciales del contexto. El contenedor arranca `node dist/main.js`.

## Seguridad

| Riesgo | Control |
| --- | --- |
| Token del equipo | Todas las rutas con `Bearer` comparado en tiempo constante, salvo la página vacía `/ui`; 429 tras 30 fallos por minuto desde una IP |
| Clientes lentos o cuerpos grandes | `headersTimeout` 10 s, `requestTimeout` 15 s, cuerpo ≤64 KB |
| SSRF con la URL del escritorio | Sólo `ws(s)://`, sin credenciales en la URL; rechazo de IPs privadas literales y, en el driver, de hostnames que **resuelven** a redes privadas (`ALLOW_PRIVATE_DESKTOPS=true` sólo en local) |
| Servidor VNC hostil | Tamaños validados antes de reservar memoria: escritorio ≤4096 px, nombre ≤1 KB, portapapeles ≤1 MB, cola ≤64 MB, rectángulos dentro del framebuffer |
| Secretos | Contraseña del escritorio sólo en RAM del driver; el worker no la recibe; resúmenes, eventos y logs redactados; las peticiones al modelo se bloquean si contienen un secreto; `.env` y `.env.example` fuera de git |
| Inyección desde la pantalla | El texto de la app es dato. Borrar o exportar sólo si **la tarea** lo pide (regla determinista del supervisor); teclas en lista cerrada; las lecciones aprendidas descartan instrucciones y datos |
| Procesos | Hijos sin el entorno del servicio; parada antes de 280 s con SIGKILL; si el padre muere, los hijos terminan |
| Dependencias | Ninguna en runtime (`npm audit`: 0) |

El contenedor corre como root porque los volúmenes de Railway se montan con ese dueño; no expone otro puerto que el HTTP.

## Guardrails y recuperación

- **Escritura pendiente:** tras Guardar, Crear, Exportar, Eliminar o Confirmar, el supervisor no permite otra escritura, una recarga (F5) ni terminar `terminada` hasta que el modelo describa en `evidence` lo que prueba el efecto en la captura posterior. Tres intentos sin evidencia terminan en `fallida`.
- **Conexión caída:** el driver reconecta (hasta 3 veces); una escritura en curso queda **incierta** y nunca se repite a ciegas; una acción decidida sobre la pantalla anterior no se ejecuta tras reconectar.
- **App más lenta:** si la pantalla cambia después de una captura «sin cambios», el driver alarga sus esperas (+400 ms, hasta 2,5 s) y el agente lo recuerda para esa app.
- **Fallos del modelo:** respaldo Haiku tras timeout, red, 429 o 5xx; reintento de la propuesta y relanzamiento del worker si muere.
- **Pantalla en blanco o con error:** el modelo puede recargar con F5 (bloqueado con una escritura pendiente), cerrar diálogos o esperar.
- **Servicio:** errores no capturados provocan parada ordenada y salida con error para que Railway reinicie; al arrancar, las tareas abiertas pasan a `fallida` sin replay.

## Aprendizaje del sistema

El agente no trae conocimiento de ninguna app en el prompt. Al terminar cada tarea, un modelo barato resume **lo que el propio agente hizo y observó** (rutas de menús, controles, paginación, búsqueda, diálogos, tiempos) en hasta 10 lecciones por aplicación, guardadas en SQLite (`app_knowledge`, clave = nombre visible de la app sin versión). En las tareas siguientes sobre la misma app se entregan como pistas que el agente debe comprobar en pantalla; si la app cambió, explora y las lecciones se corrigen al terminar. Se descartan datos de registros, cifras, códigos e instrucciones leídas en la app. También se recuerda la espera extra de repintado.
