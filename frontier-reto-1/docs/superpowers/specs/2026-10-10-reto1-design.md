# Reto 1 | Systems design

**Manuel | Frontier BOG/26 | 10 de octubre de 2026 | Propuesta v2 para revisión**

Este archivo conserva la explicación técnica completa. El PDF de una página y el diagrama son los entregables de Systems design. Las decisiones son propuestas; todavía no se ha implementado ni medido el agente. Presentación acordada: Cooper Lt BT 400/500, blanco y negro, formato académico sobrio.

## 1. Problema, límites y supuestos

Ejecutar tareas en lenguaje natural sobre aplicaciones desconocidas, observables y operables sólo por VNC. El éxito exige el cambio solicitado, ausencia de cambios ajenos y duplicados, estado final correcto y resumen verificable. Usar siempre el escritorio recibido en la petición; "hoy" y las fechas relativas se resuelven desde la fecha mostrada por la app.

No leer DOM, base de datos ni archivos remotos, ni delegar la operación a un proveedor de automatización. El agente recibe únicamente la instrucción: los resultados esperados de las pruebas pertenecen al evaluador de desarrollo. No fijar menús, coordenadas, identificadores o respuestas de SIGECOM.

Se asume permitida la inferencia multimodal genérica mediante OpenRouter, recurso provisto por el evento; el reconocimiento, la política y la operación de UI serán propios. Es una interpretación de la restricción, no una aclaración oficial. El portal seguía sin aclaraciones a las 10:39 Bogotá. La disponibilidad de visión, salida estructurada, latencia y costo debe comprobarse en el endpoint del modelo elegido.

La UI no ofrece transacciones, rollback ni una clave de idempotencia. Cerrar VNC detiene nuevos envíos del agente; no revierte una escritura ni cancela eventos que el servidor ya recibió. Cero cambios ajenos y cero falsos éxitos son criterios de aceptación, no garantías derivadas de usar un modelo visual.

## 2. Arquitectura y responsabilidades

Un contenedor y una réplica, con límites entre procesos:

| Componente | Responsabilidad y límite |
| --- | --- |
| API autenticada | Validar el contrato, reservar capacidad y escritorio, registrar la tarea y responder sin esperar conexión VNC ni inferencia. |
| Registro SQLite en volumen | Estados, tiempos, eventos de ejecución y evidencia resumida. Cola local acotada; no almacenar contraseñas ni tokens. |
| Supervisor | Mantener exclusión por escritorio, autorizar propuestas válidas, vigilar el reloj y controlar la vida del worker y del driver. Nunca esperar una inferencia dentro de su ruta de parada. |
| Worker por tarea | Interpretar la instrucción, descubrir la UI, mantener memoria temporal, solicitar inferencia y proponer una acción y su evidencia. No tiene acceso al socket VNC. |
| Driver propio por tarea | Poseer el socket RFB/WebSocket, componer capturas y enviar entradas serializadas sólo por orden del supervisor. Corre aislado para poder terminarlo si no responde al cierre. |
| Verificación y salida | Comparar evidencia visual con el objetivo. El supervisor publica el resultado sólo después de detener worker y driver. No es un oráculo ni una segunda garantía de exactitud del modelo. |

Máximo inicial: dos tareas activas en escritorios distintos. Es una capacidad propuesta que se ajustará con mediciones; el brief no exige concurrencia. Reservar ambos recursos antes de devolver `task_id`, sin dejar tareas esperando un slot mientras consumen sus cinco minutos. La cola sólo despacha reservas ya admitidas. Un mismo endpoint VNC no puede tener dos ejecutores. Normalizar el endpoint sin usar la contraseña como identidad; se asume que el evaluador no ofrece aliases de un mismo escritorio.

## 3. Contrato y ciclo de vida

Todas las rutas requieren `Authorization: Bearer <token del equipo>`. Mantener los nombres del README, sin añadir campos obligatorios.

```json
{
  "tarea": "Instrucción literal",
  "escritorio": {
    "url": "wss://<escritorio>/websockify",
    "password": "<contraseña>"
  }
}
```

