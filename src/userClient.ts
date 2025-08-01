import net from 'node:net';
import { typeParsers, type Query, type QueryBatch, type QueryResult, type Row, type UIQuery } from './types.js';
import { createBindMessage, createDescribeMessage, createExecuteMessage, createPrepareMessage, createQueryMessage, genPGTypesFromValues, genStatementNameFromText, parseCommandComplete, parseErrorResponse } from './utils.js';

let rowNameInfoCache = new Map<string, string[]>()
let rowTypeInfoCache = new Map<string, number[]>()
let rowNames: string[] = []
let rowTypes: number[] = [];
let queryCompleted = 0
let commandResultRows: Row[] = []

const syncBuffer = Buffer.alloc(5);
syncBuffer[0] = 0x53; // 'S' for Sync
syncBuffer.writeInt32BE(4, 1);


export class UserClient {
    private socket: net.Socket;
    private queryBatches: QueryBatch[] = []
    private preparedStatementNames: string[] = []

    private isRunningPendingQueries = false
    private isRunningTransaction = false
    private pendingQueries: Query[] = []
    private pendingQueryGroups: Query[][] = []
    private bufferOffset = 0
    private queryIndex = 0
    private buffer: Buffer = Buffer.alloc(0); // Add this line to your class properties


    private responseBuffer: Buffer[] = []
    private isProcessingBuffer = false
    constructor(socket: net.Socket) {
        this.socket = socket;
        this.setupDataHandler(); // Setup the main handler immediately
    }

    public query(text: string, values?: any[]): Promise<QueryResult> {
        if (values?.includes(undefined)) {
            throw new Error("query values contains undefined");
        }
        if (!text.endsWith(';')) {
            text += ';'
        }
        return new Promise(async (resolve, reject) => {
            this.pendingQueries.push({
                resolve, reject, text, values: values ?? [], type: 'DML',
            })
            // make sure only one runAllPendingQueries is running
            if (!this.isRunningPendingQueries) {
                this.isRunningPendingQueries = true
                await this.runAllPendingQueries()
            }
        })
    }

    private async runAllPendingQueries() {
        // wait a round for more pending queries
        await Promise.resolve();
        if (!this.pendingQueries.length && !this.pendingQueryGroups.length) {
            this.isRunningPendingQueries = false
            return
        }
        if (this.pendingQueries.length) {
            let queries = [...this.pendingQueries]
            this.pendingQueries = []
            await this.addBatch(queries)
        }
        if (this.pendingQueryGroups.length) {
            let groups = [...this.pendingQueryGroups]
            this.pendingQueryGroups = []
            for (let group of groups) {
                await this.addBatch(group)
            }
        }
        await this.runAllPendingQueries()
    }

    private addQuery(group: Query[], text: string, values: any[] = []): Promise<QueryResult> {
        return new Promise(async (resolve, reject) => {
            group.push({
                resolve, reject, text, values: values ?? [], type: 'DML',
            })
        })
    }

    // transaction
    public begin(queries: UIQuery[]) {
        if (!queries.length) {
            return []
        }
        let group: Query[] = []
        let ps: Promise<QueryResult>[] = []
        this.addQuery(group, 'BEGIN')
        this.addQuery(group, 'ROLLBACK')
        for (let query of queries) {
            ps.push(this.addQuery(group, query.text, query.values))
        }
        this.addQuery(group, 'COMMIT')
        this.pendingQueryGroups.push(group)
        if (!this.isRunningPendingQueries) {
            this.isRunningPendingQueries = true
            this.runAllPendingQueries()
        }
        return Promise.all(ps)
    }

    private prepareStatement(name: string, query: Query) {
        let pgTypes = genPGTypesFromValues(query.values ?? [])
        return new Promise((resolve, reject) => {
            const prepareMessage = createPrepareMessage(name, query.text, pgTypes);
            this.queryBatches.push({
                queries: [{
                    type: 'prepare',
                    resolve,
                    text: query.text,
                    reject
                }]
            })
            this.socket.write(prepareMessage);
            this.socket.write(syncBuffer);
        });
    }

