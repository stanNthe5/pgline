export let MESSAGE_TYPES: { [k: number]: string } = {
    0x52: 'Authentication',        // 'R'
    0x42: 'Bind',                  // 'B'
    0x32: 'BindComplete',          // '2'
    0x43: 'CommandComplete',       // 'C'
    0x44: 'DataRow',               // 'D'
    0x45: 'ErrorResponse',         // 'E'
    0x46: 'CopyFail',              // 'f'
    0x47: 'CopyInResponse',        // 'G'
    0x48: 'CopyOutResponse',       // 'H'
    0x49: 'EmptyQueryResponse',    // 'I'
    0x4B: 'BackendKeyData',        // 'K'
    0x4C: 'CopyData',              // 'd'
    0x4E: 'NoticeResponse',        // 'N'
    0x50: 'Parse',                 // 'P'
    0x31: 'ParseComplete',         // '1'
    0x58: 'CloseComplete',         // '3'
    0x53: 'ParameterStatus',       // 'S'
    0x5A: 'ReadyForQuery',         // 'Z'
    0x54: 'RowDescription',        // 'T'
    0x70: 'PasswordMessage',       // 'p'
    0x51: 'Query',                 // 'Q'
    0x6E: 'NoData',                // 'n'
    0x74: 'ParameterDescription',  // 't'
    0x56: 'FunctionCall',          // 'F'
    0x6B: 'PortalSuspended',       // 's'
    0x6D: 'CopyBothResponse',      // 'W' (used in replication)
};

export type BatchPromise = {
    resolve: (results: QueryResult[]) => void, // Resolves with array of result sets
    reject: (error: any) => void,
    queryCount: number // Track how many queries this batch expects results for
    tmpResults: QueryResult[]
}

type queryType = 'DML' | 'prepare' | 'bind' | 'execute' | 'describe'
export type QueryResult = {
    type: queryType,
    success: boolean,
    message: string,
    rows: any[]
}


export type Query = {
    type: queryType;
    text: string;
    values?: any[];
    resolve: (result: QueryResult) => void;
    reject: (err: any) => void;
    statementName?: string;
    result?: any;
};

export type QueryBatch = {
    queries: Query[];
    reject?: any;
};


export type PgErrorFields = {
    severity?: string;      // S
    code?: string;          // C
    message?: string;       // M
    detail?: string;        // D
    hint?: string;          // H
    position?: string;      // P
    internalPosition?: string; // p
    internalQuery?: string; // q
    where?: string;         // W
    schemaName?: string;    // s
    tableName?: string;     // t
    columnName?: string;    // c
    dataTypeName?: string;  // d
    constraintName?: string;// n
    file?: string;          // F
    line?: string;          // L
    routine?: string;       // R
    [key: string]: string | undefined; // fallback for unknown fields
};

export type Row = { [k: string]: any }

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER); // 9007199254740991n
const MIN_SAFE = BigInt(Number.MIN_SAFE_INTEGER); // -9007199254740991n


export const typeParsers: { [oid: number]: (val: string) => any } = {
    16: val => val === 't',                         // boolean
    20: val => {                                    // int8
        const big = BigInt(val);
        if (big <= MAX_SAFE && big >= MIN_SAFE) {
            return Number(big);
        } else {
            return big;
        }
    },
    21: val => parseInt(val, 10),                   // int2
    23: val => parseInt(val, 10),                   // int4
    700: val => parseFloat(val),                    // float4
    701: val => parseFloat(val),                    // float8
    1700: val => parseFloat(val),                   // numeric
    1082: val => val,                               // date
    1114: val => val,                               // timestamp
    114: val => JSON.parse(val),                    // json
    3802: val => JSON.parse(val),                   // jsonb
};