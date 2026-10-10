# Entorno Railway · Reto 1

Preparación del 10 de octubre de 2026. Esta infraestructura no significa que el agente ya esté listo: faltan servidor HTTP, supervisor y aceptación del modelo con benchmark. No publicar `/health` como listo sin esos componentes.

[Proyecto Railway](https://railway.com/project/fd637759-c5d9-4ed8-a0d3-c01a0ffac4d6?environmentId=177dbabd-dcd7-4be5-a3f3-94ea49bc78e6). Servicio y configuración guardados, doce variables productivas y volumen `agent-volume` de 500 MB montado en `/data`, en US East (Virginia). Una réplica; serverless desactivado. El servicio muestra «There is no active deployment» porque aún no tiene código conectado.

Las credenciales `TEAM_TOKEN` y `OPENROUTER_API_KEY` del `.env` local quedaron aplicadas en Railway con autorización del usuario. `OPENROUTER_MODEL=anthropic/claude-sonnet-5.5` se copió de ese mismo archivo; su aceptación depende del benchmark. No hay dominio público generado todavía.

## Configuración del servicio

| Ajuste | Valor |
| --- | --- |
| Proyecto | `frontier-reto1` |
| Servicio | `agent` |
| Entorno | `production` |
| Repositorio previsto | `Manuekle/lab10-hack` |
| Root directory | `/frontier-reto-1/agent` |
| Builder | Dockerfile de esa carpeta |
| Start command | `node dist/main.js` (o vacío: usa el CMD del Dockerfile) |
| Réplicas | 1, en una región |
| Volumen | `/data` para SQLite |
| Restart policy | On failure; máximo 3 reintentos |
| Serverless / sleep | Desactivado durante evaluación y demo day |
| Overlap de deploys | 0 segundos |
| Grace period tras SIGTERM | 10 segundos |

El Dockerfile no recibe credenciales como argumentos de build. `.dockerignore` permite sólo fuente, manifiestos y configuración TypeScript. El runtime utiliza Node 24 y dependencias productivas, sin pruebas ni artefactos del escritorio.

El arranque es `node dist/main.js`: abre el puerto, marca como fallidas las tareas abiertas en SQLite y lanza `dist/worker.js` y `dist/driver.js` como procesos hijos. `dist/server.js` sólo exporta el handler HTTP. La imagen usa Node 24.

## Variables productivas

| Variable | Valor o procedencia |
| --- | --- |
| `NODE_ENV` | `production` |
| `PORT` | `8080`, respetar este valor en el servidor y el target port |
| `DATABASE_PATH` | `/data/agent.db` |
| `TEAM_TOKEN` | Token del entrypoint de Manuel; obtener del `.env` local |
| `OPENROUTER_API_KEY` | Key del `.env` local |
| `OPENROUTER_MODEL` | `anthropic/claude-sonnet-5.5` (elegido por benchmark) |
| `OPENROUTER_FALLBACK_MODEL` | `anthropic/claude-haiku-5.5` |
| `OPENROUTER_COORDS` | `pixel` |
| `TASK_REVOKE_MS` | `270000` |
| `TASK_HARD_STOP_MS` | `280000` |
| `INFERENCE_TIMEOUT_MS` | `20000` |
| `INFERENCE_ATTEMPTS` | `2` |
| `MAX_PROPOSALS` | `40` |
| `MAX_ACTIVE_TASKS` | `2` |

Las variables `PRACTICE_*` no se suben al servicio: sólo las usan los scripts de desarrollo. El agente recibe la URL y contraseña del escritorio en cada `POST /tasks`.

## Healthcheck y reemplazo

`/health` requiere el token del equipo por el contrato del reto. No usarlo como probe público sin autenticación ni incluir el token en la URL. Mantener sin configurar el healthcheck HTTP de Railway hasta resolver un probe interno compatible con el servidor. La comprobación de aceptación será una llamada autenticada a `/health` desde internet.

El volumen obliga a verificar el reemplazo de un despliegue: comprobar que el proceso anterior y todos sus ejecutores mueren antes de aceptar tareas en el siguiente. SQLite se abre y prepara al arrancar, con `/data` ya montado; no migrar el volumen en build ni pre-deploy.

## Acceso a red

El dashboard confirma Limited Trial. Railway restringe conexiones salientes en esa modalidad. Antes del despliegue útil, revisar la verificación de la cuenta y comprobar HTTPS a OpenRouter y WSS al escritorio desde el contenedor. La preparación no demuestra todavía conectividad externa. Railway permite iniciar la verificación vinculando GitHub; cualquier autorización adicional de repositorios se revisa antes de concederla.

La cuenta muestra GitHub sin conectar. Ruta gratuita disponible: [Account Settings](https://railway.com/account) → Account Integrations → GitHub → Connect. La conexión queda pendiente de autorización del usuario; esta preparación no concede permisos sobre GitHub.

## Comprobaciones antes de publicar el entrypoint

- Build y pruebas locales pasan. Etapa Docker `build` comprobada; arranque de runtime cuando esté implementado el servidor.
- Modelo seleccionado y variables productivas completas. DNS/conexión WSS a escritorios públicos e inferencia a OpenRouter comprobados desde Railway.
- Volumen montado, escritura SQLite y persistencia tras reinicio verificadas. Tareas interrumpidas fallan sin replay.
- `GET /health` autenticado responde 200; rutas sin token rechazan. `POST /tasks` admite en menos de dos segundos y el supervisor detiene acciones antes del corte.
- La URL pública corresponde al servicio del agente; no a GitHub Pages ni al escritorio de práctica.

## Fuentes

- [Monorepos](https://docs.railway.com/deployments/monorepo): root directory del servicio.
- [Dockerfiles](https://docs.railway.com/builds/dockerfiles): detección del Dockerfile dentro del source directory.
- [Volúmenes](https://docs.railway.com/volumes): montaje al arrancar, no durante build o pre-deploy.
- [Healthchecks](https://docs.railway.com/deployments/healthchecks): probe HTTP al desplegar.
- [Infraestructura como código](https://docs.railway.com/infrastructure-as-code): para servicios nuevos la configuración se hace en el dashboard o IaC; `railway.json` pertenece al sistema anterior. No se añade una configuración legacy al servicio nuevo.
- [Trial de Railway](https://docs.railway.com/pricing/free-trial): la modalidad Limited Trial tiene restricciones de red saliente.
