# Fase 2 · Plan de continuación del Reto 1

Actualizado el 10/10/2026 a las 14:15 (hora de Bogotá). Es el documento de arranque para una sesión nueva: dice qué funciona, qué falta, en qué orden, cómo se verifica cada paso y qué debe autorizar el usuario. El Systems design v3 y la elección **OpenRouter + Railway** siguen vigentes; no se rediseñan.

Horas fijas: **15:30** incidente del evento · **20:00** entrega (repo público, entrypoint y video ≤2 min) · servicio disponible hasta el fin del demo day.

## 1. Arranque de la sesión nueva

1. Leer, en este orden:
   - este plan;
   - [todo.md](todo.md) (estado por tarea);
   - [README del agente](../frontier-reto-1/agent/README.md);
   - [RAILWAY.md](../frontier-reto-1/agent/RAILWAY.md);
   - [benchmark de modelos](../frontier-reto-1/output/audit/benchmark-modelos.md);
   - [contrato del reto](../frontier-reto-1/README.md).
2. Comprobar el entorno:
   ```sh
   cd frontier-reto-1/agent
   npm ci
   npm run check-env   # debe decir ok en servicio, modelo y práctica (no muestra valores)
   npm run typecheck
   npm test            # 64/64; necesita permiso para abrir puertos locales
   ```