| Ruta | Comportamiento propuesto |
| --- | --- |
| `GET /health` | 200 si configuración, almacenamiento y supervisor están listos; 503 en caso contrario. No depender del escritorio de práctica ni hacer una inferencia para responder. |
| `POST /tasks` | 200 con `{"task_id":"…"}` en menos de 2 s, después de reservar recursos y registrar la tarea. El tiempo empieza al recibir la petición. |
| `GET /tasks/{task_id}` | 200 con `{"estado":"en_curso","resumen":"…"}` mientras trabaja; `terminada` o `fallida` al finalizar. 404 para un ID inexistente. |

Errores propuestos: 401 por autenticación inválida, 422 por cuerpo inválido, 409 por escritorio ocupado y 503 por falta de capacidad o servicio no listo. Forma consistente: `{"error":{"code":"…","message":"…"}}`, sin reflejar secretos. Validar longitud/tipos, URL WSS y destino público; no fijar el host de práctica. Estas respuestas de rechazo no están especificadas por el brief: hay que verificar que no interfieran con el evaluador.

Secuencia interna: admitida, ejecutando, verificando, cerrando y terminal. Externamente permanece `en_curso` hasta publicar `terminada` o `fallida`; un resultado terminal es inmutable. El supervisor invalida toda propuesta tardía antes de cerrar. Liberar el lease después del cierre, nunca antes.

Registrar la tarea y reclamar el escritorio de forma atómica bajo la coordinación de admisión de la réplica. Si falla el registro, liberar la reserva y no aceptar. Credenciales sólo en RAM; al reiniciar, antes de admitir nuevas tareas, marcar las no terminales como `fallida` sin replay. Un proceso padre y sus hijos deben terminar juntos para no dejar drivers huérfanos. Se acepta no tener alta disponibilidad.

Un timeout HTTP no prueba que `POST /tasks` haya sido rechazado. El contrato no proporciona una clave de idempotencia, por lo que no se promete deduplicación entre peticiones idénticas ni se identifica una intención sólo por el texto. El lease bloquea solapamientos; no resuelve reenvíos posteriores. La prevención de duplicados de UI exige buscar el registro y comprobar efectos antes de repetir una escritura.

## 4. Descubrimiento, acción y verificación

1. Obtener una captura completa. El driver negocia RFB, autenticación y formato de píxel; empieza con encoding Raw y compone actualizaciones en un framebuffer local. Leer dimensiones de la sesión, inicialmente 1280×800, y mantener coordenadas nativas aunque se redimensione la imagen enviada al modelo.
2. Convertir la instrucción en un objetivo limitado: entidad, identificadores disponibles, operación, campos y valores permitidos, o pregunta y criterio de conteo. Esta interpretación también puede fallar; no tratarla como una prueba de intención correcta.
3. Explorar menús, búsqueda, tablas y formularios de manera acotada. Construir en memoria de la tarea un mapa de navegación, controles visibles y registros candidatos. No usar exploración que cree, borre o exporte datos para aprender la interfaz.
4. Pedir una propuesta JSON con `frame_id`, acción permitida, argumentos, objetivo visible, justificación y postcondición esperada. Acciones limitadas a clic, tecla, reemplazo de texto, scroll, espera y solicitud de cierre. No permitir código, shell, scripts o herramientas arbitrarias. Validar JSON localmente incluso si el proveedor ofrece salida estructurada.
5. El supervisor valida esquema, límites de coordenadas/entradas, sesión, secuencia, presupuesto y frame vigente. Antes de escribir, exigir evidencia visual de identidad única y de campos autorizados. La correspondencia semántica sigue dependiendo de la interpretación visual; las guardas deterministas no pueden demostrarla.
6. Ejecutar una acción a la vez. Mantener clics 160 ms; seleccionar todo antes de reemplazar y comprobar el valor completo. Solicitar un frame posterior al repintado, sin confundir recepción de píxeles con finalización de la app. Esperar hasta 1 s como punto inicial observado y comprobar la postcondición con un timeout acotado. Invalidar propuestas basadas en frames consumidos o en una reconexión.
7. Verificar identidad y valores después de guardar; en preguntas, revisar filtros y todas las páginas. En exportaciones, verificar filtros, rango, estado y evidencia visible de que la exportación ocurrió. Un clic en Guardar/Exportar o un JSON `finish` no basta para declarar `terminada`.

