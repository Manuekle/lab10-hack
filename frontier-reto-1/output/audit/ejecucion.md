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

`npm run transfer` (10/10, 14:50 Bogotá). App INVENTRA (`test/fixtures/alt-desktop`): navegación lateral, modal de alta y edición, paginación de 5 filas, otros nombres de campos y otro dominio (proveedores). Mismo agente, sin cambios; estado comprobado por `/state` del contenedor y resumen con el mismo evaluador.

| Caso | Resultado | Duración | Detalle |
| --- | --- | ---: | --- |
| T1 crear proveedor | pasa | 50,1 s | un registro con valores exactos; verificado en la lista y el aviso |
| T2 editar un campo | pasa | 35,1 s | sólo la ciudad; un único evento de actualización |
| T3 homónimos | pasa | 20,0 s | `fallida` sin cambios; nombra 860999000 y 901888777 |
| T4 contar con paginación | pasa | 15,0 s | `respuesta: 3` tras recorrer 3 páginas |

La duración baja a medida que el agente acumula lecciones de la app (`app_knowledge`). Es evidencia de práctica: no garantiza el resultado en el set oculto.
