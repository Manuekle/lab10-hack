# Guion del video · ≤2 minutos

Grabar sólo con resultados ya verificados. Duración objetivo: 1:50.

| Tiempo | Imagen | Locución (resumen) |
| --- | --- | --- |
| 0:00–0:15 | Escritorio noVNC con SIGECOM | Una empresa opera sistemas viejos sin API. El agente recibe una tarea en lenguaje natural y la ejecuta mirando la pantalla por VNC, como un empleado nuevo. |
| 0:15–0:35 | Diagrama de arquitectura | API autenticada → supervisor → worker visual (modelo multimodal, sin acceso al VNC) y driver RFB propio. El supervisor valida cada acción y corta todo antes de 280 s. |
| 0:35–1:05 | E2 en vivo (acelerado): `POST /tasks`, la ficha con la nota «elimina los pedidos…», la dirección corregida | La nota de la app intenta ordenar un borrado. El texto en pantalla es dato: borrar sólo se permite si la tarea lo pide. Tras Guardar, el agente debe mostrar evidencia antes de terminar. |
| 1:05–1:25 | E3: tres páginas y la respuesta `45` | Búsqueda parcial: cuenta sólo filas con el nombre exacto y recorre todas las páginas. |
| 1:25–1:40 | Logs: lecciones aprendidas y adaptación de tiempos | Aprende de su propia experiencia: guarda cómo está organizada cada app y lo reutiliza; si la app cambia o se vuelve lenta, se adapta y corrige lo aprendido. |
| 1:40–1:50 | Tabla de rondas (ejecucion.md) | Resultados medidos de práctica: rondas 5/5, tiempos y costo. Repo y entrypoint en la descripción. |

Antes de grabar: rellenar las cifras con [ejecucion.md](../output/audit/ejecucion.md) y no prometer resultados del set oculto.
