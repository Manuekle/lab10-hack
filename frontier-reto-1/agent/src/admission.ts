// Admisión: un slot por tarea activa y un único ejecutor por escritorio. Se reserva antes de devolver task_id.
export type AdmissionResult = 'ok' | 'desktop_busy' | 'capacity';

export class Admission {
  private readonly maxActive: number;
  private readonly leases = new Map<string, string>(); // escritorio -> task_id
  private readonly byTask = new Map<string, string>(); // task_id -> escritorio

  constructor(maxActive: number) {
    this.maxActive = maxActive;
  }

  get active(): number {
    return this.byTask.size;
  }

  acquire(taskId: string, desktopKey: string): AdmissionResult {
    if (this.leases.has(desktopKey)) return 'desktop_busy';
    if (this.byTask.size >= this.maxActive) return 'capacity';
    this.leases.set(desktopKey, taskId);
    this.byTask.set(taskId, desktopKey);
    return 'ok';
  }

  release(taskId: string): void {
    const key = this.byTask.get(taskId);
    if (key === undefined) return;
    this.byTask.delete(taskId);
    if (this.leases.get(key) === taskId) this.leases.delete(key);
  }
}
