import { parentPort } from "node:worker_threads";
import { connectPG } from "./pg.js";
import type { UserClient } from "./userClient.js";
import { parsePostgresUrl } from "./utils.js";

let client: UserClient

export async function pgline(url: string) {
    let dbInfo = parsePostgresUrl(url)
    let userClient = await connectPG(
        dbInfo.host,
        dbInfo.port,
        dbInfo.user,
        dbInfo.pass,
        dbInfo.db
    );
    return userClient
}

parentPort?.on("message", async (data: any) => {
    switch (data.type) {
        case 'connect':
            let dbInfo = parsePostgresUrl(data.url)
            try {
                client = await connectPG(
                    dbInfo.host,
                    dbInfo.port,
                    dbInfo.user,
                    dbInfo.pass,
                    dbInfo.db
                );
                parentPort?.postMessage({ type: 'connect', success: true })
            } catch (e: any) {
                parentPort?.postMessage({ type: 'connect', success: false, message: e.message })
            }
            break;
        case 'query':
            try {
                let r = await client.query(data.text, data.values)
                parentPort?.postMessage({ id: data.id, type: 'query', success: true, result: r })
            } catch (e: any) {
                parentPort?.postMessage({ id: data.id, type: 'query', success: false, message: e.message })
            }
            break;
    }
})