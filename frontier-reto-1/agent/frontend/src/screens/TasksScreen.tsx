import {useMemo} from 'react';
import type {CSSProperties, ReactNode} from 'react';
import {ToolCall, type ToolCallStatus} from '@/components/lime/ai/tool-call';
import {HomeScreen} from '@/components/lime/blocks/home';
import {Badge} from '@/components/lime/ui/badge';
import {Card, CardContent} from '@/components/lime/ui/card';
import {Empty, EmptyDescription, EmptyTitle} from '@/components/lime/ui/empty';
import {ErrorState} from '@/components/lime/ui/error-state';
import {List, ListItem} from '@/components/lime/ui/list';
import {Skeleton} from '@/components/lime/ui/skeleton';
import {Status, type StatusName} from '@/components/lime/ui/status';
import {clock, day, durationOf, formatCost, num, pct, secs, taskHref} from '../format';
import {refresh, type Event, type Frame, type ObservatorySnapshot, type Task, type TaskDetail} from '../model';

const taskStates: Record<string, {status: StatusName; label: string}> = {
  en_curso: {status: 'running', label: 'En curso'},
  terminada: {status: 'done', label: 'Terminada'},
  fallida: {status: 'failed', label: 'Fallida'},
  cancelada: {status: 'canceled', label: 'Cancelada'},
  pendiente: {status: 'queued', label: 'Pendiente'},
};

function TaskStatus({task}: {task: Task}) {
  const state = taskStates[task.estado] || {status: 'queued' as const, label: task.estado.replaceAll('_', ' ')};
  return <Status status={state.status} label={state.label || 'Pendiente'}/>;
}

function Fact({label, children}: {label: string; children: ReactNode}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-sm text-fg-2">{label}</dt>
      <dd className="break-words text-sm text-fg tabular-nums">{children}</dd>
    </div>
  );
}

function LoadingRows({label}: {label: string}) {
  return (
    <div aria-busy="true" className="flex flex-col gap-4 py-4">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map(index => (
        <div key={index} className="flex min-h-14 flex-col gap-3">
          <Skeleton className={index === 1 ? 'w-3/4' : 'w-full'}/>
          <Skeleton className="w-2/3"/>
          <Skeleton className="w-1/2"/>
        </div>
      ))}
    </div>
  );
}

function TaskList({state, pending}: {state: ObservatorySnapshot; pending: boolean}) {
  return (
    <section aria-labelledby="tasks-list-title" className="flex min-w-0 flex-col gap-3">
      <h2 id="tasks-list-title" className="text-lg font-semibold">Todas las tareas</h2>
      {pending ? <LoadingRows label="Cargando las tareas"/> : state.warn && !state.tasks.length ? (
        <ErrorState
          title="No se pudieron cargar las tareas"
          description={state.live}
          onRetry={() => void refresh(true)}
          retrying={state.loading}
          retryLabel="Volver a cargar"
        />
      ) : !state.tasks.length ? (
        <Empty>
          <EmptyTitle>Todavía no hay tareas</EmptyTitle>
          <EmptyDescription>Aparecen aquí cuando el evaluador envía una tarea.</EmptyDescription>
        </Empty>
      ) : (
        <div className="max-h-80 overflow-y-auto overscroll-contain [&_[aria-current]>a]:bg-accent-wash [&_[aria-current]>a:hover]:bg-accent-wash lg:max-h-96">
          <List aria-label="Tareas registradas">
            {state.tasks.slice(0, 50).map(task => (
              <ListItem
                key={task.id}
                href={taskHref(task.id)}
                aria-current={task.id === state.taskId ? 'true' : undefined}
                title={<span className="block break-words whitespace-normal">{task.tarea}</span>}
                description={(
                  <span className="flex flex-col gap-1 whitespace-normal text-fg-2">
                    <span><TaskStatus task={task}/></span>
                    <span className="break-words tabular-nums">{day(task.created_at)} {clock(task.created_at)}</span>
                    <span className="break-words tabular-nums">{secs(durationOf(task))} · {num.format(task.steps)} pasos · {formatCost(task.cost)}</span>
                  </span>
                )}
              />
            ))}
          </List>
        </div>
      )}
    </section>
  );
}

function numeric(data: Record<string, unknown>, key: string) {
  const value = Number(data[key] || 0);
  return Number.isFinite(value) ? value : 0;
}

