import {useMemo, useState} from 'react';
import type {CSSProperties} from 'react';
import {Badge} from '@/components/lime/ui/badge';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/lime/ui/card';
import {Empty, EmptyDescription, EmptyTitle} from '@/components/lime/ui/empty';
import {Field, FieldLabel} from '@/components/lime/ui/field';
import {List, ListItem} from '@/components/lime/ui/list';
import {Progress} from '@/components/lime/ui/progress';
import {Segmented, SegmentedItem} from '@/components/lime/ui/segmented';
import {Slider} from '@/components/lime/ui/slider';
import {Table, TableBody, TableCell, TableHead, TableHeader, TableRow} from '@/components/lime/ui/table';
import {clock, shortClock, taskHref} from '../format';
import type {Event, ObservatorySnapshot, Task} from '../model';

const DELETE_WORDS = /elimin|borr|anul|suprim|dar de baja|desactiv|inactiv|delete|remove/i;
const DEFAULT_PATTERNS = {modalContexto: 'modal|aviso|novedades|di[aá]logo', modalCierre: 'entendido|cerrar|close|×|escape'};

function textOf(data: Record<string, unknown>, key: string) {
  const value = data[key];
  return value === undefined || value === null ? '' : String(value);
}

function short(value: string, n: number) {
  return value.length > n ? `${value.slice(0, n - 1)}…` : value;
}

function regex(source: string | undefined, fallback: string) {
  try { return new RegExp(source || fallback, 'i'); }
  catch { return new RegExp(fallback, 'i'); }
}

interface LivePatterns {
  ctx: RegExp;
  close: RegExp;
  labels: RegExp | null;
}

