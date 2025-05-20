import { log } from 'console';
import os from 'os';
import path from "path";
import { Worker } from "worker_threads";

const worker_pgline_path = path.resolve(__dirname, 'worker_pgline.js');
const worker_pg_path = path.resolve(__dirname, 'worker_pg.js');
const worker_postgres_path = path.resolve(__dirname, 'worker_postgres.js');
const TOTAL_TASKS = 1000;

const WORKER_COUNT = 3;


console.log('postgres\n-----')
await measureCpuUsageFor(async () => await benchmark(worker_postgres_path))

log('\n')
await sleep(500);
console.log('pgline\n-----')
await measureCpuUsageFor(async () => await benchmark(worker_pgline_path))

log('\n')
await sleep(500);
console.log('pg\n-----')
await measureCpuUsageFor(async () => await benchmark(worker_pg_path))
process.exit(1)

function benchmark(worker_path: string) {
    return new Promise((resolve, reject) => {
        let taskCounter = 0;
        const workers: Worker[] = [];
        for (let i = 0; i < WORKER_COUNT; i++) {
            const worker = new Worker(worker_path);

            worker.on('message', (msg) => {
                if (msg === 'request_task') {
                    if (taskCounter < TOTAL_TASKS) {
                        worker.postMessage({ taskId: taskCounter++ });
                    } else {
                        worker.postMessage({ done: true });
                        resolve(1)
                    }
                }
            });

            worker.on('exit', () => {

            });

            workers.push(worker);
        }

    })
}

async function measureCpuUsageFor<T>(fn: () => Promise<T>): Promise<T> {
    const startCpu = process.cpuUsage();   // CPU 时间（微秒）
    const startTime = process.hrtime();    // 墙钟时间（[s, ns]）

    const result = await fn();             // 执行你的函数

    const elapsedCpu = process.cpuUsage(startCpu);
    const elapsedTime = process.hrtime(startTime);

    const elapsedMs = elapsedTime[0] * 1000 + elapsedTime[1] / 1e6;
    const totalCpuMs = (elapsedCpu.user + elapsedCpu.system) / 1000;

    const cpuUsagePercent = (totalCpuMs / (elapsedMs * os.cpus().length)) * 100;

    console.log(`Wall time: ${elapsedMs.toFixed(2)} ms`);
    console.log(`CPU time: ${totalCpuMs.toFixed(2)} ms`);
    console.log(`Estimated CPU usage: ${cpuUsagePercent.toFixed(2)}%`);

    return result;
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}