import crypto from 'node:crypto';
import type { PgErrorFields } from './types.js';

export function createStartupMessage(user: string, database: string): Buffer {
    const params = `user\0${user}\0database\0${database}\0\0`;
    // Protocol version 3.0 = 196608 (0x00030000)
    const protocolVersion = 196608;
    const paramBytes = Buffer.from(params, 'utf8');

    // Length = 4 (length field) + 4 (protocol) + params + 1 (final null, included in paramBytes)
    const length = 4 + 4 + paramBytes.length;
    const buffer = Buffer.alloc(length);

    buffer.writeInt32BE(length, 0);
    buffer.writeInt32BE(protocolVersion, 4);
    paramBytes.copy(buffer, 8);

    return buffer;
}

export function md5Password(user: string, password: string, salt: Buffer): string {
    const md5 = (input: string | Buffer) => crypto.createHash('md5').update(input).digest('hex');
    const hashedPassword = md5(password + user);
    const finalHash = md5(Buffer.concat([Buffer.from(hashedPassword, 'hex'), salt]));
    return `md5${finalHash}`;
}

export function createPasswordMessage(hashedPassword: string): Buffer {
    // Message structure: Type (Implicit 'p') + Length + Password String + Null terminator
    const passwordBytes = Buffer.from(hashedPassword + '\0', 'utf8'); // Add null terminator
    const length = 4 + passwordBytes.length; // Length field includes self (4 bytes)

    const buffer = Buffer.alloc(1 + length); // Type byte + Length field + Password + Null
    let offset = 0;

    buffer[offset++] = 0x70; // 'p'
    buffer.writeInt32BE(length, offset); // Write the length field
    offset += 4;
    passwordBytes.copy(buffer, offset); // Write password + null terminator

    return buffer;
}

// createQueryMessage - Not used for prepared statements, but keep if needed elsewhere
export function createQueryMessage(query: string): Buffer {
    const queryBytes = Buffer.from(query + '\0', 'utf8');
    const length = 4 + queryBytes.length; // Length includes self
    const buffer = Buffer.alloc(1 + length); // 'Q' + length + query + null

    buffer[0] = 0x51; // 'Q'
    buffer.writeInt32BE(length, 1);
    queryBytes.copy(buffer, 5);

    return buffer;
}

// parseDataRow - Logic is now inline in the data handler, keep for reference if needed
// function parseDataRow(messageContent: Buffer): string[] | null { ... }

export function createTerminateMessage(): Buffer {
    const buffer = Buffer.alloc(5);
    buffer[0] = 0x58; // 'X'
    buffer.writeInt32BE(4, 1);
    return buffer;
}

export function parseServerMessage(msg: string): { [key: string]: string } {
    const attrs: { [key: string]: string } = {};
    msg.split(',').forEach(pair => {
        const equalIndex = pair.indexOf('=');
        if (equalIndex > 0) {
            const key = pair.substring(0, equalIndex);
            const value = pair.substring(equalIndex + 1);
            attrs[key] = value;
        }
    });
    return attrs;
}

export function xorBuffers(a: Buffer, b: Buffer): Buffer {
    const length = Math.min(a.length, b.length);
    const result = Buffer.alloc(length);
    for (let i = 0; i < length; i++) {
        result[i] = a[i] ^ b[i];
    }
    return result;
}

export function hmac(key: Buffer, message: string | Buffer): Buffer {
    return crypto.createHmac('sha256', key).update(message).digest();
}

export function parseErrorResponse(errorData: Buffer): PgErrorFields {
    const fields: PgErrorFields = {};
    const codeMap: { [code: string]: keyof PgErrorFields } = {
        S: 'severity',
        C: 'code',
        M: 'message',
        D: 'detail',
        H: 'hint',
        P: 'position',
        p: 'internalPosition',
        q: 'internalQuery',
        W: 'where',
        s: 'schemaName',
        t: 'tableName',
        c: 'columnName',
        d: 'dataTypeName',
        n: 'constraintName',
        F: 'file',
        L: 'line',
        R: 'routine',
    };

    let offset = 5; // 跳过消息类型和长度
    while (offset < errorData.length) {
        const code = errorData[offset];
        if (code === 0) break; // null terminator
        const valueEnd = errorData.indexOf(0, offset + 1);
        if (valueEnd === -1) break;
        const value = errorData.toString('utf8', offset + 1, valueEnd);
        const key = codeMap[String.fromCharCode(code)] ?? String.fromCharCode(code);
        fields[key] = value;
        offset = valueEnd + 1;
    }
    return fields;
}