    private setupDataHandler() {
        this.socket.on('data', (data) => {
            if (this.bufferOffset > 0) {
                if (this.buffer.length == this.bufferOffset) {
                    this.buffer = data
                } else {
                    this.buffer = Buffer.concat([this.buffer.subarray(this.bufferOffset), data]);
                }
                this.bufferOffset = 0
            } else {
                this.buffer = Buffer.concat([this.buffer, data]);
            }
            let rowObject: any = {}
            while (this.bufferOffset < this.buffer.length) {
                if (this.bufferOffset + 5 > this.buffer.length) {
                    break;
                }
                const currentBatch = this.queryBatches[0]
                if (!this.queryBatches.length) {
                    this.buffer = Buffer.alloc(0);
                    return
                }
                const currentQuery = currentBatch.queries[this.queryIndex];
                const messageType = this.buffer[this.bufferOffset];
                const messageLength = this.buffer.readInt32BE(this.bufferOffset + 1);
                const expectedTotalLength = messageLength + 1; // type byte + length field + content

                if (this.bufferOffset + expectedTotalLength > this.buffer.length) {
                    // buffering needed
                    break; // Wait for more data
                }
                const messageContent = this.buffer.subarray(this.bufferOffset, this.bufferOffset + expectedTotalLength);
                // const messageTypeName = MESSAGE_TYPES[messageType] || `Unknown(0x${messageType.toString(16)})`;
                // console.log(messageTypeName)
                // console.log('messageType:', messageType.toString(16), MESSAGE_TYPES[messageType], this.queryIndex, currentQuery?.statementName)
                switch (messageType) {
                    case 0x52: // Authentication - Handled during connect
                    case 0x4B: // BackendKeyData
                    case 0x53: // ParameterStatus
                        // console.log(`Ignoring ${messageTypeName} in main handler`);
                        break;

                    case 0x32: // BindComplete
                        // console.log(`Received ${messageTypeName}`);
                        break;

                    case 0x54: // RowDescription
                        rowNames = [];
                        rowTypes = [];
                        const fieldCount = messageContent.readInt16BE(5);
                        let fieldOffset = 7;
                        for (let i = 0; i < fieldCount; i++) {
                            const fieldNameEnd = messageContent.indexOf(0, fieldOffset);
                            const fieldName = messageContent.toString('utf8', fieldOffset, fieldNameEnd);
                            rowNames.push(fieldName);

                            fieldOffset = fieldNameEnd + 1;

                            fieldOffset += 6; // skip tableOID(4) + columnAttrNum(2)

                            const dataTypeOID = messageContent.readUInt32BE(fieldOffset);
                            rowTypes.push(dataTypeOID);

                            fieldOffset += 12; // skip dataTypeOID(4) + dataTypeSize(2) + typeModifier(4) + formatCode(2)
                        }
                        if (currentQuery.statementName) {
                            rowNameInfoCache.set(currentQuery.statementName, rowNames)
                            rowTypeInfoCache.set(currentQuery.statementName, rowTypes)
                        }
                        break;

                    case 0x44: { // DataRow
                        if (currentQuery.statementName) {
                            let rowNameInfo = rowNameInfoCache.get(currentQuery.statementName)
                            if (rowNameInfo) {
                                rowNames = rowNameInfo
                            }
                            let rowTypenfo = rowTypeInfoCache.get(currentQuery.statementName)
                            if (rowTypenfo) {
                                rowTypes = rowTypenfo
                            }
                        }

                        const fieldCount = messageContent.readInt16BE(5);
                        let fieldOffset = 7; // 1(type) + 4(len) + 2(fieldCount)

                        for (let i = 0; i < fieldCount; i++) {
                            if (fieldOffset + 4 > messageContent.length) {
                                // This indicates a malformed DataRow message
                                console.error('Malformed DataRow: not enough bytes for field length');
                                // Error handling strategy: reject current query, clear buffer, break batch?
                                // For now, just log and break this message parsing.
                                break;
                            }
                            const fieldLength = messageContent.readInt32BE(fieldOffset);
                            fieldOffset += 4;

                            if (fieldLength === -1) {
                                if (rowNames[i]) {
                                    rowObject[rowNames[i]] = null;
                                }
                            } else {
                                if (fieldOffset + fieldLength > messageContent.length) {
                                    // This indicates a malformed DataRow message
                                    console.error('Malformed DataRow: not enough bytes for field value');
                                    // Error handling strategy: reject current query, clear buffer, break batch?
                                    // For now, just log and break this message parsing.
                                    break;
                                }

                                if (rowNames[i]) {
                                    const raw = messageContent.toString('utf8', fieldOffset, fieldOffset + fieldLength);
                                    const parser = typeParsers[rowTypes[i]];
                                    // Use the parser if available, otherwise use the raw string
                                    rowObject[rowNames[i]] = parser ? parser(raw) : raw;
                                }
                                fieldOffset += fieldLength;
                            }
                        }
                        commandResultRows.push(rowObject)
                        rowObject = {} // Reset for the next row
                        break;
                    }

                    case 0x43: // CommandComplete
                        {
                            queryCompleted++
                            currentQuery.resolve({
                                type: currentBatch.queries[this.queryIndex].type,
                                success: true,
                                message: parseCommandComplete(messageContent),
                                rows: commandResultRows
                            })
                            this.queryIndex++
                            commandResultRows = []
                            break;
                        }
                    case 0x31: // ParseComplete
                        {
                            if (currentBatch && currentBatch.queries[this.queryIndex] && currentBatch.queries[this.queryIndex].type === 'prepare') {
                                queryCompleted++
                                currentBatch.queries[this.queryIndex].resolve({
                                    type: currentBatch.queries[this.queryIndex].type,
                                    success: true,
                                    message: 'Parse Complete',
                                    rows: []
                                })
                                this.queryIndex++ // Move to the next query in the current batch
                                commandResultRows = [] // Reset for the next query
                            } else {
                                console.warn(`Received unexpected ParseComplete for query type: ${currentQuery ? currentQuery.type : 'unknown'}`);
                            }
                            break;
                        }

                    case 0x45: { // Error
                        let pgError = parseErrorResponse(messageContent)
                        currentQuery.reject(pgError)
                        // remaining of this batch skipped
                        for (let [k, query] of currentBatch.queries.entries()) {
                            if (k > this.queryIndex) {
                                query.resolve({
                                    type: currentBatch.queries[this.queryIndex].type,
                                    success: false,
                                    message: 'skipped due to error of other query in this batch',
                                    rows: []
                                })
                            }
                        }
                        break;
                    }

                    case 0x5A: { // ReadyForQuery
                        // this batch finished
                        this.queryIndex = 0
                        // batch resolved when finished prepared statement
                        // if (typeof currentBatch.resolve == 'function') {
                        //     currentBatch.resolve(1)
                        // }
                        this.queryBatches.splice(0, 1)
                        break;
                    }

                    default: {
                        // console.log(`Ignoring message type: ${messageTypeName}`);
                    }
                }
                this.bufferOffset += expectedTotalLength; // Move to the next message
            } // end while loop
        })
    }

