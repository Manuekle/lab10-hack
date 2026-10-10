import {Badge} from '@/components/lime/ui/badge';
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from '@/components/lime/ui/card';
import {Empty, EmptyDescription, EmptyTitle} from '@/components/lime/ui/empty';
import {ErrorState} from '@/components/lime/ui/error-state';
import {List, ListItem} from '@/components/lime/ui/list';
import {Skeleton} from '@/components/lime/ui/skeleton';
import {clock, num, taskHref} from '../format';
import {refresh, type Event, type ObservatorySnapshot} from '../model';

const short = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value);

function textOf(data: Record<string, unknown>, key: string, fallback = '') {
  const value = data[key];
  return value === undefined || value === null ? fallback : String(value);
}

function historyLabel(event: Event) {
  const data = event.data || {};
  switch (event.stage) {
    case 'knowledge_reset':
      return {k: `Olvidó lo aprendido de ${textOf(data, 'app', 'la app') || 'la app'}`, d: textOf(data, 'reason'), cls: 'reset'};
    case 'knowledge_updated': {
      const lessons = Number(data.lessons || 0);
      const slowdown = Number(data.slowdownMs || 0);
      return {
        k: `Aprendió ${Number.isFinite(lessons) ? lessons : 0} lecciones de ${textOf(data, 'app', 'la app') || 'la app'}`,
        d: slowdown ? `espera extra ${num.format(slowdown)} ms` : '',
      };
    }
    case 'knowledge_error':
      return {k: `Sin lecciones nuevas de ${textOf(data, 'app', 'la app') || 'la app'}`, d: short(textOf(data, 'error'), 140)};
    default:
      return {k: event.stage, d: ''};
  }
}

function LoadingState() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Cargando lo aprendido</span>
      <Skeleton className="h-8 w-48" />
      <Skeleton className="w-2/3" />
      <div className="grid items-start gap-8 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          {[0, 1].map(index => (
            <div key={index} className="flex flex-col gap-3">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="w-full" />
              <Skeleton className="w-2/3" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="w-full" />
          <Skeleton className="w-3/4" />
        </div>
      </div>
    </div>
  );
}

export function KnowledgeScreen({state}: {state: ObservatorySnapshot}) {
  const pending = !state.knowledge && (state.loading || (!state.live && !state.warn));
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl leading-tight font-semibold tracking-tight sm:text-2xl">Lo aprendido por app</h1>
        <p className="text-base text-fg-2">
          Lecciones de interfaz que el agente guarda al terminar una tarea y carga cuando reconoce la misma app. Si una
          tarea falla usándolas, las olvida.
        </p>
      </div>
      {pending ? (
        <LoadingState />
      ) : state.warn && !state.knowledge ? (
        <ErrorState
          title="No se pudo cargar lo aprendido"
          description={state.live}
          onRetry={() => void refresh(true)}
          retrying={state.loading}
          retryLabel="Volver a cargar"
        />
      ) : !state.knowledge ? (
        <Empty>
          <EmptyTitle>Todavía no hay lecciones guardadas</EmptyTitle>
          <EmptyDescription>
            Se aprenden al terminar cada tarea que el agente cierra por decisión propia.
          </EmptyDescription>
        </Empty>
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-3">
          <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
            {!state.knowledge.apps.length ? (
              <Empty>
                <EmptyTitle>Todavía no hay lecciones guardadas</EmptyTitle>
                <EmptyDescription>
                  Se aprenden al terminar cada tarea que el agente cierra por decisión propia.
                </EmptyDescription>
              </Empty>
            ) : (
              state.knowledge.apps.map(app => (
                <Card key={app.app}>
                  <CardHeader>
                    <CardTitle>{app.app}</CardTitle>
                    <CardDescription className="tabular-nums">
                      {num.format(app.tasks)} tareas aprendidas · espera extra {num.format(app.slowdown_ms)} ms ·
                      actualizado {clock(app.updated_at)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {app.lessons.length ? (
                      <ul className="flex list-disc flex-col gap-1 ps-5 text-sm">
                        {app.lessons.map((lesson, index) => (
                          <li key={`${app.app}-${index}`} className="break-words">
                            {lesson.replace(/^[-•]\s*/, '')}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-fg-2">Sin lecciones: la próxima tarea explora la app desde cero.</p>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="text-base">Aprendido y olvidado</CardTitle>
            </CardHeader>
            <CardContent>
              {!state.knowledge.history.length &&
              !(state.incident && 'adaptaciones' in state.incident && state.incident.adaptaciones) ? (
                <p className="text-sm text-fg-2">
                  Sin cambios registrados desde que el servicio guarda este historial.
                </p>
              ) : (
                <List aria-label="Historial de aprendido y olvidado">
                  {state.knowledge.history.map((event, index) => {
                    const label = historyLabel(event);
                    const taskId = typeof event.task_id === 'string' ? event.task_id : '';
                    return (
                      <ListItem
                        key={`${event.id ?? event.seq ?? index}-${event.at}`}
                        title={
                          <span className="flex flex-wrap items-center gap-2 break-words whitespace-normal">
                            <span>{label.k}</span>
                            {label.cls === 'reset' && <Badge variant="danger">Olvido</Badge>}
                          </span>
                        }
                        description={
                          <span className="flex flex-col gap-1 whitespace-normal">
                            <time dateTime={new Date(event.at).toISOString()} className="tabular-nums">
                              {clock(event.at)}
                            </time>
                            {label.d && <span className="break-words">{label.d}</span>}
                            {taskId && (
                              <a href={taskHref(taskId)} className="break-words font-mono text-xs underline">
                                tarea {taskId.slice(0, 8)}
                              </a>
                            )}
                          </span>
                        }
                      />
                    );
                  })}
                  {state.incident && 'adaptaciones' in state.incident && state.incident.adaptaciones && (
                    <ListItem
                      title={
                        <span className="flex flex-wrap items-center gap-2 break-words whitespace-normal">
                          <span>Olvido total: migración 3</span>
                          <Badge variant="danger">Olvido</Badge>
                        </span>
                      }
                      description={
                        <span className="flex flex-col gap-1 whitespace-normal">
                          <time className="tabular-nums">15:45</time>
                          <span className="break-words">
                            Al desplegar la adaptación al tema nuevo se vació app_knowledge. Lo aprendido de v3.9 ya no
                            describía la pantalla.
                          </span>
                        </span>
                      }
                    />
                  )}
                </List>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
