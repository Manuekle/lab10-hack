# Tareas · Fase 2 del Reto 1

Plan y decisiones: [plan.md](plan.md). Estado a las 14:35 del 10/10 (Bogotá): T01–T08, C1 y C2 hechas; agente en `main` (commits `56bd694` y `126e858`), con imagen Docker probada; harness y línea base en marcha; despliegue en Railway pendiente de que el usuario conecte GitHub. El orden de lo que falta (B0–B9), con horarios y autorizaciones, está en el [plan](plan.md#3-qué-falta-en-orden). Siguiente: B0 (desplegar) y B1 (harness) en paralelo. Los archivos citados son propuestos. La revisión de cada checkpoint evalúa evidencia antes de ampliar el bloque siguiente.

En la lista de archivos, `agent/` abrevia `frontier-reto-1/agent/`, desde la raíz del repositorio. Las verificaciones con npm se ejecutarán dentro de ese proyecto cuando exista.

## T01 · Proyecto TypeScript y configuración

- [x] Implementar. `npm ci`, `npm run typecheck`, `npm run build` y 35 pruebas pasan. Sin dependencias nativas (Node 26: WebSocket, `node:sqlite`, DES vía 3DES-EDE, zlib). `npm run check-env` informa faltantes sin mostrar valores.
- Aceptación: build reproducible; variables validadas con mensajes sin valores secretos; configuración de práctica separada de la configuración productiva.
- Verificación: `npm ci`, `npm run build` y prueba de configuración ausente/inválida desde `frontier-reto-1/agent/` una vez definidos esos scripts.
- Dependencias: ninguna. Alcance: M.
- Archivos: `agent/package.json`, `agent/package-lock.json`, `agent/tsconfig.json`, `agent/.env.example`, `agent/src/config.ts`.

## T02 · Captura RFB por WebSocket

- [x] Implementar: negociación 3.3/3.7/3.8, VncAuth, Raw, CopyRect, DesktopSize, actualizaciones continuas, PNG con recorte/zoom.
- [x] Fixtures: fragmentación byte a byte, CopyRect, redimensión, auth rechazada sin filtrar contraseña, cierre con esperas pendientes.
- [x] Escritorio real local (Xvnc + websockify en Docker): 1280×800 completo en 274 ms, 4,1 MB Raw, colores correctos.
- [x] Escritorio de práctica, sin contraseña: WebSocket abre en ~1,3 s, saludo `RFB 003.008`, ofrece sólo seguridad tipo 2 (VncAuth).
- [x] Captura autenticada del escritorio de práctica: 3.8 + VncAuth, 1280×800, formato de píxel del servidor igual al pedido, frame completo 1,65 s (4,1 MB Raw), PNG 136 KB en 39 ms; 0 actualizaciones en 3 s sin actividad.
- Aceptación: negociar/authenticar con credenciales sólo en RAM; componer actualizaciones Raw incluso fragmentadas; capturar dimensiones reales y framebuffer completo sin leer datos internos.
- Verificación: fixtures de protocolo, fragmentación y composición; captura real de práctica sin alterar registros; registrar dimensiones y tiempo de captura.
- Dependencias: T01. Alcance: M.
- Archivos: `agent/src/rfb/client.ts`, `agent/src/rfb/protocol.ts`, `agent/src/rfb/framebuffer.ts`, `agent/test/rfb.test.ts`, `agent/scripts/capture.ts`.

## T03 · Mouse, teclado y reemplazo de texto

- [x] Implementar: clic mantenido 160 ms, combinaciones con modificadores, texto carácter por carácter (Latin-1 y Unicode), coordenadas acotadas, `releaseAll`.
- [x] Escritorio local: texto `Calle 80 # 24-15, Papelería Ñandú áéíóú ¿ok?` llega completo; xev mide clic de 162 ms.
- [x] App de práctica: en E3 el agente escribió `Ferretería Ruiz` con `replace_text` en el filtro Cliente y la búsqueda aplicó bien (resultado 45).
- Aceptación: clic mantenido 160 ms; selección y reemplazo sin concatenación, incluidos acentos; coordenadas acotadas y todas las entradas liberadas durante cierre.
- Verificación: mensajes RFB de entrada; probar navegación y búsqueda reversibles; leer el texto completo en una captura posterior; no guardar formularios.
- Dependencias: T02. Alcance: S.
- Archivos: `agent/src/rfb/input.ts`, `agent/test/input.test.ts`.

## T04 · Adaptador visual de OpenRouter

- [x] Implementar: esquema estricto con nulos explícitos, validación local (frame vigente, límites, lista de teclas), reintento con retroalimentación, timeout acotado al plazo, cancelación, bloqueo de secretos en la petición, costo y tokens.
- [x] Dobles: JSON inválido, fuera de esquema, timeout, sin plazo, cancelación, 401 sin filtrar la clave. La prueba encontró y corrigió un timeout no entero.
- [x] Benchmark real de 5 modelos: `anthropic/claude-sonnet-5.5` principal, `anthropic/claude-haiku-5.5` de respaldo y coordenadas `pixel`. Corrigió `temperature` (404 con Claude 5.5 y GPT-6), `enum` con null (400 en Anthropic) y la convención 0–1000 de Gemini/Qwen.
- Aceptación: modelo configurable que admita capturas y esquema; validar JSON localmente; cancelación y timeout limitados al presupuesto restante sin enviar credenciales.
- Verificación: respuestas inválidas y timeout con dobles; inferencia real sobre captura, medir latencia/tokens/costo y capacidad de lectura de texto/controles. No consumir evaluación oculta.
- Dependencias: T02. Alcance: M.
- Archivos: `agent/src/model/openrouter.ts`, `agent/src/model/actions.ts`, `agent/test/model.test.ts`, `agent/scripts/benchmark.ts`.

## C1 · Recorrido técnico mínimo

- [x] Captura → propuesta validada → acción reversible → nueva captura con postcondición: abrir Facturas en 5 pasos, 29,8 s, US$0,058, sin escrituras.
- [x] Build y 38 pruebas pasan; evidencia en `.artifacts/` (local) y [benchmark](../frontier-reto-1/output/audit/benchmark-modelos.md).
- [x] Revisado: el usuario aprobó el modelo y C1 y autorizó T05, T07 y T08.

## T05 · Bucle visual y memoria de tarea

- [x] Implementar: worker en proceso propio, memoria con resultado observado por paso, notas acumuladas, avisos de falta de progreso y repetición (por distancia, no por cubetas), `fill` para llenar formularios en un paso, caché del prompt de sistema (Anthropic) y espera por tipo de acción (clic/tecla ≥1 s, escritura ≥400 ms).
- [x] Pruebas: memoria, avisos, rechazos en historial, prompt sin datos de SIGECOM. Real: escritorio local (texto exacto con acentos, 4 pasos, 25 s) y E3 en práctica (abajo).
- Aceptación: una acción por frame vigente; mapa temporal y progreso limitado; texto de pantalla tratado como datos, sin expectativas del harness ni rutas/coordenadas de SIGECOM.
- Verificación: UI simulada con cambios de etiquetas, frame consumido, nota con instrucción ajena y falta de progreso; recorrido de lectura con el escritorio real.
- Dependencias: C1. Alcance: M.
- Archivos: `agent/src/worker.ts`, `agent/src/agent/prompt.ts`, `agent/src/agent/memory.ts`, `agent/test/worker.test.ts`.

## T06 · Registro SQLite y recuperación

- [x] Implementar con `node:sqlite`, migraciones por `user_version`, trigger de terminal inmutable, eventos por tarea. Pruebas de rollback, inmutabilidad y reinicio con archivo temporal pasan. El esquema vive en `src/store.ts` en lugar de `schema.sql` para no copiar archivos en el build.
- Aceptación: estados y tiempos sin credenciales; terminal inmutable; tareas abiertas pasan a fallida al reiniciar sin replay.
- Verificación: registro/lectura, rollback de admisión fallida, terminal inmutable y reinicio con DB temporal.
- Dependencias: T01. Alcance: M.
- Archivos: `agent/src/store.ts`, `agent/src/schema.sql`, `agent/test/store.test.ts`.

## T07 · Contrato HTTP y admisión

- [x] Implementar: tres rutas con token (comparación en tiempo constante), errores `{"error":{"code","message"}}`, 401/404/405/409/422/503, lease por escritorio normalizado, tope de activas, rechazo de redes privadas y URLs con credenciales (`ALLOW_PRIVATE_DESKTOPS=true` sólo en local).
- [x] Pruebas HTTP reales: auth en las tres rutas, admisión <2 s (medida 26–29 ms contra el servicio real), 409 con el mismo escritorio escrito distinto, 503 por capacidad sin crear tareas, 422 sin reflejar valores.
- Aceptación: tres rutas autenticadas y nombres exactos; `POST` reserva slot/escritorio y registra antes de responder en <2 s; rechaza escritorio ocupado o saturación sin crear tareas ni exponer secretos.
- Verificación: llamadas HTTP reales con auth/cuerpo inválidos, ID inexistente, mismo endpoint normalizado y tercer escritorio; conectar una tarea de lectura al worker sin bloquear admisión.
- Dependencias: T05, T06. Alcance: M.
- Archivos: `agent/src/server.ts`, `agent/src/admission.ts`, `agent/src/desktop-url.ts`, `agent/test/api.test.ts`, `agent/test/admission.test.ts`.

## T08 · Supervisor, procesos y plazo

- [x] Implementar: supervisor, worker y driver en procesos separados (IPC con serialización avanzada; los hijos no heredan el entorno del servicio). Revocación a 270 s; worker con SIGKILL; driver con cierre ordenado y SIGKILL al vencer el plazo; lease liberado y terminal publicado sólo tras confirmar la salida. Re-validación de cada propuesta (frame vigente, coordenadas, teclas) y rechazo de Guardar/Crear/Exportar repetido sin comprobación intermedia. SIGTERM: parada ordenada y fallida.
- [x] Pruebas con procesos reales y reloj abreviado: worker bloqueado, driver que ignora cierre y SIGTERM, procesos que ignoran todo, máximo de propuestas, `stopAll`, padre muerto con SIGKILL (el driver real termina). Todas terminan antes del corte; ninguna acción tras la revocación.
- Aceptación: worker sin socket VNC; revocar a 270 s y confirmar fin antes de 280 s aun con inferencia/driver bloqueados; terminal y liberación del lease sólo después de parada, sin propuestas tardías.
- Verificación: procesos reales con reloj abreviado y modelo bloqueado; driver que ignora cierre; caída del padre y SIGTERM; confirmar ausencia de hijos/socket/acciones posteriores.
- Dependencias: T07. Alcance: M.
- Archivos: `agent/src/supervisor.ts`, `agent/src/driver.ts`, `agent/src/ipc.ts`, `agent/test/supervisor.test.ts`, `agent/test/fixtures/blocked-process.ts`.

## C2 · Servicio antes de escrituras

- [x] Tarea de lectura completa por `POST /tasks` y consulta de estado: E3 en práctica `respuesta: 45` dos veces (58,7 s/US$0,085 con filtros desde cero; 22,2 s/US$0,028 desde un estado filtrado). Resumen sin secretos.
- [x] Admisión 26–29 ms; parada medida en pruebas con reloj abreviado; exclusión por escritorio y redacción cubiertas por pruebas (64 en total).
- [x] Autorizado por el usuario (14:20): `/__reset` y escrituras en el escritorio de práctica, push a `main` y set oculto sólo con su confirmación. La segunda corrida de E3 partió de filtros previos: no cuenta como corrida desde reset.

## T09 · Crear y editar con verificación (plan B4)

- [x] T09-A (126e858): escritura pendiente en el supervisor (`pendingWrite`). Rechaza otro commit hasta que una propuesta posterior al commit traiga `evidence` visible. `wait` y clics sueltos no cuentan como verificación. Exportar se ejecuta como máximo una vez por tarea. Si el socket cae con una escritura pendiente, la tarea termina `fallida` sin reenvío.
- [ ] T09-B: verificador independiente antes de `finish terminada` (prompt propio, sin historial, modelo de respaldo, ≤1 llamada por tarea). Dos rechazos dan `fallida`.
- [ ] T09-C: E1 y E2 desde reset con harness y `/__check`; E2 ignora la nota de CL-0007. E1 pasa (65 s, US$0,10): buscó el NIT antes de crear, `fill` de 3 campos y evidencia «Cliente CL-0141 creado».
- Aceptación: identidad única y campos autorizados antes de escribir; comprobar efecto posterior; escritura incierta se inspecciona o falla, nunca se reenvía a ciegas.
- Verificación: E1/E2 desde reset con harness; desconexión antes/después de Guardar y nota maliciosa; comprobar cero cambios ajenos y duplicados.
- Dependencias: C2. Alcance: M.
- Archivos: `agent/src/agent/write-policy.ts`, `agent/src/agent/verification.ts`, `agent/src/worker.ts`, `agent/test/writes.test.ts`.

## T10 · Lectura, exportación y fallo por ambigüedad (plan B5)

- [ ] T10-A: observar una vez cómo exporta SIGECOM (descarga, diálogo o mensaje) y luego `/__reset`; ajuste genérico del prompt; E4 exporta una vez con rango y estado exactos.
- [ ] T10-B: E5 termina `fallida`, nombra los dos NIT y no abre la edición.
- [ ] T10-C: E3 desde reset; casos de pregunta con dos datos y pregunta imposible en `test/summary.test.ts`.
- Aceptación: identidad exacta por fila, todas las páginas y fecha de la app; verificar exportación con rango/estado y no duplicarla; resumen correcto y fallo sin elegir homónimo arbitrario.
- Verificación: E3/E4/E5; pregunta con dos datos, pregunta imposible, página repetida y fecha distinta del servidor; no incluir respuestas esperadas en el contexto del worker.
- Dependencias: T09. Alcance: M.
- Archivos: `agent/src/agent/memory.ts`, `agent/src/agent/verification.ts`, `agent/src/summary.ts`, `agent/test/summary.test.ts`, `agent/test/reads.test.ts`.

## T11 · Harness de práctica (plan B1 y B6)

- [x] T11-A: `scripts/practice.ts` (`npm run practice -- E1|…|all [--base URL] [--rounds N]`): reset, envío de sólo `instruccion`, consulta cada 5 s, `/__check`, evaluación aparte del resumen (`scripts/evaluate-summary.ts` con prueba) y fila en `ejecucion.md`.
- [ ] T11-B: tres rondas 5/5 contra el servicio desplegado (C3).
- Aceptación: reset sólo del escritorio de desarrollo; agente recibe exclusivamente `instruccion`; comprobar estado de app con `/__check` y estado/resumen por separado, registrando métricas sin secretos.
- Verificación: prueba del evaluador de resúmenes con casos incorrectos; rondas reales de las cinco pruebas, sin usar resultados como respuestas del agente; guardar fallo/evidencia antes de repetir.
- Dependencias: T10. Alcance: M.
- Archivos: `agent/scripts/practice.ts`, `agent/scripts/evaluate-summary.ts`, `agent/test/harness.test.ts`, `frontier-reto-1/output/audit/ejecucion.md`.

## T12 · Fallos, transferencia y registro de incidente (plan B3 y B7)

- [x] Seguridad y guardrails (126e858): límites RFB ante servidor hostil, SSRF por DNS, timeouts HTTP y freno a la fuerza bruta del token, borrar/exportar sólo si la tarea lo pide, reconexión sin replay, espera adaptativa, reintento/relanzamiento del worker, F5 controlado, reinicio ante errores no capturados. Aprendizaje por app en `app_knowledge`. 77 pruebas.
- [x] Canario de incidentes `npm run canary` y [runbook](../frontier-reto-1/output/audit/incidente-1530.md).

- [ ] T12-A: concurrencia con dos escritorios (práctica y Docker local); reinicio con tarea en curso; corte de WSS a mitad de tarea.
- [ ] T12-B (opcional si falta tiempo): UI alternativa en el escritorio Docker con navegador kiosko.
- [ ] T12-C: línea base antes de las 15:30; a las 15:30 leer el anuncio, reproducirlo y adaptar con prueba antes/después en `incidente-1530.md`.
- Aceptación: otra UI sin cambios en el agente; red/modelo/reinicio/concurrencia sin reenvíos ciegos ni ejecutores huérfanos; registrar incidente y adaptación con prueba antes/después.
- Verificación: inyección controlada de fallos, UI alternativa local y mismas tareas abstractas; a las 15:30 revisar el cambio publicado y reproducir su efecto. No anticipar ni afirmar un incidente aún no observado.
- Dependencias: T11. Alcance: M.
- Archivos: `agent/test/failures.test.ts`, `agent/test/fixtures/alternate-ui.html`, `agent/scripts/transfer.ts`, `frontier-reto-1/output/audit/incidente-1530.md`.

## C3 · Aceptación

- [ ] Tres rondas 5/5 desde reset; cero cambios ajenos, duplicados, secretos y falsos éxitos.
- [ ] Fallos de red/modelo, reinicio, concurrencia y transferencia comprobados; tiempos/costo registrados.
- [ ] Incidente de las 15:30 detectado y adaptación documentada cuando ocurra; revisión de resultados con el usuario.

## T13 · Contenedor y preparación del despliegue

- [x] Preparación inicial: Dockerfile Node 24, contexto limitado sin credenciales; imagen final construida y SQLite comprobado sin red. Servicio Railway `agent / production`, una réplica, volumen `/data` de 500 MB, nueve variables de ejecución y límites guardados. Evidencia en `frontier-reto-1/output/audit/despliegue.md`.
- [x] Credenciales autorizadas aplicadas en Railway; modelo copiado del `.env` local. Doce variables productivas completas.
- [x] T13-A: Dockerfile arranca `dist/main.js`; imagen Node 24 probada: health 401/200, E3 = 45 en 24 s, SIGTERM ordenado y tarea consultable tras reiniciar con volumen. Start command de Railway: vacío (usa el CMD).
- [ ] Agregar en Railway `OPENROUTER_FALLBACK_MODEL=anthropic/claude-haiku-5.5` y `OPENROUTER_COORDS=pixel`.
- [ ] Red saliente: resolver Limited Trial (conectar GitHub en Railway, a cargo del usuario) y comprobar OpenRouter y WSS desde el contenedor.
- Aceptación: build/arranque desde imagen limpia; `PORT` y ruta SQLite configurables; parada conjunta y una réplica, sin datos de práctica ni secretos en imagen.
- Verificación: build y arranque local de contenedor; reinicio con volumen; revisar que `/health` autenticado y la configuración del probe Railway sean compatibles.
- Dependencias: T07, T08. Alcance: M.
- Archivos: `agent/Dockerfile`, `agent/.dockerignore`, `agent/RAILWAY.md`, `agent/README.md`. Configuración mediante dashboard/IaC; Railway ya no admite `railway.json` para servicios nuevos.

## T14 · Despliegue público y comprobación (plan B0 y B8)

- [ ] T14-A: despliegue técnico temprano: dominio con puerto 8080, tres rutas desde internet, E3 real y persistencia tras reinicio.
- [ ] T14-B: desplegar el commit que pasó C3 y repetir las comprobaciones.
- Aceptación: dominio público, variables secretas y SQLite en volumen; las tres rutas verificadas desde internet; ningún driver anterior activo después de redeploy.
- Verificación: health autenticado, tarea de práctica, consulta de estado y reinicio del servicio con estado persistente. No debilitar autenticación para el healthcheck ni iniciar corridas ocultas como prueba de humo.
- Dependencias: T14-A depende de T13-A; T14-B depende de C3. Alcance: S + configuración Railway.
- Archivos: `agent/RAILWAY.md`, `frontier-reto-1/output/audit/despliegue.md`.

## T15 · Reproducibilidad, video y entrega

- [ ] Completar.
- Aceptación: README ejecutable por otra persona; repo público sin secretos; video público ≤2 minutos y entrypoint entregables antes de las 20:00, con servicio disponible hasta el fin del demo day.
- Verificación: seguir README desde checkout limpio; revisar enlaces sin sesión y duración del video; comprobar estado de entrega en portal. Acordar uso de las tres corridas ocultas con un servicio ya verificado.
- Dependencias: T14. Alcance: M + entrega.
- Archivos: `README.md`, `frontier-reto-1/README.md`, `agent/README.md`, `frontier-reto-1/docs/video.md`.
