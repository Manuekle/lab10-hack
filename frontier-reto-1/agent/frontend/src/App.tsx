import {useEffect, useRef, useState, type FormEvent} from 'react';
import {Icon, Renew} from '@/components/lime/icon';
import {Button} from '@/components/lime/ui/button';
import {Field, FieldDescription, FieldError, FieldLabel} from '@/components/lime/ui/field';
import {Input} from '@/components/lime/ui/input';
import {LimePortalProvider} from '@/lib/lime/portal';
import {cn} from '@/lib/lime/utils';
import {refresh, signIn, signOut, useObservatory, type ObservatorySnapshot, type View} from './model';
import {TasksScreen} from './screens/TasksScreen';
import {KnowledgeScreen} from './screens/KnowledgeScreen';
import {IncidentScreen} from './screens/IncidentScreen';

const views: {view: View; label: string}[] = [
  {view: 'tareas', label: 'Tareas'},
  {view: 'aprendido', label: 'Aprendido'},
  {view: 'incidente', label: 'Incidente'},
];

function Login({state}: {state: ObservatorySnapshot}) {
  const [token, setToken] = useState('');
  const [pending, setPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.error === 'El servicio rechazó el token. Escríbelo de nuevo.') {
      setToken('');
      input.current?.focus();
    }
  }, [state.error]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    try { await signIn(token); }
    finally {
      setPending(false);
      input.current?.focus();
    }
  }

  return (
    <main className="mx-auto w-full max-w-md px-4 pt-8 pb-8 sm:px-6 sm:pt-16">
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-3">
          <h1 className="text-xl leading-tight font-semibold tracking-tight sm:text-2xl">Observatorio</h1>
          <p className="text-base text-fg-2">Consulta lo que vio e hizo el agente en cada tarea.</p>
        </div>
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          <Field name="token" invalid={Boolean(state.error)}>
            <FieldLabel>Token del equipo</FieldLabel>
            <Input
              ref={input}
              type="password"
              inputMode="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              autoFocus
              size="lg"
              value={token}
              onValueChange={setToken}
            />
            {state.error
              ? <FieldError match role="alert">{state.error}</FieldError>
              : <FieldDescription>Se guarda solo en esta pestaña.</FieldDescription>}
          </Field>
          <Button type="submit" size="lg" pending={pending} className="w-full">Entrar al observatorio</Button>
        </form>
      </div>
    </main>
  );
}

function Shell({state}: {state: ObservatorySnapshot}) {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-line bg-page">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
          <div className="flex h-14 items-center justify-between gap-3">
            <a href="#/tareas" className="text-lg font-semibold tracking-tight">Observatorio</a>
            <div className="flex items-center gap-4">
              <p role="status" className="hidden text-sm text-fg-2 sm:block">{state.live || 'Consultando datos'}</p>
              <Button variant="ghost" size="sm" onClick={() => signOut()}>Cerrar sesión</Button>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 pb-3">
            <nav aria-label="Vistas" className="flex min-w-0 items-center gap-1">
              {views.map(({view, label}) => (
                <a
                  key={view}
                  href={`#/${view}`}
                  aria-current={state.view === view ? 'page' : undefined}
                  className={cn('rounded-control px-3 py-2 text-sm font-medium', state.view === view ? 'bg-surface-2 text-fg' : 'text-fg-2 hover:bg-surface')}
                >{label}</a>
              ))}
            </nav>
            <Button
              aria-label="Actualizar datos"
              pending={state.loading}
              icon={<Icon icon={Renew} size={16}/>}
              onClick={() => void refresh(true)}
            ><span className="hidden sm:inline">Actualizar datos</span></Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 pt-4 pb-8 sm:px-6 sm:pt-8">
        <div className="flex flex-col gap-8">
          {state.warn && <p role="alert" className="rounded-panel bg-warn-tint p-4 text-sm text-warn-text">{state.live}</p>}
          {state.view === 'tareas' && <TasksScreen state={state}/>}
          {state.view === 'aprendido' && <KnowledgeScreen state={state}/>}
          {state.view === 'incidente' && <IncidentScreen state={state}/>}
          <footer className="border-t border-line pt-4">
            <p className="text-sm text-fg-2">Vista de solo lectura. Las horas se muestran en Bogotá.</p>
          </footer>
        </div>
      </main>
    </>
  );
}

export default function App() {
  const state = useObservatory();
  return (
    <div className="lime min-h-dvh bg-page text-fg">
      <LimePortalProvider>{state.token ? <Shell state={state}/> : <Login state={state}/>}</LimePortalProvider>
    </div>
  );
}