function text(data: Record<string, unknown>, key: string, fallback = '') {
  const value = data[key];
  return value === undefined || value === null ? fallback : String(value);
}

function regex(source: string | undefined, fallback: string) {
  try { return new RegExp(source || fallback, 'i'); }
  catch { return new RegExp(fallback, 'i'); }
}

const FAILED_RE = /fall|fail|error/i;

interface IncidentPatterns {
  modalContext: RegExp;
  modalClose: RegExp;
  newLabels: RegExp | null;
}

function compileIncidentPatterns(incident: ObservatorySnapshot['incident']): IncidentPatterns {
  const patterns = incident?.patrones;
  const modalContext = regex(patterns?.modalContexto, 'modal|aviso|novedades|di[aá]logo');
  const modalClose = regex(patterns?.modalCierre, 'entendido|cerrar|close|×|escape');
  const labels = patterns?.etiquetasNuevas.filter(label => typeof label === 'string' && label) || [];
  const newLabels = labels.length ? new RegExp(`\\b(${labels.map(label => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i') : null;
  return {modalContext, modalClose, newLabels};
}

function useIncidentPatterns(incident: ObservatorySnapshot['incident']) {
  return useMemo(
    () => compileIncidentPatterns(incident),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [incident?.patrones?.modalContexto, incident?.patrones?.modalCierre, (incident?.patrones?.etiquetasNuevas || []).join('\0')],
  );
}

function eventFlags(event: Event, patterns: IncidentPatterns) {
  return {
    modal: event.stage === 'step' && patterns.modalContext.test(text(event.data, 'target')) && patterns.modalClose.test(`${text(event.data, 'target')} ${text(event.data, 'action')}`),
    newLabel: event.stage === 'verified' && Boolean(patterns.newLabels?.test(text(event.data, 'target'))),
  };
}

function Timing({data, maxMs}: {data: Record<string, unknown>; maxMs: number}) {
  const infer = Math.max(0, numeric(data, 'inferMs'));
  const action = Math.max(0, numeric(data, 'actMs'));
  const total = infer + action;
  return (
    <div className="flex flex-col gap-2">
      <div aria-hidden="true" className="flex h-1.5 w-full overflow-hidden rounded-sm bg-surface-2">
        <span
          className="flex w-(--step-width)"
          style={{'--step-width': `${(total / maxMs) * 100}%`} as CSSProperties}
        >
          <span className="w-(--infer-width) bg-fg-2" style={{'--infer-width': `${(infer / Math.max(1, total)) * 100}%`} as CSSProperties}/>
          <span className="flex-1 bg-control"/>
        </span>
      </div>
      <p className="text-sm text-fg-2 tabular-nums">
        Modelo {num.format(infer)} ms · acción {num.format(action)} ms · {formatCost(numeric(data, 'cost'))}
        {typeof data.changed === 'number' && ` · cambió ${pct.format(data.changed)}`}
        {numeric(data, 'attempts') > 1 && ` · ${num.format(numeric(data, 'attempts'))} intentos`}
      </p>
    </div>
  );
}

const stageNames: Record<string, string> = {
  step: 'Acción ejecutada', verified: 'Escritura verificada', finish: 'Tarea cerrada',
  rejected: 'Acción rechazada', connected: 'Escritorio conectado', app: 'App reconocida',
  adapt: 'Espera ampliada', recover: 'Recuperación iniciada', disconnected: 'Conexión interrumpida',
  reconnected: 'Conexión recuperada', knowledge_updated: 'Lecciones aprendidas',
  knowledge_reset: 'Lecciones olvidadas', knowledge_error: 'No se pudieron extraer lecciones',
};

function EventBody({event, task, maxMs, patterns}: {event: Event; task: Task; maxMs: number; patterns: IncidentPatterns}) {
  const data = event.data;
  const flags = eventFlags(event, patterns);
  const target = text(data, 'target');
  switch (event.stage) {
    case 'step':
      return (
        <>
          <p className="break-words font-medium">{target || '(sin objetivo)'}</p>
          {text(data, 'action') && <p className="break-words whitespace-pre-wrap text-fg-2">{text(data, 'action')}</p>}
          <Timing data={data} maxMs={maxMs}/>
          {flags.modal && <p className="text-sm text-fg-2">Modal cerrado sin obedecer su texto.</p>}
        </>
      );
    case 'verified':
      return (
        <>
          {target && <p className="break-words font-medium">{target}</p>}
          {text(data, 'evidence') && <q className="break-words whitespace-pre-wrap text-fg-2">{text(data, 'evidence')}</q>}
          {flags.newLabel && <p className="text-sm text-fg-2">Etiqueta del tema nuevo.</p>}
        </>
      );
    case 'finish':
      return (
        <>
          <p className="break-words whitespace-pre-wrap">{task.resumen || target || 'La tarea llegó al cierre.'}</p>
          {text(data, 'answer') && <p className="break-words whitespace-pre-wrap text-fg-2">Respuesta: {text(data, 'answer')}</p>}
          <p className="text-sm text-fg-2 tabular-nums">Modelo {num.format(numeric(data, 'inferMs'))} ms · {formatCost(numeric(data, 'cost'))}</p>
        </>
      );
    case 'rejected':
      return (
        <>
          <p className="break-words font-medium">Rechazada por el supervisor: {target}</p>
          {text(data, 'action') && <p className="break-words whitespace-pre-wrap text-fg-2">{text(data, 'action')}</p>}
          {text(data, 'why') && <p className="break-words whitespace-pre-wrap text-fg-2">{text(data, 'why')}</p>}
        </>
      );
    case 'connected':
      return <p>Conectado al escritorio en {num.format(numeric(data, 'ms'))} ms{text(data, 'width') && ` · ${text(data, 'width')}×${text(data, 'height')}`}</p>;
    case 'app':
      return <p>App reconocida: {text(data, 'app', 'Sin identificar')} · {num.format(numeric(data, 'knownLessons'))} lecciones previas cargadas</p>;
    case 'adapt':
      return <p>La app repinta lento: espera ampliada a {num.format(numeric(data, 'slowdownMs'))} ms.</p>;
    case 'recover':
      return <><p>Recuperación del {text(data, 'what', 'worker')}</p>{text(data, 'error') && <p className="break-words whitespace-pre-wrap text-fg-2">{text(data, 'error')}</p>}</>;
    case 'disconnected':
      return <p>Se cayó la conexión durante «{target}»: efecto incierto, se revisa antes de repetir.</p>;
    case 'reconnected':
      return <p>Conexión recuperada: «{target}» no se ejecutó.</p>;
    case 'knowledge_updated':
      return <p>Aprendió de la tarea: {num.format(numeric(data, 'lessons'))} lecciones para {text(data, 'app', 'la app')}.</p>;
    case 'knowledge_reset':
      return <><p>Olvidó lo aprendido de {text(data, 'app', 'la app')}.</p>{text(data, 'reason') && <p className="break-words whitespace-pre-wrap text-fg-2">{text(data, 'reason')}</p>}</>;
    case 'knowledge_error':
      return <><p>No se pudieron extraer lecciones de esta tarea.</p>{text(data, 'error') && <p className="break-words whitespace-pre-wrap text-fg-2">{text(data, 'error')}</p>}</>;
    default:
      return <p className="break-words whitespace-pre-wrap text-fg-2">{JSON.stringify(data, null, 2)}</p>;
  }
}

function Timeline({detail, incident}: {detail: TaskDetail; incident: ObservatorySnapshot['incident']}) {
  const {task, events} = detail;
  const patterns = useIncidentPatterns(incident);
  const maxMs = Math.max(1, ...events.filter(event => event.stage === 'step').map(event => numeric(event.data, 'inferMs') + numeric(event.data, 'actMs')));
  const lastEvent = events.length ? events[events.length - 1] : undefined;
  const lastTarget = lastEvent ? text(lastEvent.data, 'target') || text(lastEvent.data, 'action') : '';
  const announcement = lastEvent ? `Nuevo evento: ${stageNames[lastEvent.stage] || lastEvent.stage}${lastTarget ? ` — ${lastTarget}` : ''}` : '';
  return (
    <section aria-labelledby="task-timeline-title" className="flex min-w-0 flex-col gap-3">
      <h2 id="task-timeline-title" className="text-lg font-semibold">Línea de tiempo</h2>
      <p className="text-sm text-fg-2">En las barras de tiempo, el tramo oscuro es el modelo y el gris es la acción.</p>
      {!events.length ? (
        <Empty>
          <EmptyTitle>Sin pasos todavía</EmptyTitle>
          <EmptyDescription>La línea se llena a medida que el agente actúa.</EmptyDescription>
        </Empty>
      ) : (
        <>
          <p aria-live="polite" role="status" className="sr-only">{announcement}</p>
          <List aria-label="Eventos de la tarea en orden">
            {events.map((event, index) => {
              const failed = event.stage === 'rejected' || event.stage === 'disconnected' || event.stage === 'knowledge_error' || (event.stage === 'finish' && FAILED_RE.test(text(event.data, 'status')));
              const status: ToolCallStatus = failed ? 'failed' : 'done';
              const reason = failed ? text(event.data, 'why') || text(event.data, 'error') || text(event.data, 'status') || 'El efecto de la acción se está revisando.' : undefined;
              return (
                <li key={`${event.id ?? event.seq ?? index}-${event.at}`} className="flex min-w-0 flex-col gap-3 border-b border-line py-4 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <time dateTime={new Date(event.at).toISOString()} className="text-sm text-fg-2 tabular-nums">
                      +{(Math.max(0, event.at - task.created_at) / 1000).toFixed(1).replace('.', ',')} s · {clock(event.at)}
                    </time>
                    {event.data.step !== undefined && <Badge>Paso {text(event.data, 'step')}</Badge>}
                    {event.stage === 'finish' && text(event.data, 'status') && <Badge variant={failed ? 'danger' : 'neutral'}>{text(event.data, 'status').replaceAll('_', ' ')}</Badge>}
                    {!stageNames[event.stage] && <Badge>{event.stage}</Badge>}
                  </div>
                  <ToolCall role="presentation" status={status} label={stageNames[event.stage] || 'Evento registrado'} detail={reason}/>
                  <div className="flex min-w-0 flex-col gap-2 break-words text-sm">
                    <EventBody event={event} task={task} maxMs={maxMs} patterns={patterns}/>
                  </div>
                </li>
              );
            })}
          </List>
        </>
      )}
    </section>
  );
}

function Capture({frame, task, state}: {frame: Frame; task: Task; state: ObservatorySnapshot}) {
  const current = frame.taskId === task.id;
  const captured = current && Boolean(frame.url);
  const failed = !current && state.warn && !state.loading;
  const pending = !current && !failed;
  return (
    <section aria-labelledby="task-capture-title" className="flex flex-col gap-3">
      <h2 id="task-capture-title" className="text-lg font-semibold">Última captura</h2>
      {failed ? (
        <ErrorState title="No se pudo cargar la captura" description={state.live} onRetry={() => void refresh(true)} retrying={state.loading} retryLabel="Volver a cargar"/>
      ) : pending ? (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span className="sr-only">Cargando la última captura</span>
          <Skeleton shape="block" className="h-48 w-full"/>
          <Skeleton className="w-2/3"/>
        </div>
      ) : !captured ? (
        <Empty>
          <EmptyTitle>Sin captura en memoria para esta tarea</EmptyTitle>
          <EmptyDescription>El servicio guarda la última pantalla de las 6 tareas más recientes mientras sigue encendido.</EmptyDescription>
        </Empty>
      ) : (
        <figure className="flex min-w-0 flex-col gap-3">
          <p className="text-sm text-fg-2 tabular-nums">{frame.w}×{frame.h} · {day(frame.at)} {clock(frame.at)}</p>
          <div className="relative overflow-hidden rounded-panel border border-line">
            <img src={frame.url!} alt="Última pantalla que vio el supervisor en esta tarea" width={frame.w || undefined} height={frame.h || undefined} className="block h-auto w-full"/>
            {frame.w > 0 && frame.h > 0 && (
              <svg viewBox={`0 0 ${frame.w} ${frame.h}`} preserveAspectRatio="none" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full text-danger">
                {frame.points.map(([x, y], index) => (
                  <g key={`${x}-${y}-${index}`}>
                    <line x1={x} y1={0} x2={x} y2={frame.h} stroke="currentColor" strokeWidth={1} opacity={0.6}/>
                    <line x1={0} y1={y} x2={frame.w} y2={y} stroke="currentColor" strokeWidth={1} opacity={0.6}/>
                    <circle cx={x} cy={y} r={22} fill="none" stroke="currentColor" strokeWidth={2}/>
                    <circle cx={x} cy={y} r={5} fill="currentColor"/>
                  </g>
                ))}
              </svg>
            )}
          </div>
          <figcaption className="break-words text-sm text-fg-2">
            {frame.points.length
              ? `La marca indica dónde actuó la última acción (${frame.action}, ${frame.points.map(point => point.join(',')).join(' · ')}).`
              : 'La última captura no viene de un clic.'}
          </figcaption>
        </figure>
      )}
    </section>
  );
}

function Detail({state}: {state: ObservatorySnapshot}) {
  const detail = state.detail?.task.id === state.taskId ? state.detail : null;
  if (state.detailError) {
    return <ErrorState title="No se pudo abrir la tarea" description={state.detailError} onRetry={() => void refresh(true)} retrying={state.loading} retryLabel="Volver a cargar"/>;
  }
  if (!detail) {
    return state.taskId || state.loading || (!state.live && !state.warn) ? <LoadingRows label="Cargando los detalles de la tarea"/> : (
      <section aria-labelledby="task-detail-title" className="flex flex-col gap-3">
        <h2 id="task-detail-title" className="text-lg font-semibold">Detalle de tarea</h2>
        <Empty>
          <EmptyTitle>Selecciona una tarea</EmptyTitle>
          <EmptyDescription>Abre una tarea de la lista para ver su recorrido y la última captura.</EmptyDescription>
        </Empty>
      </section>
    );
  }
  const {task, events} = detail;
  const model = [...events].reverse().find(event => event.data.model)?.data.model;
  const app = events.find(event => event.stage === 'app')?.data.app;
  const connection = events.find(event => event.stage === 'connected')?.data.ms;
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <section aria-labelledby="task-detail-title" className="flex flex-col gap-3">
        <h2 id="task-detail-title" className="text-lg font-semibold">Detalle de tarea</h2>
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <span role="status"><TaskStatus task={task}/></span>
            <span className="break-words text-sm text-fg-2">Fase {task.fase}</span>
          </div>
          <CardContent>
            <h3 className="break-words whitespace-pre-wrap text-lg leading-snug font-semibold">{task.tarea}</h3>
            <p className="break-all text-sm text-fg-2">{task.id}</p>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
              <Fact label="Inicio">{day(task.created_at)} {clock(task.created_at)}</Fact>
              <Fact label={task.finished_at ? 'Duración' : 'Lleva'}>{secs(durationOf(task))}</Fact>
              <Fact label="Pasos">{num.format(task.steps)}</Fact>
              <Fact label="Costo">{formatCost(task.cost)}</Fact>
              <Fact label="App">{app ? String(app) : 'Sin identificar'}</Fact>
              <Fact label="Conexión">{connection !== undefined ? `${num.format(Number(connection))} ms` : 'Sin datos'}</Fact>
              <Fact label="Modelo">{model ? String(model) : 'Sin datos'}</Fact>
            </dl>
            {task.resumen && <p className="break-words whitespace-pre-wrap text-sm">{task.resumen}</p>}
          </CardContent>
        </Card>
      </section>
      <Capture frame={state.frame} task={task} state={state}/>
      <Timeline detail={detail} incident={state.incident}/>
    </div>
  );
}

export function TasksScreen({state}: {state: ObservatorySnapshot}) {
  const pending = !state.tasks.length && (state.loading || (!state.live && !state.warn));
  return (
    <div className="flex flex-col gap-8">
      {pending || (state.warn && !state.tasks.length) ? (
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h1 className="text-xl leading-tight font-semibold tracking-tight sm:text-2xl">Tareas</h1>
            <p className="text-base text-fg-2">Lo que vio e hizo el agente, paso a paso.</p>
          </div>
          {pending && (
            <section aria-label="Resumen de tareas" aria-busy="true" className="flex flex-col gap-4">
              <span className="sr-only">Cargando el resumen de tareas</span>
              <Skeleton className="h-8 w-48"/>
              <Skeleton className="w-2/3"/>
              <Skeleton className="w-1/2"/>
            </section>
          )}
        </div>
      ) : <HomeScreen tasks={state.tasks}/>}
      <div className="grid items-start gap-8 lg:grid-cols-3">
        <TaskList state={state} pending={pending}/>
        {(state.tasks.length > 0 || state.taskId || pending) && <div className="min-w-0 lg:col-span-2"><Detail state={state}/></div>}
      </div>
    </div>
  );
}
