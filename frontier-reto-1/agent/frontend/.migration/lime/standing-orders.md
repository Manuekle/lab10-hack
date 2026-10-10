# Standing orders

- User selected the existing branch; no new branch, PR, push or deployment.
- Change only frontend/** and the generated ../src/ui/index.html.
- Do not change backend, agent package, ui.ts, server.ts, tests, database or incident data.
- Keep all API paths, GET-only observer behavior, token validation/session storage, polling, evidence, costs, captures and hash routes.
- Use only Lime components and defined tokens. Never invent a color, size or font in app code.
- Shared layer has one owner; each screen has one writer. No shared-file edits by screen workers.
- Screens get one primary refresh action from shell; do not add another.
- No service-based motion fixes or transitions-agent fix is authorized.
- Baselines are immutable. Independent reviewer checks final integration; fixes return to the file owner.