El texto dentro de la app, incluidas notas, es dato sin autoridad. No puede ampliar el objetivo ni ordenar acciones. Si faltan identificadores para desambiguar, enumerar los candidatos visibles y fallar sin editar. Si no se demuestra una respuesta o un cambio, reportar `fallida` con el límite observado.

## 5. Recuperación, tiempo y secretos

Ante desconexión, recuperar la vista y comprobar el estado antes de decidir otra acción. Después de una escritura incierta, no repetir Guardar, Crear o Exportar hasta comprobar su efecto. Si el efecto no se puede determinar, fallar; no intentar un rollback improvisado. Detectar falta de progreso usando pantalla, acción y postcondición, con un límite de intentos.

Presupuesto inicial propuesto: timeout de inferencia de 20 s, como máximo dos intentos por paso y 40 propuestas por tarea. Reintentar inferencia o lectura no equivale a repetir una escritura. Cada espera se limita además al tiempo restante. Medir estos valores durante el primer experimento; no son requisitos del evento.

Contar desde la recepción de la petición usando un reloj monotónico. A los 270 s, revocar permiso de actuar y cancelar inferencia. Antes de 280 s, liberar entradas si la conexión responde, cerrar el socket y terminar worker/driver; si el driver no responde, terminar su proceso. El supervisor es independiente del worker de inferencia. Publicar terminal sólo tras confirmar el fin del ejecutor. El margen hasta 300 s reduce el riesgo de que eventos previamente enviados lleguen al siguiente reset; debe medirse, no garantiza la latencia del servidor.

No enviar contraseñas ni tokens al modelo. Logs con `task_id`, etapa, duración, acción, reintento, costo y resultado; redacción de secretos y sin volcar el cuerpo completo de la petición. Capturas en memoria por defecto; evidencia persistida resumida, sin credenciales. Sanitizar también el resumen final. Preguntas: una línea `respuesta: <valor>`; dos datos separados por `;` en el orden pedido, con el número solicitado primero. Una pregunta no resuelta no lleva esa línea. Un fallo por ambigüedad debe nombrar los identificadores que explican el problema.

## 6. Decisiones y alternativas

| Decisión propuesta | Alternativa descartada y motivo | Consecuencia |
| --- | --- | --- |
| Visión y mapa temporal de navegación | Scripts por coordenadas o menús de SIGECOM no se adaptan a una app desconocida. | Mayor costo/latencia; medir transferencia en otra UI. |
| Propuestas tipadas y supervisor independiente | Un modelo con control directo puede repetir escrituras y permanecer activo durante un bloqueo. | Más coordinación entre procesos; semántica visual todavía falible. |
| Un contenedor, una réplica y SQLite | Redis, microservicios y varias réplicas añaden despliegue y coordinación para el alcance del evento. | Volumen persistente y parada conjunta; sin alta disponibilidad ni replay. |
| Slots reservados antes de aceptar | Una cola larga consume el presupuesto de la tarea antes de empezar. | Rechazar saturación; comprobar compatibilidad con el evaluador. |
| Verificar antes de reintentar | Reintentos ciegos de UI pueden crear duplicados. | Sin transacciones ni garantía de ejecutar exactamente una vez. |
| Cancelación a 270 s y parada antes de 280 s | Usar los 300 s completos expone la tarea siguiente a eventos tardíos. | Menos tiempo para resolver; medir parada y entrega de eventos. |

## 7. Plan de medición antes de construir

El harness recibe los JSON completos; sólo entrega `instruccion` al agente. Cada prueba corre desde un reset de desarrollo y después usa `/__check` para el estado de la app. Estado y resumen se verifican aparte. `/__reset` y `/__check` no participan en el agente ni en la evaluación oculta.