function compilePatterns(incident: ObservatorySnapshot['incident']): LivePatterns {
  const raw = incident?.patrones as {modalContexto?: string; modalCierre?: string; etiquetasNuevas?: unknown} | undefined;
  const labels = Array.isArray(raw?.etiquetasNuevas) ? raw.etiquetasNuevas.filter((label): label is string => typeof label === 'string' && Boolean(label)) : [];
  return {
    ctx: regex(raw?.modalContexto, DEFAULT_PATTERNS.modalContexto),
    close: regex(raw?.modalCierre, DEFAULT_PATTERNS.modalCierre),
    labels: labels.length ? new RegExp(`\\b(${labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i') : null,
  };
}

function isModalClose(event: Event, pt: LivePatterns) {
  return event.stage === 'step' && pt.ctx.test(textOf(event.data, 'target')) && pt.close.test(`${textOf(event.data, 'target')} ${textOf(event.data, 'action')}`);
}

function hasNewLabel(event: Event, pt: LivePatterns) {
  return event.stage === 'verified' && Boolean(pt.labels?.test(textOf(event.data, 'target')));
}

interface LiveItem {
  task: Task | {id: string; tarea: string};
  at: number;
  title: string;
  sub: string;
  extra?: string;
  quote?: string;
}

function toItem(task: Task | {id: string; tarea: string}, at: number, title: string, quote = '', extra = ''): LiveItem {
  return {task, at, title, sub: `${clock(at)} · ${short(task.tarea, 48)}`, extra: extra || undefined, quote: quote || undefined};
}

function LiveList({items, emptyLabel}: {items: LiveItem[]; emptyLabel: string}) {
  if (!items.length) return <p className="text-sm text-fg-2">{emptyLabel}</p>;
  return (
    <List aria-label="Evidencia en vivo">
      {items.slice(0, 4).map((item, index) => (
        <ListItem
          key={`${item.task.id}-${item.at}-${index}`}
          href={taskHref(item.task.id)}
          title={<span className="block break-words whitespace-normal">{item.title}{item.extra ? ` · ${item.extra}` : ''}</span>}
          description={(
            <span className="flex flex-col gap-1 whitespace-normal">
              <span className="break-words">{item.sub}</span>
              {item.quote && <q className="break-words whitespace-pre-wrap"> {item.quote}</q>}
            </span>
          )}
        />
      ))}
    </List>
  );
}

function useLive(incident: NonNullable<ObservatorySnapshot['incident']>, state: ObservatorySnapshot) {
  return useMemo(() => {
    const since = Date.parse(incident.desde);
    const tasks = state.tasks.filter(task => task.created_at >= since);
    const pt = compilePatterns(incident);
    const modal: {task: Task; at: number}[] = [];
    const modalItems: LiveItem[] = [];
    const labelItems: LiveItem[] = [];
    const slowItems: LiveItem[] = [];
    let foreign = 0;
    for (const task of tasks) {
      const cached = state.incEvents.get(task.id);
      if (!cached) continue;
      const deleted = cached.events.some(event => event.stage === 'step' && DELETE_WORDS.test(textOf(event.data, 'target')));
      const deleteAsked = DELETE_WORDS.test(task.tarea);
      for (const event of cached.events) {
        if (isModalClose(event, pt)) {
          modal.push({task, at: event.at});
          modalItems.push(toItem(task, event.at, textOf(event.data, 'target'), '', !deleted || deleteAsked ? 'no obedecido' : ''));
        }
        if (hasNewLabel(event, pt)) labelItems.push(toItem(task, event.at, textOf(event.data, 'target'), short(textOf(event.data, 'evidence'), 90)));
        if (event.stage === 'adapt') slowItems.push(toItem(task, event.at, `Espera de ${textOf(event.data, 'slowdownMs')} ms`));
        if (event.stage === 'rejected' && textOf(event.data, 'why') === 'fuera de la tarea') foreign++;
      }
    }
    const newest = (a: LiveItem, b: LiveItem) => b.at - a.at;
    modalItems.sort(newest);
    labelItems.sort(newest);
    slowItems.sort(newest);
    const resets = (state.knowledge?.history || []).filter(event => event.stage === 'knowledge_reset' && event.at >= since);
    const resetItems = resets.map(event => {
      const task = tasks.find(candidate => candidate.id === event.task_id) || {id: String(event.task_id || ''), tarea: String(event.task_id || '')};
      return toItem(task, event.at, `Olvidó ${textOf(event.data, 'app') || 'la app'}`, textOf(event.data, 'reason'));
    });
    const done = tasks.filter(task => task.estado === 'terminada').length;
    const running = tasks.filter(task => task.estado === 'en_curso').length;
    const scope = `En vivo desde las ${shortClock(since)}: ${tasks.length} tareas observadas (${done} terminadas, ${tasks.length - done - running} fallidas).`;
    return {
      scope,
      modal: {count: modal.length, caption: `pasos cerraron el modal${foreign ? ` · ${foreign} órdenes ajenas rechazadas` : ''}`, items: modalItems},
      olvido: {count: resets.length, caption: resets.length === 1 ? 'olvido en vivo, además de la migración 3' : 'olvidos en vivo, además de la migración 3', items: resetItems},
      etiquetas: {count: labelItems.length, caption: 'escrituras verificadas con etiquetas nuevas', items: labelItems},
      lento: {count: slowItems.length, caption: 'esperas ampliadas en vivo', items: slowItems},
    };
  }, [incident, state.incEvents, state.knowledge, state.tasks]);
}

function Detection({incident, state}: {incident: NonNullable<ObservatorySnapshot['incident']>; state: ObservatorySnapshot}) {
  const det = incident.deteccion;
  const [mode, setMode] = useState<'lado' | 'cortina'>('lado');
  const [cut, setCut] = useState(50);
  const before = state.assets.get(det.antes.imagen);
  const after = state.assets.get(det.despues.imagen);
  return (
    <section aria-labelledby="det-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="det-title" className="text-lg font-semibold">Detección</h2>
        <Segmented value={mode} onValueChange={value => setMode(value as 'lado' | 'cortina')} aria-label="Modo de comparación">
          <SegmentedItem value="lado">Lado a lado</SegmentedItem>
          <SegmentedItem value="cortina">Cortina</SegmentedItem>
        </Segmented>
      </div>
      {!before || !after ? (
        <Empty>
          <EmptyTitle>Capturas en camino</EmptyTitle>
          <EmptyDescription>Las imágenes del antes y el después aparecen cuando el servicio las entrega.</EmptyDescription>
        </Empty>
      ) : mode === 'lado' ? (
        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
          {[{url: before, version: det.antes.version, when: det.antes.hora, note: det.antes.nota, alt: `${det.antes.version}: pantalla de inicio con el tema anterior`},
            {url: after, version: det.despues.version, when: det.despues.hora, note: det.despues.nota, alt: `${det.despues.version}: cabecera verde y modal de novedades al abrir`}].map(shot => (
            <figure key={shot.version} className="flex min-w-0 flex-col gap-2">
              <img src={shot.url} alt={shot.alt} width={1280} height={800} className="block h-auto w-full rounded-panel"/>
              <figcaption className="flex flex-col gap-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge variant="accent">{shot.version.replace(/^.*\s/, '')}</Badge>
                  <b className="text-sm">{shot.version} · {shot.when}</b>
                </span>
                <span className="break-words text-sm text-fg-2">{shot.note}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <div className="relative min-w-0 overflow-hidden rounded-panel">
            <img src={after} alt={det.despues.version} width={1280} height={800} draggable={false} className="block h-auto w-full"/>
            <img
              src={before}
              alt=""
              width={1280}
              height={800}
              draggable={false}
              aria-hidden={true}
              className="absolute inset-0 block h-full w-full [clip-path:inset(0_calc(100%-var(--cut))_0_0)]"
              style={{'--cut': `${cut}%`} as CSSProperties}
            />
            <span aria-hidden="true" className="absolute inset-y-0 left-(--cutline) w-0.5 bg-page" style={{'--cutline': `calc(${cut}% - 1px)`} as CSSProperties}/>
            <span className="absolute top-3 left-3"><Badge variant="accent">{det.antes.version.replace(/^.*\s/, '')}</Badge></span>
            <span className="absolute top-3 right-3"><Badge variant="accent">{det.despues.version.replace(/^.*\s/, '')}</Badge></span>
          </div>
          <Field>
            <FieldLabel>{`Cortina entre ${det.antes.version} y ${det.despues.version}`}</FieldLabel>
            <Slider
              value={[cut]}
              min={0}
              max={100}
              thumbLabels={[`Cortina entre ${det.antes.version} y ${det.despues.version}`]}
              onValueChange={value => setCut(Array.isArray(value) ? (value[0] ?? 0) : (value ?? 0))}
              aria-label={`Cortina entre ${det.antes.version} y ${det.despues.version}`}
            />
          </Field>
        </div>
      )}
      <p className="break-words text-sm text-fg-2"><b className="font-semibold text-fg">{det.hora} · </b>{det.fuente}. Cambio: {det.cambio}.</p>
    </section>
  );
}

function Results({incident}: {incident: NonNullable<ObservatorySnapshot['incident']>}) {
  const model = useMemo(() => {
    const [a, b] = incident.resultados;
    const max = Math.max(1, ...incident.resultados.flatMap(r => r.filas.map(f => f.segundos)));
    const passed = (r: (typeof incident.resultados)[number]) => r.filas.filter(f => f.app === 'pasa').length;
    const ids = [...new Set([...a.filas, ...b.filas].map(f => f.prueba))];
    const rows = ids.map(id => {
      const fa = a.filas.find(f => f.prueba === id);
      const fb = b.filas.find(f => f.prueba === id);
      const delta = fa && fb ? fb.segundos - fa.segundos : null;
      return {id, fa, fb, delta};
    });
    return {a, b, max, passedA: passed(a), passedB: passed(b), rows};
  }, [incident]);
  const fmtSecs = (s: number) => `${s.toFixed(1).replace('.', ',')} s`;
  const fmtDelta = (d: number) => `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1).replace('.', ',')} s`;
  const versionOf = (titulo: string) => titulo.split('·').pop()?.trim() || titulo;
  const cell = (f: {app: string; estado: string; segundos: number} | undefined, label: string) => {
    if (!f) return <span className="text-sm text-fg-2">sin dato</span>;
    return (
      <span className="flex min-w-0 flex-col gap-2">
        <Progress value={f.segundos} max={model.max} label={`${label}: ${f.segundos} segundos`} valueText={fmtSecs(f.segundos)}/>
        <span className="text-sm tabular-nums">{fmtSecs(f.segundos)}</span>
        <span className="text-sm text-fg-2"><b className="font-semibold text-fg">{f.app}</b> · {f.estado}</span>
      </span>
    );
  };
  return (
    <section aria-labelledby="res-title" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="res-title" className="text-lg font-semibold">Resultados E1–E5</h2>
        <p className="text-sm text-fg-2 tabular-nums">{versionOf(model.a.titulo)} {model.passedA}/{model.a.filas.length} → {versionOf(model.b.titulo)} {model.passedB}/{model.b.filas.length}</p>
      </div>
      <Card>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Prueba</TableHead>
                <TableHead>{model.a.titulo}, {model.a.detalle}</TableHead>
                <TableHead>{model.b.titulo}, {model.b.detalle}</TableHead>
                <TableHead>Δ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {model.rows.map(row => (
                <TableRow key={row.id}>
                  <TableCell><Badge>{row.id}</Badge></TableCell>
                  <TableCell>{cell(row.fa, `${model.a.titulo} ${row.id}`)}</TableCell>
                  <TableCell>{cell(row.fb, `${model.b.titulo} ${row.id}`)}</TableCell>
                  <TableCell><span className="text-sm tabular-nums">{row.delta === null ? '' : fmtDelta(row.delta)}</span></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {incident.notaResultados && <p className="break-words text-sm text-fg-2">{incident.notaResultados}</p>}
        </CardContent>
      </Card>
    </section>
  );
}

export function IncidentScreen({state}: {state: ObservatorySnapshot}) {
  const incident = state.incident;
  const live = useLive(incident as NonNullable<ObservatorySnapshot['incident']>, state);
  if (!incident) {
    return (
      <Empty>
        <EmptyTitle>Sin datos del incidente</EmptyTitle>
        <EmptyDescription>El panel de respuesta aparece cuando el servicio entrega el informe.</EmptyDescription>
      </Empty>
    );
  }
  const groups = [
    {clave: 'modal', titulo: incident.adaptaciones.find(a => a.clave === 'modal')?.titulo || 'Modal', detalle: incident.adaptaciones.find(a => a.clave === 'modal')?.detalle || '', live: live.modal},
    {clave: 'olvido', titulo: incident.adaptaciones.find(a => a.clave === 'olvido')?.titulo || 'Olvido', detalle: incident.adaptaciones.find(a => a.clave === 'olvido')?.detalle || '', live: live.olvido},
    {clave: 'etiquetas', titulo: incident.adaptaciones.find(a => a.clave === 'etiquetas')?.titulo || 'Etiquetas', detalle: incident.adaptaciones.find(a => a.clave === 'etiquetas')?.detalle || '', live: live.etiquetas},
    {clave: 'lento', titulo: incident.adaptaciones.find(a => a.clave === 'lento')?.titulo || 'Lento', detalle: incident.adaptaciones.find(a => a.clave === 'lento')?.detalle || '', live: live.lento},
  ];
  return (
    <div className="flex flex-col gap-8">
      <Card>
        <CardHeader>
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant="danger">{incident.ticket.id}</Badge>
            <Badge>Prioridad {incident.ticket.prioridad}</Badge>
          </span>
          <h1 className="text-lg leading-tight font-semibold">{incident.ticket.texto}</h1>
          <p className="text-sm text-fg-2">Respuesta al incidente · {incident.ticket.hora} · prioridad {incident.ticket.prioridad}</p>
        </CardHeader>
        <CardContent>
          <List aria-label="Cambios reportados">
            {incident.ticket.cambios.map(cambio => (
              <ListItem key={cambio} title={<span className="block break-words whitespace-normal">{cambio}</span>}/>
            ))}
          </List>
        </CardContent>
      </Card>
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <Card>
          <CardContent>
            <Detection incident={incident} state={state}/>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <section aria-labelledby="clock-title" className="flex min-w-0 flex-col gap-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="clock-title" className="text-lg font-semibold">Línea de tiempo</h2>
                <span className="text-sm text-fg-2">hora de Bogotá</span>
              </div>
              <List aria-label="Línea de tiempo del incidente">
                {incident.lineaDeTiempo.map(entry => (
                  <ListItem
                    key={`${entry.hora}-${entry.titulo}`}
                    title={<span className="block break-words whitespace-normal">{entry.titulo}</span>}
                    description={(
                      <span className="flex flex-col gap-1 whitespace-normal">
                        <span className="break-words tabular-nums"><Badge variant="outline">{entry.hora}</Badge> <Badge variant="neutral">{entry.tipo}</Badge></span>
                        <span className="break-words whitespace-pre-wrap">{entry.detalle}</span>
                      </span>
                    )}
                  />
                ))}
              </List>
            </section>
          </CardContent>
        </Card>
      </div>
      <section aria-labelledby="adapt-title" className="flex min-w-0 flex-col gap-3">
        <h2 id="adapt-title" className="text-lg font-semibold">Adaptación</h2>
        <p className="text-sm text-fg-2">{live.scope}</p>
        <div className="grid items-start gap-4 md:grid-cols-2">
          {groups.map(group => (
            <Card key={group.clave}>
              <CardHeader>
                <CardTitle>{group.titulo}</CardTitle>
                <CardDescription>{group.detalle}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-fg-2 tabular-nums"><b className="text-base font-semibold text-fg">{group.live.count}</b> {group.live.caption}</p>
                <LiveList items={group.live.items} emptyLabel="Sin registros en vivo todavía."/>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
      <Results incident={incident}/>
    </div>
  );
}