3. Pedir al usuario, de una vez, las autorizaciones de la [sección 6](#6-autorizaciones-que-debe-dar-el-usuario).
4. Reglas de la sesión:
   - No consumir corridas ocultas sin acuerdo.
   - No imprimir secretos.
   - Navegar la web con `/browse` de gstack (CLAUDE.md del usuario).
   - Escritorio Docker local: la imagen `reto1-testdesktop` ya existe. `npm run test:local-desktop` la reconstruye y la usa.
   - El servicio local se levanta con `PORT=18080 ALLOW_PRIVATE_DESKTOPS=true npm run dev` y las tareas se envían con `npm run task -- --task "…"`.

## 2. Estado verificado

| Pieza | Estado | Evidencia |
| --- | --- | --- |
| RFB, captura y entradas (T02–T03) | Funciona | Escritorio de práctica: 3.8 + VncAuth, 1280×800, frame completo 1,65 s. Docker local: texto con acentos exacto y clic de 162 ms. En E3 el filtro escrito por el agente aplicó bien |
| Modelo (T04) | Elegido y aprobado | `anthropic/claude-sonnet-5.5`, respaldo `anthropic/claude-haiku-5.5`, `OPENROUTER_COORDS=pixel`. 8/8 clics al píxel; ~4 s por paso. Caché del prompt: ~40% menos costo desde el paso 2 |
| Bucle y memoria (T05) | Funciona | Memoria con resultado observado, avisos de falta de progreso, `fill` multi-campo y espera por tipo de acción (clic ≥1 s) |
| SQLite (T06) | Funciona | Terminal inmutable; un reinicio marca `fallida` sin replay |
| API y admisión (T07) | Funciona en local | Tres rutas con token; admisión 26–29 ms; 409/422/503 sin crear tareas |
| Supervisor y procesos (T08) | Funciona en local | Revoca a 270 s y mata a los hijos antes de 280 s, aun bloqueados. Publica el terminal sólo tras la salida de los hijos. SIGTERM ordenado |
| C1 | Hecho y revisado | Abrir Facturas: 5 pasos, 29,8 s, US$0,058 |
| C2 técnico | Hecho; falta la revisión antes de escribir | E3 = `45` por API: 58,7 s/US$0,085 desde filtros vacíos. La segunda corrida (22 s) partió de filtros previos y no cuenta como corrida desde reset |
| Build de producción | Funciona con `node dist/main.js` | Forkea `dist/driver.js` y `dist/worker.js`. Un escritorio inalcanzable da `fallida` honesta |
| Railway | Preparado, sin desplegar | Servicio `agent / production`, 1 réplica, volumen `/data` de 500 MB, 12 variables. Sin source, dominio ni deployment. Cuenta en **Limited Trial** (red saliente restringida); GitHub sin conectar |
| Git | Nada del agente está commiteado | `frontier-reto-1/agent/`, `tasks/` y la evidencia nueva están sin seguimiento. `taste/` es ajeno: no tocar |

## 3. Qué falta, en orden

| # | Bloque | IDs | Cierra cuando | Tiempo |
| --- | --- | --- | --- | --- |
| B0 | Desbloquear despliegue | T13-A, T14-A | Railway corre `dist/main.js` con dominio público; `/health` con token da 200; una tarea de lectura (E3) funciona por internet | 14:15–15:00 |
| B1 | Harness mínimo | T11-A | `npm run practice -- E1` hace reset, envía sólo `instruccion`, consulta como el evaluador, llama a `/__check` y evalúa el resumen aparte | 14:30–15:00 (en paralelo con la espera de Railway) |
| B2 | Línea base antes del incidente | — | Las 5 pruebas corridas una vez desde reset, con resultado guardado; capturas de las pantallas clave | 15:00–15:30 |
| B3 | Incidente de las 15:30 | T12-C | Síntoma leído en el portal y reproducido; adaptación con prueba antes/después en `incidente-1530.md` | 15:30–16:15 |
| B4 | Escrituras verificadas | T09 | E1 y E2 aceptadas por `/__check`; nota ignorada; sin duplicados; sin falso éxito | 16:15–17:00 |
| B5 | Exportación, homónimos y conteo | T10 | E3, E4 y E5 aceptadas desde reset | 16:15–17:00 (junto con B4) |
| B6 | Aceptación | T11-B, C3 | Tres rondas 5/5 desde reset contra el servicio **desplegado** | 17:00–17:45 |
| B7 | Robustez mínima | T12-A/B | Concurrencia en dos escritorios, reinicio sin replay y desconexión sin reenvío comprobados; transferencia a otra UI si queda tiempo | 17:00–17:45 (en paralelo con B6) |
| B8 | Entrega | T14-B, T15 | Mismo commit aceptado y desplegado; repo público sin secretos; video ≤2 min; tres enlaces registrados en el portal | 17:45–18:45 |
| B9 | Evaluación oculta | — | Corrida acordada con el usuario; fallos analizados; las restantes, sólo tras un cambio comprobado | 18:45–19:30 |
| — | Margen | — | Verificar entrega y disponibilidad. No hacer el primer deploy en esta ventana | 19:30–20:00 |

Los tiempos son presupuestos. Si un bloque se atrasa, se recorta alcance opcional (la transferencia a otra UI y los fallos inyectados de B7), nunca un criterio de aceptación.

### B0 · Desbloquear despliegue (prioridad máxima)

La red de Railway y la publicación del código dependen del usuario. Deben arrancar primero para que la espera ocurra en paralelo con B1.

1. Corregir la entrada a `dist/main.js`:
   - `Dockerfile` (CMD; quitar el comentario «se incorporan en T07/T08»);
   - el start command en Railway;
   - `RAILWAY.md`;
   - la línea 70 del `README.md` del agente.
2. Probar la imagen local completa, Node 24:
   - `docker build -t reto1-agent frontier-reto-1/agent`;
   - `docker run` con `--env-file .env` y un volumen `/data` (escribir el comando exacto en `RAILWAY.md`);
   - `/health` sin token da 401 y con token da 200;
   - E3 contra el escritorio de práctica;
   - `docker stop` debe registrar `service_stopping` y no dejar hijos.
3. Railway:
   - agregar `OPENROUTER_FALLBACK_MODEL=anthropic/claude-haiku-5.5` y `OPENROUTER_COORDS=pixel`;
   - no subir `PRACTICE_*` ni `ALLOW_PRIVATE_DESKTOPS`;
   - sin healthcheck HTTP, por la decisión de la sección 7.
4. Publicar el código. Railway construye desde GitHub (`Manuekle/lab10-hack`, root `/frontier-reto-1/agent`). Antes del commit:
   - `git check-ignore` de `.env`, `.env.example` (contiene credenciales), `.data/` y `.artifacts/`;
   - `git add -n` para revisar qué entra;
   - `grep -rE 'ftr_|sk-or-'` sobre lo staged, que debe salir vacío.

   Commit sólo con autorización. Alternativa sin GitHub: Railway CLI (`npx @railway/cli up` desde `frontier-reto-1/agent`), también con autorización.
5. Red saliente. Limited Trial restringe las conexiones salientes. El usuario conecta GitHub en [Account Settings](https://railway.com/account) para la verificación; luego hay que comprobarlo desde el contenedor: inferencia a OpenRouter y WSS al escritorio, con una tarea E3 real.
6. Dominio público con target port 8080. Comprobar las tres rutas desde fuera: sin token da 401, con token da 200 y 404 para un ID inexistente. Después, reiniciar el servicio y confirmar que la tarea anterior sigue consultable (volumen).

**Contingencia:** si a las 15:15 Railway sigue sin red saliente, el usuario decide entre esperar la verificación, pagar el plan Hobby u otro hosting con contenedor. No dejarlo para después de las 17:45.

### B1 · Harness mínimo (T11-A)

Archivo `agent/scripts/practice.ts` (script `npm run practice -- [E1 … E5|all] [--base URL] [--rounds N]`). Por cada JSON de `pruebas/`:

1. `POST https://<escritorio>/__reset` con `Bearer PRACTICE_DESKTOP_TOKEN`. La URL https se deriva de `PRACTICE_DESKTOP_URL` (de wss a https, sin `/websockify`). Esperar a que `/health` del escritorio responda y dejar 3 s para que el navegador recargue.
2. `POST {base}/tasks` con **sólo** `instruccion`. Consultar `GET /tasks/{id}` cada 5 s hasta el terminal o 300 s, igual que el evaluador.
3. `POST /__check` con el JSON completo de la prueba y guardar `pass` y `checks`.
4. Evaluar el resumen aparte, con `scripts/evaluate-summary.ts` y prueba unitaria:
   - el estado coincide con `estado_esperado`;
   - con `respuesta_esperada`, existe una línea `respuesta:` y su primer número o texto coincide;
   - con `claves_razon`, el resumen contiene cada clave;
   - una tarea `fallida` no lleva línea `respuesta:`;
   - no aparece ningún secreto.
5. Agregar una fila a `frontier-reto-1/output/audit/ejecucion.md`: prueba, ronda, hora, estado, `/__check`, evaluación del resumen, duración, pasos, costo (de los logs del servicio o de los eventos SQLite si es local) y enlace a la evidencia.

Si falla, conservar el resultado antes de corregir. Las expectativas nunca llegan al agente.

### B2 · Línea base antes de las 15:30

- `npm run practice -- all` una vez, local o en Railway si B0 ya cerró.
- `npm run capture` en pantallas clave (Clientes, Facturas, Pedidos), guardadas en `.artifacts/baseline-*` para compararlas después del incidente.
- Commit del estado del código (si está autorizado) para que el antes y el después queden claros.

### B3 · Incidente de las 15:30 (T12-C)

1. Leer el portal ([brief](https://frontier.lab10.ai/evento/reto), [entregas](https://frontier.lab10.ai/evento/reto/entregas)) con `/browse`. Documentar el anuncio literal. No suponerlo antes de verlo.
2. Reproducir:
   - `npm run capture` y comparar con la línea base (versión, etiquetas, menús, tamaño, diálogos, tiempos de repintado);
   - correr las pruebas afectadas.
3. Diagnosticar si el problema está en el driver, la espera, el prompt, el modelo o la política, y cambiar lo mínimo. Prohibido: rutas, coordenadas o textos específicos de SIGECOM en el agente.
4. Prueba antes/después de cada adaptación y nota en `frontier-reto-1/output/audit/incidente-1530.md` (síntoma, diagnóstico, cambio, verificación).

### B4 · Escrituras verificadas (T09)

Hoy el supervisor reconoce los botones de commit por texto y bloquea uno repetido inmediato. Pero cualquier acción intermedia borra esa marca, y `finish terminada` se acepta tal como lo dice el modelo. Esto cambia así:

1. **Escritura pendiente.** Al ejecutar un commit (Guardar, Crear, Exportar, Eliminar…), el supervisor guarda `pendingWrite = {target, frameId}`. Mientras siga pendiente:
   - se rechaza cualquier otro commit;
   - `wait`, `scroll` o un clic cualquiera no cuentan como verificación.

   Se libera cuando el worker declara en una propuesta la evidencia visible del efecto. Agregar al esquema el campo `evidence` (texto requerido: qué se ve que prueba el resultado), y debe basarse en un frame posterior al commit.
2. **Verificador independiente antes del `finish terminada`.** Una llamada aparte con prompt propio, sin historial, sólo con tarea, captura final y resumen propuesto. Responde `{ok, falta}` con el modelo de respaldo.
   - Si niega, se rechaza el `finish` y se devuelve `falta` como resultado del paso.
   - Tras dos rechazos, la tarea termina `fallida`.
   - Debe costar ≤1 llamada por tarea y ~3 s.
3. **Exportación única.** Un commit de tipo exportar se ejecuta como máximo una vez por tarea.
4. **Desconexión.** Si el socket cae con una escritura pendiente, la tarea termina `fallida` sin reenvío y el resumen lo dice. Reconectar sólo para inspeccionar es una mejora opcional de B7.
5. Pruebas unitarias en `test/writes.test.ts` (commit pendiente, `evidence` vacía, verificador que niega, exportar dos veces). Pruebas reales: E1 y E2 desde reset; E2 ignora la nota de CL-0007 que ordena borrar pedidos.

Archivos: `src/supervisor.ts` (o un `src/agent/write-policy.ts` extraído), `src/model/actions.ts` (campo `evidence`), `src/agent/verification.ts` (verificador), `src/agent/prompt.ts`.

### B5 · Exportación, homónimos y conteo (T10)

- **E4:** antes de cambiar código, ver una vez cómo exporta SIGECOM. Puede ser una descarga, un diálogo del navegador kiosko o un mensaje. Luego `/__reset`. Ajustar el prompt de forma genérica: aplicar filtros, verificarlos en pantalla, exportar una vez y verificar la evidencia. El rango de fechas debe quedar exacto (`2026-09-01` a `2026-09-30`), escrito en el formato que muestre la app.
- **E5:** debe terminar `fallida`, nombrar `52345678` y `1019876543` y no abrir el formulario de edición. Si elige una de las dos, reforzar el prompt y agregar al verificador la pregunta «¿hay más de un candidato?».
- **E3 desde reset:** repetir. Sumar los casos de la pregunta con dos datos y de la pregunta imposible (sin línea `respuesta:`) a `test/summary.test.ts`, que ya cubre el formato.

### B6 · Aceptación (T11-B, C3)

- Tres rondas `npm run practice -- all --rounds 3 --base https://<railway>`, cada prueba desde reset.
- Criterio: 5/5 por ronda, `/__check` con `pass: true`, estado y resumen correctos, sin secretos.
- Registrar duración y costo por tarea. Si una ronda falla: guardar la evidencia, corregir, volver a desplegar y reiniciar el conteo de rondas.

### B7 · Robustez mínima (T12-A/B)

| Prueba | Cómo | Cierra cuando |
| --- | --- | --- |
| Concurrencia | Servicio local: una tarea en el escritorio de práctica y otra en el Docker local a la vez. Un segundo POST al mismo escritorio da 409 | Dos terminales correctos; ningún escritorio con dos ejecutores |
| Reinicio | `docker restart` con una tarea en curso, en la imagen local con volumen | Esa tarea queda `fallida` con el resumen de reinicio; no hay replay ni hijos huérfanos |
| Desconexión | Cortar el WSS durante un paso (detener el contenedor local a mitad de una tarea) | `fallida` sin reenvío, antes de 280 s |
| Modelo bloqueado o JSON inválido | Ya cubierto con dobles (`test/model.test.ts`, `test/supervisor.test.ts`) | Basta citar la evidencia |
| Transferencia (opcional) | Página HTML alternativa (`test/fixtures/alternate-ui.html`) con otras etiquetas y menús, servida en el escritorio Docker con un navegador kiosko (agregar `chromium` a la imagen) | Las mismas tareas abstractas funcionan sin cambiar el agente |

### B8 · Entrega (T14-B, T15)

- Desplegar el commit que pasó B6 y comprobar las tres rutas y una tarea por internet.
- README raíz y del agente: reproducibles desde un checkout limpio (Node 24+, `npm ci`, `.env.template`, `npm test`, Docker, variables de Railway). Explicar la decisión del healthcheck.
- Revisión de secretos en todo el repo antes de hacerlo público: `git grep -nE 'ftr_|sk-or-|PASSWORD=.+'`, que debe salir vacío fuera de las plantillas.
- Video ≤2 min con resultados ya verificados. Guion en `frontier-reto-1/docs/video.md`: problema, arquitectura, una tarea real (E2 con la nota ignorada o E3) y los números de aceptación. El usuario lo graba y lo publica.
- El usuario registra en el portal el repo, el entrypoint y el video. Enviar un formulario requiere su confirmación explícita.

### B9 · Evaluación oculta

- Comprobar en el portal cuántas corridas quedan (eran 0/3 usadas).
- Lanzar una sólo con el entrypoint verificado y con acuerdo del usuario. Analizar los fallos sin ajustar a esa app concreta; la siguiente corrida, sólo después de un cambio comprobado en práctica.

## 4. Lo que se mide

- Por tarea: duración, pasos, costo, rechazos del supervisor, `driverKilled` (en los logs `task_finished` y los eventos SQLite).
- Referencias actuales: ~5,6 s por paso, ~45 pasos posibles en 260 s, tope `MAX_PROPOSALS=40`. E3 costó entre US$0,03 y US$0,09.
- Costo: el día tenía US$45 en OpenRouter (US$5 reservados para la evaluación). Tres rondas de 5 tareas cuestan ≈US$1–2.

## 5. Criterios de aceptación (sin cambios)

- `GET /health`, `POST /tasks` y `GET /tasks/{task_id}` exigen el token del equipo. La admisión tarda menos de 2 s y no espera VNC ni modelo.
- El terminal se publica sólo tras detener worker y driver. No hay acciones después del terminal ni después del corte.
- E1: un cliente con los valores exactos.
- E2: sólo cambia la dirección y se ignora la nota.
- E3: identidad exacta por fila y todas las páginas.
- E4: rango y estado exactos, una sola exportación.
- E5: `fallida`, sin edición, con los dos NIT.
- Preguntas: línea `respuesta: <valor>`, con el número primero; dos datos van separados por `;` y en orden. Una pregunta imposible termina `fallida` sin esa línea. Ningún secreto en el resumen.
- Tres rondas 5/5 desde reset, sin cambios ajenos, duplicados ni falsos éxitos. Reportar lo medido separado de los objetivos: la práctica no garantiza el set oculto.

## 6. Autorizaciones que debe dar el usuario

| Acción | Para qué | Bloque |
| --- | --- | --- |
| Usar `/__reset` y permitir escrituras en el escritorio de práctica | E1, E2, E4 y rondas | B1–B6 (cierra la revisión pendiente de C2) |
| Commit y push del agente a `Manuekle/lab10-hack` (repo público) | Source de Railway y entrega | B0, B8 |
| Conectar GitHub en Railway (verificación de la cuenta) o decidir otra ruta para la red saliente | Que el contenedor llegue a OpenRouter y al escritorio | B0 |
| Cambios en Railway: start command, variables, dominio, deploy | Entrypoint público | B0, B8 |
| Enviar el formulario de entregas del portal | Registro de los enlaces | B8 |
| Lanzar cada corrida oculta | Evaluación | B9 |

## 7. Decisiones vigentes

1. TypeScript/Node.js en `frontier-reto-1/agent/`, sin dependencias nativas. El sitio del Systems design sigue en la raíz.
2. Driver RFB propio. Ninguna herramienta externa opera la app. Sólo capturas y entradas RFB, sin DOM, APIs internas ni archivos de la app.
3. Supervisor, worker y driver en procesos separados. El worker no tiene socket ni credenciales del escritorio, y los hijos no heredan el entorno del servicio.
4. Un contenedor, una réplica y SQLite en el volumen `/data`. Credenciales de tarea sólo en RAM; sin replay tras reiniciar.
5. Modelo: Sonnet 5.5 principal, Haiku 5.5 de respaldo (tras timeout, red, 429 o 5xx), coordenadas en píxeles. Jev queda fuera: sólo acepta texto.
6. Se usa siempre el escritorio que llega en `POST /tasks`. Las expectativas de `pruebas/` y los datos de la auditoría pertenecen sólo al harness.
7. **Healthcheck:** sin probe HTTP de Railway en el primer despliegue. `/health` se comprueba con Bearer desde el harness antes de entregar y después de cada deploy. No se quita la autenticación del contrato; un endpoint técnico sin token sería un cambio aparte y explícito.

## 8. Riesgos

| Riesgo | Tratamiento |
| --- | --- |
| Limited Trial bloquea la red saliente de Railway | B0 primero; contingencia decidida a las 15:15 |
| Arranque roto en el contenedor (`dist/server.js`) | Primer paso de B0; probar la imagen completa antes de desplegar |
| Falso éxito en escrituras | `pendingWrite`, `evidence` y verificador independiente (B4) |
| Exportación o escritura duplicada | Commit pendiente, exportación única y `/__check` de duplicados |
| El incidente cambia la UI o los tiempos | Línea base antes de las 15:30; adaptación genérica con prueba antes/después |
| Se publica un secreto al abrir el repo | `.env` y `.env.example` ignorados; revisión con grep antes de cada push |
| Desconexión a mitad de una escritura | Terminar `fallida` sin reenvío; reconectar sólo para inspeccionar (opcional) |
| Corridas ocultas gastadas en depurar | Sólo con entrypoint verificado y acuerdo del usuario |
| Primer deploy tarde | Ningún primer deploy después de las 17:45; margen 19:30–20:00 sólo para verificar |

## 9. Referencias

- [Systems design v3](../frontier-reto-1/docs/superpowers/specs/2026-10-10-reto1-design.md) · [auditoría de SIGECOM](../frontier-reto-1/output/audit/auditoria-sigecom.md) · [preparación del despliegue](../frontier-reto-1/output/audit/despliegue.md)
- Portal: [brief](https://frontier.lab10.ai/evento/reto), [rúbrica](https://frontier.lab10.ai/evento/reto/rubrica), [entregas](https://frontier.lab10.ai/evento/reto/entregas), [herramientas](https://frontier.lab10.ai/evento/herramientas)
- [RFC 6143](https://www.rfc-editor.org/rfc/rfc6143) · [salida estructurada de OpenRouter](https://openrouter.ai/docs/guides/features/structured-outputs) · [volúmenes de Railway](https://docs.railway.com/volumes) · [healthchecks de Railway](https://docs.railway.com/deployments/healthchecks) · [trial de Railway](https://docs.railway.com/pricing/free-trial)
