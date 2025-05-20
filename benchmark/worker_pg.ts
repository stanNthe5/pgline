import { log } from "console";
import dotenv from 'dotenv';
import { Pool } from "pg";
import { parentPort } from "worker_threads";

dotenv.config();

const CONCURRENCY = 100;

if (!process.env.PG_URL) {
    log("process.env.PG_URL not defined");
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.PG_URL,
    max: 5,
    min: 2,
});

function requestTask() {
    parentPort?.postMessage('request_task');
}

parentPort?.on('message', async (msg) => {
    if (msg.done) {
        await pool.end();
        process.exit(0);
    } else if (typeof msg.taskId === 'number') {
        await runQueries();
        requestTask();
    }
});

requestTask();

async function runQueries() {
    const queries: Promise<any>[] = [];

    for (let i = 1; i <= CONCURRENCY; i++) {
        queries.push(pool.query("SELECT * FROM posts WHERE id = $1", [i]));
    }

    try {
        await Promise.all(queries);
    } catch (err) {
        log("Query error:", err);
    }
}