export function parseErrorResponse2(buffer: Buffer): { [key: string]: string } {
    const fields: { [key: string]: string } = {};
    let offset = 5; // 跳过前5字节：1字节类型(0x45) + 4字节长度

    while (offset < buffer.length) {
        const fieldType = buffer[offset];
        if (fieldType === 0) break; // 0 表示结束
        const fieldName = String.fromCharCode(fieldType);
        const stringEnd = buffer.indexOf(0, offset + 1);
        if (stringEnd === -1) break; // 错误格式
        const value = buffer.toString('utf8', offset + 1, stringEnd);
        fields[fieldName] = value;
        offset = stringEnd + 1;
    }

    return fields;
}


export function createBindMessage(portal: string, statement: string, params: (string | number)[] = []): Buffer {
    const paramValues = params.map(p => {
        if (typeof p === 'number') {
            return Buffer.from(p.toString(), 'utf8');
        }
        return Buffer.from(p.toString(), 'utf8');
    });
    const portalBytes = Buffer.from(portal + '\0', 'utf8');
    const statementBytes = Buffer.from(statement + '\0', 'utf8');

    // Calculate parameter format codes section length
    const paramFormatCodesLength = 2 + (params.length * 2); // count(2) + formats(2 each)

    // Calculate parameter values section length
    const paramValuesLength = 2 + // count(2)
        paramValues.reduce((acc, val) => acc + 4 + val.length, 0); // length(4) + value for each

    // Calculate result format codes section length (1 format code: 0 for text)
    const resultFormatCodesLength = 2 + 2; // count(2) + one format code(2)

    // Calculate total content length (excluding type and length field)
    const messageContentLength = portalBytes.length +
        statementBytes.length +
        paramFormatCodesLength +
        paramValuesLength +
        resultFormatCodesLength;

    // Total buffer length = Type (1) + Length field (4) + Content
    const totalLength = 1 + 4 + messageContentLength;
    const buffer = Buffer.alloc(totalLength);
    let offset = 0;

    // Write message type and length field
    buffer[offset++] = 0x42; // 'B'
    buffer.writeInt32BE(4 + messageContentLength, offset); // Message length including self
    offset += 4;

    // Write portal name
    portalBytes.copy(buffer, offset);
    offset += portalBytes.length;

    // Write statement name
    statementBytes.copy(buffer, offset);
    offset += statementBytes.length;

    // Write parameter format codes (all text format = 0)
    buffer.writeInt16BE(params.length, offset);
    offset += 2;
    for (let i = 0; i < params.length; i++) {
        buffer.writeInt16BE(0, offset); // Text format (0)
        offset += 2;
    }

    // Write parameter values
    buffer.writeInt16BE(params.length, offset);
    offset += 2;
    for (const value of paramValues) {
        buffer.writeInt32BE(value.length, offset);
        offset += 4;
        value.copy(buffer, offset);
        offset += value.length;
    }

    // Write result format codes (requesting all results in text format)
    buffer.writeInt16BE(1, offset); // Number of format codes that follow (1 means apply next code to all)
    offset += 2;
    buffer.writeInt16BE(0, offset); // Text format (0)
    offset += 2; // Move offset correctly

    // console.log('Bind Message Details:',
    //     '\nCalculated Content Length:', messageContentLength,
    //     '\nTotal Buffer Size:', buffer.length,
    //     '\nFinal Offset:', offset, // Should match buffer.length
    //     '\nHex:', buffer.toString('hex'));

    return buffer;
}


export function createDescribeMessage(type: 'S' | 'P', name: string): Buffer {
    const nameBytes = Buffer.from(name + '\0', 'utf8');
    const totalLength = 1 + 4 + 1 + nameBytes.length; // type + length + portal/statement + name+null
    const buffer = Buffer.alloc(totalLength);
    let offset = 0;

    buffer[offset++] = 0x44; // 'D' for Describe
    buffer.writeInt32BE(4 + 1 + nameBytes.length, offset); // Message length
    offset += 4;
    buffer[offset++] = type === 'S' ? 0x53 : 0x50; // 'S' for prepared statement, 'P' for portal
    nameBytes.copy(buffer, offset);

    return buffer;
}

