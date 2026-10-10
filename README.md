# lab10-hack

Trabajo de Manuel Erazo para el Reto 1 de Frontier BOG/26 de Lab10: un agente que opera sistemas sin API a través de un escritorio remoto (VNC), sólo mirando la pantalla y usando mouse y teclado.

## Agente

- **Entrypoint:** `https://agent-production-2577.up.railway.app`. Las rutas `GET /health`, `POST /tasks` y `GET /tasks/{task_id}` exigen `Authorization: Bearer <token del equipo>`.
- **Código:** [`frontier-reto-1/agent/`](frontier-reto-1/agent/README.md), con TypeScript y Node.js. Incluye:
  - un driver RFB propio sobre WebSocket;
  - un modelo multimodal vía OpenRouter;
  - un supervisor que valida cada acción y detiene todo antes de 280 s;
  - SQLite en un volumen de Railway.
- **Cómo ejecutarlo:** el [README del agente](frontier-reto-1/agent/README.md) tiene requisitos, variables, pruebas, Docker y despliegue. Seguridad, guardrails y aprendizaje están en ese mismo archivo.
- **Resultados medidos:** [registro de pruebas](frontier-reto-1/output/audit/ejecucion.md), con las rondas E1–E5 desde reset y la transferencia a una app no vista. La selección del modelo está en el [benchmark](frontier-reto-1/output/audit/benchmark-modelos.md).

Son resultados de práctica: no garantizan el resultado en el set oculto.

## Sitio

[Ver el Systems design en GitHub Pages](https://manuekle.github.io/lab10-hack/).

El [HTML del diseño](index.html) se publica directamente en la raíz del sitio. La dirección anterior redirige a esta URL; los enlaces a documentos, PDFs y evidencia se conservan.

## Contenido

- [`frontier-reto-1/`](frontier-reto-1/README.md): instrucciones del reto, pruebas de práctica, diseño técnico y entregables.
- [`frontier-reto-1/pruebas/`](frontier-reto-1/pruebas/): cinco tareas de práctica en JSON.
- [Diseño técnico](frontier-reto-1/docs/superpowers/specs/2026-10-10-reto1-design.md).
- [Plan de ejecución de fase 2](tasks/plan.md) y [tareas con criterios de aceptación](tasks/todo.md).
- [Registro del incidente de las 15:30](frontier-reto-1/output/audit/incidente-1530.md) y [guion del video](frontier-reto-1/docs/video.md).
- [Auditoría visual de SIGECOM](frontier-reto-1/output/audit/auditoria-sigecom.md).
- [Systems design en PDF](frontier-reto-1/output/pdf/reto1-systems-design.pdf) y [diagrama en PDF](frontier-reto-1/output/pdf/reto1-arquitectura.pdf).
- [`cooper/`](cooper/README.md): recursos tipográficos y notas de uso.

## Publicación

GitHub Pages publica la rama `main` desde la raíz (`/`). El archivo `.nojekyll` permite servir el contenido estático directamente. Cada cambio enviado a `main` actualiza el sitio.

Para revisar el sitio localmente, desde la raíz del repositorio:

```sh
python3 -m http.server 8000
```

Abrir `http://localhost:8000/`.

## Archivos locales

`.gitignore` excluye las carpetas e instrucciones de agentes, el registro de skills, credenciales, dependencias y archivos temporales. De `output/` se conservan el HTML, los PDFs finales y el informe de auditoría con sus evidencias; las capturas de revisión del diseño y las imágenes de previsualización quedan fuera del repositorio.
