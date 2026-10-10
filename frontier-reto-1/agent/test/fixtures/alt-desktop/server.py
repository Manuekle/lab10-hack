# App alternativa para medir transferencia: sirve la UI y guarda el estado en memoria. GET /state lo expone al harness.
import json, http.server, copy

SEED = {
    "proveedores": [
        {"id": f"PR-{i:03d}", "nombre": n, "rut": r, "ciudad": c, "contacto": t}
        for i, (n, r, c, t) in enumerate([
            ("Aceros del Pacífico", "800123456", "Cali", "6024441122"),
            ("Bodegas Andinas", "800654321", "Bogotá", "6015552233"),
            ("Cartones Medellín", "811222333", "Medellín", "6046667788"),
            ("Distribuidora Luna", "830111222", "Barranquilla", "6053334455"),
            ("Empaques Ruiz", "900222111", "Bogotá", "6017778899"),
            ("Empaques Ruiz y Cía", "900333444", "Cali", "6028889900"),
            ("Ferrotodo", "890555666", "Pereira", "6063332211"),
            ("Granos del Valle", "891777888", "Cali", "6021112233"),
            ("Herrajes Torres", "860999000", "Bogotá", "6019990011"),
            ("Herrajes Torres", "901888777", "Medellín", "6048887766"),
            ("Insumos Quindío", "801444555", "Armenia", "6067776655"),
            ("Jardines y Más", "900777666", "Bogotá", "6015554433"),
        ], start=1)
    ],
    "eventos": [],
}
STATE = copy.deepcopy(SEED)

class H(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def _json(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code)
        self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        if self.path == "/state": return self._json(200, STATE)
        return super().do_GET()
    def do_POST(self):
        global STATE
        n = int(self.headers.get("Content-Length", 0)); body = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/reset": STATE = copy.deepcopy(SEED); return self._json(200, {"ok": True})
        if self.path == "/proveedores":
            p = dict(body); p["id"] = f"PR-{len(STATE['proveedores']) + 1:03d}"; STATE["proveedores"].append(p)
            STATE["eventos"].append({"accion": "create", "id": p["id"]}); return self._json(200, p)
        if self.path.startswith("/proveedores/"):
            pid = self.path.split("/")[-1]
            for p in STATE["proveedores"]:
                if p["id"] == pid:
                    for k, v in body.items(): p[k] = v
                    STATE["eventos"].append({"accion": "update", "id": pid, "campos": list(body)}); return self._json(200, p)
            return self._json(404, {})
        return self._json(404, {})

http.server.ThreadingHTTPServer(("0.0.0.0", 8000), H).serve_forever()
