// Padre que lanza el driver real y espera; la prueba lo mata con SIGKILL y comprueba que el hijo también termina.
import { Child, siblingModule } from '../../src/ipc.ts';

const driverPath = siblingModule(new URL('../../src/ipc.ts', import.meta.url).href, 'driver');
const child = Child.spawn(driverPath);
console.log(`child:${child.proc.pid}`);
setInterval(() => {}, 1_000);