    private addBatch(queries: Query[]) {
        // if (queries.length > 10) {
        //     console.log(`sending ${queries.length} queries in a batch`)
        // }
        return new Promise(async (resolve, reject) => {
            // check prepared statement
            for (let query of queries) {
                if (query.values) {
                    query.statementName = genStatementNameFromText(query.text)
                    if (!this.preparedStatementNames.includes(query.statementName)) {
                        // auto create prepared statement
                        try {
                            this.preparedStatementNames.push(query.statementName)
                            // should await preparedstatement finished before sending related queries
                            await this.prepareStatement(query.statementName, query);
                        } catch (msg) {
                            console.log('err creating statement: ', query.statementName, msg, "end of err>")
                        }
                    }
                }
            }
            // send queries
            const toServerBuffers: Buffer[] = [];
            for (let query of queries) {
                if (!query.values) {
                    const queryMessage = createQueryMessage(query.text);
                    // this.socket.write(queryMessage);
                    toServerBuffers.push(queryMessage);
                }
                else {
                    // bind
                    const bindMessage = createBindMessage('', query.statementName || '', query.values || []);
                    // this.socket.write(bindMessage);
                    toServerBuffers.push(bindMessage);
                    if (query.statementName && !rowNameInfoCache.has(query.statementName)) {
                        rowNameInfoCache.set(query.statementName, [])
                        // call row des
                        const describeMessage = createDescribeMessage('P', '');
                        // this.socket.write(describeMessage);
                        toServerBuffers.push(describeMessage);
                    }

                    // execute
                    const executeMessage = createExecuteMessage('', 0);
                    // this.socket.write(executeMessage);
                    toServerBuffers.push(executeMessage);
                }
            }
            let thisBatch: QueryBatch = {
                reject,
                queries
            }
            this.queryBatches.push(thisBatch)
            toServerBuffers.push(syncBuffer);
            this.socket.write(Buffer.concat(toServerBuffers));
            // this.sendSyncMsg()
            resolve(1)
        });
    }
}
