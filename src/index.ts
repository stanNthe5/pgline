import { connectPG } from "./pg.js";
import { parsePostgresUrl } from "./utils.js";

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

