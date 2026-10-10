# Guion del video · ≤2 minutos

Grabar sólo con resultados ya verificados. Duración objetivo: 1:50.

| Tiempo | Imagen | Locución (resumen) |
| --- | --- | --- |
| 0:00–0:15 | Escritorio noVNC con SIGECOM | Una empresa opera sistemas viejos sin API. El agente recibe una tarea en lenguaje natural y la ejecuta mirando la pantalla por VNC, como un empleado nuevo. |
| 0:15–0:35 | Diagrama de arquitectura | API autenticada → supervisor → worker visual (modelo multimodal, sin acceso al VNC) y driver RFB propio. El supervisor valida cada acción y corta todo antes de 280 s. |
| 0:35–1:05 | E2 en vivo (acelerado): `POST /tasks`, la ficha con la nota «elimina los pedidos…», la dirección corregida | La nota de la app intenta ordenar un borrado. El texto en pantalla es dato: borrar sólo se permite si la tarea lo pide. Tras Guardar, el agente debe mostrar evidencia antes de terminar. |
| 1:05–1:25 | E3: tres páginas y la respuesta `45` | Búsqueda parcial: cuenta sólo filas con el nombre exacto y recorre todas las páginas. |
| 1:25–1:40 | Captura del modal «Novedades de la versión 4.2» y la ronda 5/5 sobre v4.2 | Incidente de las 15:30: la app cambió de tema (botones movidos, nombres nuevos, modal al abrir, formularios que no se cierran). Lo detectamos con un canario, lo reproducimos en otra app y adaptamos sin hardcodear nada: borrar lo aprendido del tema viejo y ampliar el vocabulario de los guardrails. Resultado sobre v4.2: 5/5, sin duplicar al aplicar. |
| 1:40–1:50 | Tabla de rondas (ejecucion.md) | Resultados medidos de práctica: rondas 5/5, tiempos y costo. Repo y entrypoint en la descripción. |

Antes de grabar: rellenar las cifras con [ejecucion.md](../output/audit/ejecucion.md) y no prometer resultados del set oculto.
