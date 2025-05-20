// import path from "node:path";
// import { Worker } from "node:worker_threads";
// const worker = new Worker(path.join(__dirname, 'worker.js'));
import { connectPG } from "./pg.js";
import { parsePostgresUrl } from "./utils.js";
// let connected = false
// let connectResponse: { resolve?: any, reject?: any } = {}
// export function multiThreadConn(url: string): Promise<Client> {
//     return new Promise((resolve, reject) => {
//         connectResponse = { resolve, reject }
//         worker.postMessage({ type: 'connect', url })
//     })
// }

// type Client = { query: (text: string, values: any[]) => Promise<any> }

// let queryMap: Map<number, { resolve: any, reject: any }> = new Map()
// let seq = 0

// let pendingQueries: any[] = []

// export function Query(text: string, values: any[]) {
//     if (!connected) {
//         return { success: false, message: 'not connectec' }
//     }
//     seq++
//     return new Promise((resolve, reject) => {
//         queryMap.set(seq, { resolve, reject })
//         worker.postMessage({ id: seq, type: 'query', text, values })
//     })
// }

// function postQueries() {

// }

// // connect
// worker?.on("message", async (data: any) => {
//     switch (data.type) {
//         case 'connect':
//             if (data.success) {
//                 connected = true
//                 connectResponse.resolve({ query: Query })
//                 console.log('connected successfully')
//             } else {
//                 connectResponse.reject(data.message)
//                 console.log('connect fail:', data.message)
//             }
//             break;
//         case 'query':
//             let q = queryMap.get(data.id)
//             if (!q) {
//                 break
//             }
//             if (data.success) {
//                 q.resolve(data.result)
//             } else {
//                 q.reject(data.message)
//             }
//             queryMap.delete(data.id)
//             break;
//     }
// })

export default async function pgline(url: string) {
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

