import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';
import { hostSockPath } from '../storage/index.js';
import {
  encodeFrame,
  handleRequest,
  tryDecodeFrames,
  type HostRequest,
  type HostResponse,
} from './protocol.js';

const SOCK_MODE = 0o600;
const pendingCli = new Map<string, (msg: HostResponse) => void>();
let chromeConnected = false;
let socketServer: net.Server | undefined;
let boundSock: string | undefined;

function writeChrome(msg: unknown): void {
  process.stdout.write(encodeFrame(msg));
}

function onChromeMessage(raw: unknown): void {
  const msg = raw as HostResponse & HostRequest;
  const waiter = pendingCli.get(msg.id);
  if (waiter) {
    pendingCli.delete(msg.id);
    waiter(msg as HostResponse);
    return;
  }
  if (msg.op === 'ping') {
    writeChrome(handleRequest(msg as HostRequest));
    return;
  }
  chromeConnected = true;
  ensureSocket();
  const result = handleRequest(msg as HostRequest);
  writeChrome(result);
}

function ensureSocket(): void {
  if (socketServer) {
    return;
  }
  const sock = hostSockPath();
  fs.mkdirSync(path.dirname(sock), { recursive: true });
  try {
    if (fs.existsSync(sock)) {
      fs.unlinkSync(sock);
    }
  } catch {
    // ignore
  }
  try {
    socketServer = net.createServer((conn) => {
      let buf: Buffer = Buffer.alloc(0);
      conn.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk as Buffer]);
        const { messages, rest } = tryDecodeFrames(buf);
        buf = rest;
        for (const raw of messages) {
          void handleSocketMessage(conn, raw as HostRequest);
        }
      });
    });
    socketServer.listen(sock, () => {
      try {
        fs.chmodSync(sock, SOCK_MODE);
      } catch {
        // ignore
      }
      boundSock = sock;
    });
    socketServer.on('error', () => {
      socketServer = undefined;
    });
  } catch {
    socketServer = undefined;
  }
}

function handleSocketMessage(conn: net.Socket, req: HostRequest): void {
  if (req.op === 'focusTab') {
    if (!chromeConnected) {
      conn.write(encodeFrame({ id: req.id, ok: false, error: 'extension not connected' }));
      return;
    }
    pendingCli.set(req.id, (msg) => {
      conn.write(encodeFrame(msg));
    });
    writeChrome(req);
    return;
  }
  const result = handleRequest(req);
  conn.write(encodeFrame(result));
}

function shutdown(): void {
  if (boundSock) {
    try {
      fs.unlinkSync(boundSock);
    } catch {
      // ignore
    }
  }
  socketServer?.close();
}

let stdinBuf: Buffer = Buffer.alloc(0);
process.stdin.on('data', (chunk) => {
  stdinBuf = Buffer.concat([stdinBuf, chunk]);
  const { messages, rest } = tryDecodeFrames(stdinBuf);
  stdinBuf = rest;
  for (const msg of messages) {
    onChromeMessage(msg);
  }
});
process.stdin.on('end', () => {
  shutdown();
  process.exit(0);
});
process.stdin.resume();
