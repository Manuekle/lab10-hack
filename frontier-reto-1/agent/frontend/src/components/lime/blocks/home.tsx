import {List, ListItem} from '@/components/lime/ui/list';
import {durationOf, formatCost, num, secs} from '@/format';
import type {Task} from '@/model';

// Lime's home block adapted to the observatory's real task data.
// Keep one leading figure and a quiet list, without a row of equal stat cards.
export function HomeScreen({tasks}: {tasks: Task[]}) {
  const done = tasks.filter(task => task.estado === 'terminada').length;
  const failed = tasks.filter(task => task.estado === 'fallida').length;
  const finished = tasks.filter(task => task.finished_at);
  const totalTime = finished.reduce((total, task) => total + durationOf(task), 0);
  const totalCost = tasks.reduce((total, task) => total + (task.cost || 0), 0);

  return (
    <section className="flex flex-col gap-6" aria-labelledby="tasks-title">
      <div className="flex flex-col gap-2">
        <h1 id="tasks-title" className="text-xl leading-tight font-semibold tracking-tight sm:text-2xl">Tareas</h1>
        <p className="text-base text-fg-2">La actividad del agente, sus decisiones y la última pantalla de cada tarea.</p>
      </div>
      <div className="flex flex-col gap-6 border-b border-line pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2">
          <p className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tracking-tight tabular-nums">{num.format(tasks.length)}</span>
            <span className="text-base text-fg-2">tareas observadas</span>
          </p>
          <p className="text-sm text-fg-2">{num.format(done)} terminadas · {num.format(failed)} fallidas</p>
        </div>
        <List className="w-full sm:max-w-sm" aria-label="Costos y tiempos de las tareas">
          <ListItem title="Costo total" trailing={formatCost(totalCost)}/>
          <ListItem title="Tiempo total" trailing={finished.length ? secs(totalTime) : '—'}/>
          <ListItem title="Media por tarea" trailing={finished.length ? secs(totalTime / finished.length) : '—'}/>
        </List>
      </div>
    </section>
  );
}
