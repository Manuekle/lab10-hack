# Ejecución de las pruebas de práctica

Cada fila es una tarea desde `/__reset`, enviada al servicio con sólo `instruccion` y comprobada con `/__check` (estado de la app) y con el evaluador de resúmenes (estado y resumen). Generado por `npm run practice`.

| Hora (UTC) | Servicio | Ronda | Prueba | App (`/__check`) | Resumen | Estado | Duración | Admisión | Detalle |
| --- | --- | ---: | --- | --- | --- | --- | ---: | ---: | --- |
| 2026-10-10T19:33:23 | local | 1 | E1 | pasa | ok | terminada | 65.1 s | 26 ms | ok |
| 2026-10-10T19:34:20 | local | 1 | E2 | pasa | ok | terminada | 50.1 s | 4 ms | ok |
| 2026-10-10T19:35:28 | local | 1 | E3 | pasa | ok | terminada | 60.1 s | 5 ms | ok |
| 2026-10-10T19:36:30 | local | 1 | E4 | pasa | ok | terminada | 55.1 s | 10 ms | ok |
| 2026-10-10T19:37:13 | local | 1 | E5 | pasa | ok | fallida | 35.0 s | 5 ms | ok |

## Transferencia a una app no vista

`npm run transfer` (10/10, 14:43 Bogotá). App INVENTRA (`test/fixtures/alt-desktop`): navegación lateral, modal de alta y edición, paginación de 5 filas, otros nombres de campos y otro dominio (proveedores). Mismo agente, sin cambios; estado comprobado por `/state` del contenedor y resumen con el mismo evaluador.

| Caso | Resultado | Duración | Detalle |
| --- | --- | ---: | --- |
| T1 crear proveedor | pasa | 50,1 s | un registro con valores exactos; verificado en la lista y el aviso |
| T2 editar un campo | pasa | 35,1 s | sólo la ciudad; un único evento de actualización |
| T3 homónimos | pasa | 20,0 s | `fallida` sin cambios; nombra 860999000 y 901888777 |
| T4 contar con paginación | pasa | 15,0 s | `respuesta: 3` tras recorrer 3 páginas |

La duración baja a medida que el agente acumula lecciones de la app (`app_knowledge`). Es evidencia de práctica: no garantiza el resultado en el set oculto.
| 2026-10-10T19:51:48 | agent-production-2577.up.railway.app | 1 | E5 | pasa | ok | fallida | 32.4 s | 331 ms | ok |
| 2026-10-10T19:53:31 | agent-production-2577.up.railway.app | 1 | E1 | pasa | ok | terminada | 69.9 s | 485 ms | ok |
| 2026-10-10T19:54:28 | agent-production-2577.up.railway.app | 1 | E2 | pasa | ok | terminada | 48.8 s | 616 ms | ok |
| 2026-10-10T19:55:24 | agent-production-2577.up.railway.app | 1 | E3 | pasa | ok | terminada | 48.6 s | 345 ms | ok |
| 2026-10-10T19:56:25 | agent-production-2577.up.railway.app | 1 | E4 | pasa | ok | terminada | 54.4 s | 534 ms | ok |
| 2026-10-10T19:57:06 | agent-production-2577.up.railway.app | 1 | E5 | pasa | ok | fallida | 32.8 s | 627 ms | ok |
| 2026-10-10T19:58:13 | agent-production-2577.up.railway.app | 2 | E1 | pasa | ok | terminada | 60.1 s | 762 ms | ok |
| 2026-10-10T19:59:14 | agent-production-2577.up.railway.app | 2 | E2 | pasa | ok | terminada | 54.2 s | 345 ms | ok |
| 2026-10-10T20:00:16 | agent-production-2577.up.railway.app | 2 | E3 | pasa | ok | terminada | 54.2 s | 451 ms | ok |
| 2026-10-10T20:01:18 | agent-production-2577.up.railway.app | 2 | E4 | pasa | ok | terminada | 54.4 s | 534 ms | ok |
| 2026-10-10T20:02:03 | agent-production-2577.up.railway.app | 2 | E5 | pasa | ok | fallida | 38.0 s | 333 ms | ok |
| 2026-10-10T20:05:11 | agent-production-2577.up.railway.app | 1 | E5 | pasa | ok | fallida | 42.6 s | 313 ms | ok |
| 2026-10-10T20:13:17 | agent-production-2577.up.railway.app | 1 | E2 | pasa | ok | terminada | 54.1 s | 511 ms | ok |
| 2026-10-10T20:23:49 | local | 1 | E1 | pasa | ok | terminada | 140.3 s | 34 ms | ok |
| 2026-10-10T20:25:38 | local | 1 | E3 | pasa | ok | terminada | 100.2 s | 10 ms | ok |
| 2026-10-10T20:43:01 | agent-production-2577.up.railway.app | 1 | E5 | pasa | ok | fallida | 27.1 s | 325 ms | ok |
| 2026-10-10T20:58:23 | local | 1 | E1 | pasa | ok | terminada | 90.1 s | 27 ms | ok |
| 2026-10-10T20:59:26 | local | 1 | E2 | pasa | ok | terminada | 55.1 s | 8 ms | ok |
| 2026-10-10T21:00:33 | local | 1 | E3 | pasa | ok | terminada | 60.1 s | 7 ms | ok |
| 2026-10-10T21:01:46 | local | 1 | E4 | pasa | ok | terminada | 65.1 s | 4 ms | ok |
| 2026-10-10T21:02:39 | local | 1 | E5 | pasa | ok | fallida | 45.1 s | 4 ms | ok |
| 2026-10-10T21:38:33 | local | 1 | E1 | pasa | ok | terminada | 100.3 s | 18 ms | ok |
| 2026-10-10T21:40:16 | local | 1 | E2 | pasa | ok | terminada | 95.2 s | 8 ms | ok |
| 2026-10-10T21:41:38 | local | 1 | E3 | pasa | ok | terminada | 75.1 s | 4 ms | ok |
| 2026-10-10T21:42:45 | local | 1 | E4 | pasa | ok | terminada | 60.1 s | 7 ms | ok |
| 2026-10-10T21:43:38 | local | 1 | E5 | pasa | ok | fallida | 45.1 s | 10 ms | ok |