export function createExecuteMessage(portal: string = '', maxRows: number = 0): Buffer {
    const portalBytes = Buffer.from(portal + '\0', 'utf8');
    const portalLength = portalBytes.length;
    const maxRowsLength = 4;

    const messageContentLength = portalLength + maxRowsLength;
    const totalLength = 1 + 4 + messageContentLength; // Type (1) + Length field (4) + Content

    const buffer = Buffer.alloc(totalLength);
    let offset = 0;

    buffer[offset++] = 0x45; // 'E' for Execute
    buffer.writeInt32BE(4 + messageContentLength, offset); // Message length including self
    offset += 4;

    // Write portal name (null-terminated)
    portalBytes.copy(buffer, offset);
    offset += portalLength;

    // Write max rows
    buffer.writeInt32BE(maxRows, offset);
    offset += 4;

    // console.log('Execute Message Details:',
    //     '\nCalculated Content Length:', messageContentLength,
    //     '\nTotal Buffer Size:', buffer.length,
    //     '\nFinal Offset:', offset, // Should match buffer.length
    //     '\nHex:', buffer.toString('hex'));

    return buffer;
}


export function parsePostgresUrl(url: string): {
    host: string;
    user: string;
    pass: string;
    port: number;
    db: string;
} {
    try {
        const parsed = new URL(url);

        if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
            throw new Error("Invalid protocol");
        }

        const host = parsed.hostname;
        const user = parsed.username;
        const pass = parsed.password;
        const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
        const db = parsed.pathname.replace(/^\/+/, "");

        if (!host || !user || !pass) {
            throw new Error("Missing required components in URL");
        }

        if (isNaN(port)) {
            throw new Error("Invalid port number");
        }

        return { host, user, pass, port, db };
    } catch (err) {
        throw new Error(`Failed to parse PostgreSQL URL: ${(err as Error).message}`);
    }
}

export function genStatementNameFromText(str: string) {
    return crypto.createHash('md5').update(str).digest('hex').substring(0, 8);
}

export function genPGTypesFromValues(values: any[]) {
    const oids: number[] = []

    for (let value of values) {
        if (value === null || value === undefined) {
            oids.push(25)
            continue
        }

        if (typeof value === 'boolean') {
            oids.push(16) // bool
        } else if (typeof value === 'number') {
            if (Number.isInteger(value)) {
                if (value > 2_147_483_647) {
                    oids.push(20) // int8
                } else {
                    oids.push(23) // int4
                }
            } else {
                oids.push(701) // float8
            }
        } else if (typeof value === 'string') {
            oids.push(25) // text
        } else if (value instanceof Date) {
            oids.push(1114) // timestamp (without time zone)
        } else if (Buffer.isBuffer(value)) {
            oids.push(17) // bytea
        } else {
            oids.push(25)
        }
    }

    return oids
}

export function parseCommandComplete(messageBuffer: Buffer) {
    const content = messageBuffer.subarray(5); // 跳过长度字段
    const nullTerminatorIndex = content.indexOf(0); // 找到 null 结尾
    const resultString = content.subarray(0, nullTerminatorIndex).toString('utf8');
    return resultString; // 如 "INSERT 0 1"
}

export function createPrepareMessage(name: string, query: string, paramTypes: number[] = []): Buffer {
    // Length calculation includes: name + null + query + null + param_count + param_types
    const nameBytes = Buffer.from(name + '\0', 'utf8');
    const queryBytes = Buffer.from(query + '\0', 'utf8');
    const paramTypesLength = 2 + (paramTypes.length * 4);

    const messageContentLength = nameBytes.length + queryBytes.length + paramTypesLength;
    const totalLength = 1 + 4 + messageContentLength; // type + length_field + content
    const buffer = Buffer.alloc(totalLength);
    let offset = 0;

    buffer[offset++] = 0x50; // 'P' for Parse
    buffer.writeInt32BE(4 + messageContentLength, offset); // Length field (size of content + self)
    offset += 4;
    nameBytes.copy(buffer, offset); // Statement name + null
    offset += nameBytes.length;
    queryBytes.copy(buffer, offset); // Query string + null
    offset += queryBytes.length;
    buffer.writeInt16BE(paramTypes.length, offset); // Number of parameter types
    offset += 2;

    for (const type of paramTypes) {
        buffer.writeInt32BE(type, offset);
        offset += 4;
    }

    return buffer;
}