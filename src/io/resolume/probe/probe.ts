import fetch from 'node-fetch';
import NodeWebSocket from 'ws';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ResolumeApiClient } from '../resolume';

const RESOLUME_BASE_URL = 'http://192.168.125.16:8080';

(global as any).WebSocket = NodeWebSocket;

const client = new ResolumeApiClient(RESOLUME_BASE_URL, fetch as any);

async function main() {
  console.log('Connecting to Resolume WebSocket to capture initial state...');

  let ws: NodeWebSocket;

  const onMessage = async (data: any) => {
    console.log('\n--- Message Received ---');
    console.log(JSON.stringify(data, null, 2));

    const outputPath = path.join(process.cwd(), 'src', 'io', 'resolume', 'probe', 'resolume-ws-initial-state.json');
    try {
      await fs.writeFile(outputPath, JSON.stringify(data, null, 2));
      console.log(`\n✅ Initial state saved to: ${outputPath}`);
    } catch (error) {
      console.error('❌ Failed to save initial state:', error);
    }

    // We have the initial state, close the connection.
    ws.close();
  };

  const onError = (error: any) => {
    console.error('❌ WebSocket Error:', error);
  };

  const onClose = (event: any) => {
    console.log(`\nWebSocket Closed: Code ${event.code}, Reason: ${event.reason}`);
    console.log('Probe finished.');
  };
  
  const wsUrl = RESOLUME_BASE_URL.replace(/^http/, 'ws') + '/api/v1';
  ws = new NodeWebSocket(wsUrl);

  ws.onopen = () => {
    console.log("[ResolumeWebSocket] Connection established. Waiting for initial state message...");
  };
  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data as string);
      onMessage(data);
    } catch (error) {
      console.error("[ResolumeWebSocket] Error parsing message:", error);
    }
  };
  ws.onerror = onError;
  ws.onclose = onClose;

  await new Promise<void>(resolve => {
    ws.onclose = (event) => {
      onClose(event as any);
      resolve();
    };
  });
}

main();
