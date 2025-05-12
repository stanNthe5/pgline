import net from 'net';
import crypto from 'node:crypto';
import { UserClient } from './userClient.js';
import { createPasswordMessage, createStartupMessage, hmac, md5Password, parseErrorResponse, parseServerMessage, xorBuffers } from './utils.js';



export function connectPG(host: string, port: number, user: string, password: string, database: string): Promise<UserClient> {
    const socket = new net.Socket();

    // Create UserClient immediately, it sets up the main data handler
    const userClient = new UserClient(socket);

    return new Promise((resolve, reject) => {
        let authenticated = false;

        socket.connect(port, host, () => {
            const startupMessage = createStartupMessage(user, database);
            socket.write(startupMessage);
        });

        // Temporary handler for authentication phase
        const authHandler = async (data: Buffer) => {
            let offset = 0;
            while (offset < data.length) {
                if (offset + 5 > data.length) break; // Need type + length

                const messageType = data[offset];
                const messageLength = data.readInt32BE(offset + 1);
                const expectedTotalLength = messageLength + 1;

                if (offset + expectedTotalLength > data.length) break; // Need full message

                const messageContent = data.subarray(offset, offset + expectedTotalLength);
                // const messageTypeName = MESSAGE_TYPES[messageType] || `Unknown(0x${messageType.toString(16)})`;
                // console.log(`Auth phase received: ${messageTypeName}`);

                switch (messageType) {
                    case 0x52: { // Authentication request
                        // console.log('messageContent.length', messageContent.length);
                        if (messageContent.length < 9) break; // Need auth type
                        const authType = messageContent.readInt32BE(5);
                        // console.log('Authentication type:', authType);

                        switch (authType) {
                            case 5: { // MD5 password authentication
                                if (messageContent.length < 13) break; // Need salt
                                const salt = messageContent.subarray(9, 13);
                                // console.log('Salt:', salt);
                                const hashedPassword = md5Password(user, password, salt);
                                const passwordMessage = createPasswordMessage(hashedPassword);
                                socket.write(passwordMessage);
                                break;
                            }
                            case 10: { // SCRAM-SHA-256 Start
                                handleScramAuthenticationStart(user, socket);
                                break;
                            }
                            case 11: { // SCRAM-SHA-256 Continue
                                handleScramContinue(messageContent, socket, password);
                                break;
                            }
                            case 12: { // SCRAM-SHA-256 Final
                                if (handleServerFinalMessage(messageContent, socket)) {
                                    // SCRAM Success will lead to Auth OK (type 0)
                                } else {
                                    // SCRAM failure
                                    socket.removeListener('data', authHandler);
                                    reject(new Error("SCRAM Server Signature Verification Failed"));
                                    socket.end();
                                    return; // Stop processing
                                }
                                break;
                            }
                            case 0: { // Authentication successful!
                                authenticated = true;
                                // Authentication done, remove this specific handler
                                socket.removeListener('data', authHandler);
                                // UserClient's main handler is already attached and will take over
                                resolve(userClient);
                                // Don't break the inner switch, let the outer loop continue if data remains
                                break;
                            }
                            default:
                                socket.removeListener('data', authHandler);
                                reject(new Error(`Unsupported authentication method: ${authType}`));
                                socket.end();
                                return; // Stop processing
                        }
                        break; // case 0x52
                    }
                    // Handle ParameterStatus, BackendKeyData, etc., that might arrive before ReadyForQuery
                    case 0x53: // ParameterStatus
                    case 0x4B: // BackendKeyData
                        // console.log(`Ignoring ${messageTypeName} during auth`);
                        break;
                    case 0x45: { // Error during auth
                        const errorFields = parseErrorResponse(messageContent.subarray(5));
                        console.error('Authentication Error:', errorFields);
                        socket.removeListener('data', authHandler);
                        reject(new Error(errorFields.M || 'Authentication failed'));
                        socket.end();
                        return; // Stop processing
                    }
                    case 0x5A: { // ReadyForQuery
                        // If we get RFQ and are authenticated, we are truly ready.
                        // This might happen after Auth OK (type 0) in the same buffer.
                        if (authenticated) {
                            // console.log('Received Ready For Query after Auth OK.');
                            // Resolve might have already happened in Auth OK case,
                            // but calling resolve multiple times is okay for Promises.
                            socket.removeListener('data', authHandler); // Ensure cleanup
                            resolve(userClient);
                        } else {
                            // RFQ before Auth OK? Unexpected.
                            console.warn("Received ReadyForQuery before Authentication OK signal.");
                        }
                        break;
                    }
                    default:
                        // Ignore other messages during auth phase
                        // console.log(`Ignoring message ${messageTypeName} during auth`);
                        break;
                }
                offset += expectedTotalLength;
                if (authenticated) break; // Stop processing buffer with authHandler once done
            }
        };

        socket.on('data', authHandler);

        socket.on('error', (err) => {
            console.error('Connection error:', err);
            socket.removeListener('data', authHandler); // Clean up listener
            reject(err); // Reject the main promise on connection error
        });

        socket.on('close', () => {
            console.log('Connection closed');
            // If connection closes before authentication resolve, reject.
            if (!authenticated) {
                socket.removeListener('data', authHandler); // Clean up listener
                reject(new Error("Connection closed before authentication completed."));
            }
        });
    });
}


