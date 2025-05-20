import { log } from "console";
import dotenv from 'dotenv';
import postgres from "postgres";
import { parentPort } from "worker_threads";
dotenv.config();
if (!process.env.PG_URL) {
    log("process.env.PG_URL not defined")
    process.exit(1)
}
const sql = postgres(process.env.PG_URL)
const CONCURRENCY = 100; // concurrency

// make connection ready
await sql`select * from posts where id=1`

function requestTask() {
    parentPort?.postMessage('request_task');
}

parentPort?.on('message', async (msg) => {
    if (msg.done) {
        process.exit(0);
    } else if (typeof msg.taskId === 'number') {
        await runQueries()
        requestTask();
    }
});

requestTask()

async function runQueries() {
    const queries: Promise<any>[] = [];

    for (let i = 1; i <= CONCURRENCY; i++) {
        queries.push(sql`select * from posts where id=${i}`)// promise
    }
    try {
        await Promise.all(queries);
    } catch (err) {
        log("Query error:", err);
    }
}

