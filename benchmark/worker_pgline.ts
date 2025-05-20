import { log } from "console";
import dotenv from 'dotenv';
import pgline from "pgline";
import { parentPort } from "worker_threads";
dotenv.config();

const CONCURRENCY = 100; // concurrency
if (!process.env.PG_URL) {
    log("process.env.PG_URL not defined")
    process.exit(1)
}
const client = await pgline(process.env.PG_URL);
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
        queries.push(client.query("select * from posts where id=$1", [i]))// promise
    }
    try {
        await Promise.all(queries);
    } catch (err) {
        log("Query error:", err);
    }
}