// SCRAM needs state stored between messages, attach it to the client socket object
interface ClientWithScram extends net.Socket {
    scram?: {
        clientNonce: string;
        clientFirstMessageBare: string;
        expectedServerSignature?: string;
    }
}

// SCRAM handling split into multiple functions for clarity

function handleScramAuthenticationStart(user: string, client: ClientWithScram) {
    // Start SCRAM
    const clientNonce = crypto.randomBytes(18).toString('base64');
    const clientFirstMessageBare = `n=${user},r=${clientNonce}`;
    const clientFirstMessage = `n,,${clientFirstMessageBare}`; // gs2-header "n," + sasl-mech-specific-part ",," + client-first-message-bare

    // Store nonce and bare message for later steps
    client.scram = { clientNonce, clientFirstMessageBare };

    // SASLInitialResponse message
    const mechanismName = 'SCRAM-SHA-256\0'; // Must be null-terminated
    const clientFirstMessageBytes = Buffer.from(clientFirstMessage, 'utf8');
    const clientFirstMessageLength = clientFirstMessageBytes.length;

    // Message structure: 'p' + Length + Mechanism Name + ClientInitialResponse Length + ClientInitialResponse
    const mechanismNameLength = Buffer.byteLength(mechanismName); // Includes null
    const totalContentLength = mechanismNameLength + 4 + clientFirstMessageLength;
    const buffer = Buffer.alloc(1 + 4 + totalContentLength);
    let offset = 0;

    buffer[offset++] = 0x70; // 'p' (PasswordMessage used for SASLInitialResponse)
    buffer.writeInt32BE(4 + totalContentLength, offset); // Total length field
    offset += 4;
    buffer.write(mechanismName, offset); // Write mechanism name WITH null terminator
    offset += mechanismNameLength;
    buffer.writeInt32BE(clientFirstMessageLength, offset); // Length of initial response
    offset += 4;
    clientFirstMessageBytes.copy(buffer, offset); // Write initial response

    // console.log('Sending initial SASL message (SCRAM Start)');
    client.write(buffer);
}

