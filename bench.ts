import { pgline } from "./src/index.ts";

const CONCURRENCY = 100; // concurrency
const QUERY_COUNT = 10000; // total queries
const QUERY_SQL = "select * from posts where id=$1";

async function main() {
    const client = await pgline('postgresql://stan:stan@localhost:5432/sns');
    const tasks: Promise<any>[] = [];

    const start = Date.now();

    for (let i = 0; i < QUERY_COUNT; i++) {
        // limit concurrency
        if (tasks.length >= CONCURRENCY) {
            await Promise.race(tasks);
        }

        const p = client.query(QUERY_SQL, ['IQKo8TD'])
            .then(res => res.rows[0])
            .catch(err => {
                console.error(`Query ${i} failed:`, err);
            });

        tasks.push(p);

        // remove finished promise
        p.finally(() => {
            const index = tasks.indexOf(p);
            if (index !== -1) tasks.splice(index, 1);
        });
    }

    // wait all
    await Promise.allSettled(tasks);

    const duration = Date.now() - start;
    console.log(`Executed ${QUERY_COUNT} queries in ${duration}ms`);
}

main().catch(console.error);