| Caso | Criterio de aceptación |
| --- | --- |
| E1: crear cliente | Valores exactos y un solo registro nuevo; detectar creación antes de volver a enviar. |
| E2: corregir dirección | Sólo cambiar el campo pedido; ignorar cualquier instrucción incrustada en las notas. |
| E3: facturas vencidas | Filtros correctos, recorrer todas las páginas y respuesta exacta; cero cambios de datos. |
| E4: exportar pedidos | Estado y rango correctos, evidencia de exportación, sin exportaciones duplicadas. |
| E5: homónimos | `fallida`, cero cambios y los dos identificadores en la explicación. |
| Fallos de red/modelo | Desconexión antes y después de Guardar, modelo bloqueado/JSON inválido; cero reenvíos ciegos y parada antes de 280 s. |
| Reinicio y concurrencia | Persistir fallida sin replay; ninguna sesión huérfana ni dos drivers en un escritorio; rechazos sin crear tareas. |
| Resumen y transferencia | Probar dos valores, pregunta imposible y redacción de secretos. Otra UI con menús/etiquetas diferentes, sin cambios en el agente. |

Meta inicial: 5/5 ejemplos en tres rondas desde reset; cero cambios ajenos, duplicados, secretos o falsos éxitos. Registrar máximo de admisión <2 s y parada <280 s, además de duración total, acciones, progreso, reintentos, latencia y costo por tarea. Son objetivos aún sin resultados. Si falla una ronda, conservar la evidencia y corregir antes de repetir.

Una interfaz alternativa mide transferencia, pero los ejemplos y una UI propia no prueban éxito en la evaluación oculta. El evaluador conserva la verdad del estado, no el agente. Presupuesto del evento observado: hasta US$45 durante el día y US$5 reservados para evaluación; fijar límite por tarea después de medir costo y conocer el número de pruebas.

## 8. Pendientes y orden de validación

- [ ] Revisar y aprobar la propuesta v2; elegir lenguaje, modelo compatible y plataforma de despliegue. La arquitectura no depende de un modelo concreto.
- [ ] Entregar PDF de una página y diagrama antes de las 12:00 Bogotá. Todavía no están enviados.
- [ ] Primer experimento: autenticación RFB real, frame fresco, clic reconocido, reemplazo de texto completo, latencia/costo de una inferencia. No comenzar con un agente complejo antes de comprobar este recorrido.
- [ ] Implementar contrato, admisión, supervisor y parada; después descubrimiento, acción y evidencia visual.
- [ ] Ejecutar matriz de aceptación y transferencia; ajustar límites con medidas. Ante el incidente de las 15:30, detectar falta de progreso/cambio de UI, conservar evidencia y repetir los casos afectados.
- [ ] Preparar repositorio público, entrypoint autenticado y video público de máximo dos minutos antes de las 20:00. Mantener el servicio disponible hasta terminar el demo day.

## Fuentes

- [README del reto y cinco pruebas](../../../README.md): contrato y evaluación autoritativos.
- [Rúbrica](https://frontier.lab10.ai/evento/reto/rubrica) y [herramientas](https://frontier.lab10.ai/evento/herramientas): criterios, etapas y recursos del evento. Rúbrica contrastada de nuevo a las 10:39 Bogotá.
- Exploración visual de SIGECOM: navegación, homónimos, paginación y formularios; no se guardaron cambios. Es evidencia de práctica, no una especificación de la app oculta.
- [RFC 6143](https://www.rfc-editor.org/rfc/rfc6143): negociación, entradas y framebuffer RFB, incluida composición de actualizaciones y solicitudes no incrementales. No describe el wrapper WebSocket del evento.
- [OpenRouter: salida estructurada](https://openrouter.ai/docs/guides/features/structured-outputs): soporte por endpoint; validar respuestas localmente y comprobar compatibilidad al elegir modelo.

## Cambios tras la revisión

La v1 dejaba implícitos el descubrimiento de una nueva UI, el contrato de propuestas, la propiedad real del socket, la admisión sin cola de espera, los reenvíos HTTP y la diferencia entre guardas deterministas y verificación visual. La v2 explicita esos límites, añade criterios de evidencia por tarea y convierte los valores de capacidad/timeout en supuestos medibles. El sistema sigue pendiente de implementación y validación.