function handleScramContinue(data: Buffer, client: ClientWithScram, password: string) {
    // Server sent SASLContinue (Auth type 11)
    const messageLength = data.readUInt32BE(1);
    const authDataLength = messageLength - 8; // -4 for type, -4 for auth type field
    const serverFirstMessage = data.subarray(9, 9 + authDataLength).toString('utf8');
    // console.log("Received Server First Message (SASLContinue):", serverFirstMessage);

    const attrs = parseServerMessage(serverFirstMessage);

    if (!client.scram || !client.scram.clientNonce) {
        console.error('SCRAM error: Client nonce not found');
        client.end();
        return;
    }

    // Verify server nonce prefix
    if (!attrs.r?.startsWith(client.scram.clientNonce)) {
        console.error('Server nonce validation failed', attrs.r, client.scram.clientNonce);
        client.end();
        return;
    }
    // console.log('Client nonce prefix verified.');

    if (!attrs.s || !attrs.i) {
        console.error('Invalid server first message (missing salt or iterations):', serverFirstMessage);
        client.end();
        return;
    }
    // console.log('Got server salt and iterations.');

    // Generate client-final-message
    const { clientFinalMessage, serverSignature } = generateClientFinalMessage(
        client.scram.clientNonce,
        client.scram.clientFirstMessageBare, // Use the stored bare message
        serverFirstMessage,                 // Use the received server first message
        password,
        attrs // Pass parsed attributes for salt and iterations
    );

    // Store expected server signature for the final check
    client.scram.expectedServerSignature = serverSignature;

    // Send client-final-message via SASLResponse ('p' message)
    const clientFinalBytes = Buffer.from(clientFinalMessage, 'utf8');
    const clientFinalLength = clientFinalBytes.length;
    const finalBuffer = Buffer.alloc(1 + 4 + clientFinalLength); // 'p' + Length + Data

    finalBuffer[0] = 0x70; // 'p' for SASLResponse
    finalBuffer.writeInt32BE(4 + clientFinalLength, 1); // Length field
    clientFinalBytes.copy(finalBuffer, 5); // Data

    // console.log('Sending client final message (SASLResponse)');
    client.write(finalBuffer);
}


function handleServerFinalMessage(data: Buffer, client: ClientWithScram): boolean {
    // Server sent SASLFinal (Auth type 12)
    const messageLength = data.readUInt32BE(1);
    const authDataLength = messageLength - 8;
    const serverFinalMessage = data.subarray(9, 9 + authDataLength).toString('utf8');
    // console.log("Received Server Final Message (SASLFinal):", serverFinalMessage);

    const attrs = parseServerMessage(serverFinalMessage);

    // Get the expected signature calculated in the previous step
    const expectedServerSignature = client.scram?.expectedServerSignature;

    if (!expectedServerSignature) {
        console.error("SCRAM Error: Expected server signature not found.");
        return false;
    }

    // Verify server signature
    if (attrs.v === expectedServerSignature) {
        // console.log('SCRAM Server Signature VERIFIED!');
        // Authentication continues, expect AuthenticationOk (type 0) next
        return true;
    } else {
        console.error('Server signature verification FAILED!');
        console.error(' Received: ', attrs.v);
        console.error(' Expected: ', expectedServerSignature);
        return false;
    }
}

function generateClientFinalMessage(
    clientNonce: string,
    clientFirstMessageBare: string, // Pass this in
    serverFirstMessage: string,    // Pass this in
    password: string,
    serverAttrs: { [key: string]: string } // Pass parsed attrs
): { clientFinalMessage: string; serverSignature: string } {

    const serverNonce = serverAttrs.r; // Full server nonce
    const salt = serverAttrs.s;
    const iterations = parseInt(serverAttrs.i, 10);

    const saltBytes = Buffer.from(salt, 'base64');
    const passwordBuffer = Buffer.from(password, 'utf-8');

    const saltedPassword = crypto.pbkdf2Sync(
        passwordBuffer,
        saltBytes,
        iterations,
        32, // 32 bytes = 256 bits
        'sha256'
    );

    const clientKey = hmac(saltedPassword, 'Client Key');
    const storedKey = crypto.createHash('sha256').update(clientKey).digest();

    // Construct AuthMessage: client-first-message-bare + "," + server-first-message + "," + client-final-message-without-proof
    // Note: "biws" means "base64 encoded, required, no cbind"
    const clientFinalWithoutProof = `c=biws,r=${serverNonce}`;
    const authMessage = [
        clientFirstMessageBare,
        serverFirstMessage,
        clientFinalWithoutProof
    ].join(',');

    const clientSignature = hmac(storedKey, authMessage);
    const clientProof = xorBuffers(clientKey, clientSignature);

    // Calculate ServerSignature for verification later
    const serverKey = hmac(saltedPassword, 'Server Key');
    const serverSignature = hmac(serverKey, authMessage).toString('base64');

    return {
        clientFinalMessage: `${clientFinalWithoutProof},p=${clientProof.toString('base64')}`,
        serverSignature: serverSignature
    };
}
