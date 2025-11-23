// src/io/resolume/fake-resolume-client.test.ts

import { FakeResolumeApiClient } from './fake-resolume-client';
import { ResolumeApiClient } from './resolume'; // For WebSocket.OPEN etc.
import { vi } from 'vitest'; // Import vi from vitest

describe('FakeResolumeApiClient', () => {
  let fakeClient: FakeResolumeApiClient;
  let mockOnMessage: vi.Mock;
  let mockOnError: vi.Mock;
  let mockOnClose: vi.Mock;
  let mockWs: WebSocket;

  beforeEach(() => {
    // We need to mock the global WebSocket and fetch for the base client's constructor
    // Although the fake client overrides connectWebSocket, the base constructor still references it
    global.fetch = vi.fn() as any;
    global.WebSocket = vi.fn(() => ({
      readyState: WebSocket.OPEN,
      send: vi.fn(),
      close: vi.fn(),
      onopen: vi.fn(),
      onmessage: vi.fn(),
      onerror: vi.fn(),
      onclose: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      url: 'ws://localhost:8080/api/v1',
      binaryType: 'blob',
      bufferedAmount: 0,
      extensions: '',
      protocol: '',
      OPEN: WebSocket.OPEN,
      CLOSED: WebSocket.CLOSED,
      CONNECTING: WebSocket.CONNECTING,
      CLOSING: WebSocket.CLOSING,
      CONNECT: 0,
    })) as any;

    fakeClient = new FakeResolumeApiClient();
    mockOnMessage = vi.fn();
    mockOnError = vi.fn();
    mockOnClose = vi.fn();
    
    mockWs = fakeClient.connectWebSocket(mockOnMessage, mockOnError, mockOnClose);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return mock product info', async () => {
    const productInfo = await fakeClient.getProductInfo();
    expect(productInfo).toEqual({
      name: 'Fake Arena',
      major: 7,
      minor: 18,
      micro: 2,
      revision: 29742,
    });
  });

  it('should send initial composition state on WebSocket connect', (done) => {
    // Initial message is sent after a short timeout
    setTimeout(() => {
      expect(mockOnMessage).toHaveBeenCalledTimes(1);
      const initialMessage = mockOnMessage.mock.calls[0][0];
      // Check for some known top-level keys from the fixture
      expect(initialMessage).toHaveProperty('layers');
      expect(initialMessage).toHaveProperty('decks');
      expect(initialMessage).toHaveProperty('crossfader');
      done();
    }, 150); // Slightly more than the 100ms delay in connectWebSocket
  });

  it('should handle "subscribe" action and return parameter_subscribed', (done) => {
    const targetParamId = '1763903991101'; // ID for layers[0].video.opacity
    const expectedPath = '/composition/layers/1/video/opacity';

    // Wait for initial state to be sent first
    setTimeout(() => {
      mockOnMessage.mockClear(); // Clear initial state message

      fakeClient.sendWebSocketMessage(mockWs, {
        action: 'subscribe',
        parameter: `/parameter/by-id/${targetParamId}`,
      });

      setTimeout(() => {
        expect(mockOnMessage).toHaveBeenCalledTimes(1);
        const subscribeResponse = mockOnMessage.mock.calls[0][0];
        expect(subscribeResponse).toEqual({
          id: parseInt(targetParamId, 10),
          valuetype: 'ParamRange',
          value: expect.any(Number), // Value from fixture
          path: expectedPath,
          type: 'parameter_subscribed',
        });
        done();
      }, 50);
    }, 150);
  });

  it('should handle "set" action for ParamRange and broadcast update', (done) => {
    const targetParamId = '1763903991101'; // ID for layers[0].video.opacity
    const expectedPath = '/composition/layers/1/video/opacity';
    const newValue = 0.75;

    // Wait for initial state, then subscribe
    setTimeout(() => {
      mockOnMessage.mockClear(); // Clear initial state message

      // Simulate subscribe
      fakeClient.sendWebSocketMessage(mockWs, {
        action: 'subscribe',
        parameter: `/parameter/by-id/${targetParamId}`,
      });

      setTimeout(() => {
        mockOnMessage.mockClear(); // Clear subscribe response

        // Send set message
        fakeClient.sendWebSocketMessage(mockWs, {
          action: 'set',
          parameter: expectedPath,
          id: parseInt(targetParamId, 10),
          value: newValue,
        });

        setTimeout(() => {
          expect(mockOnMessage).toHaveBeenCalledTimes(1); // One update broadcast
          const updateMessage = mockOnMessage.mock.calls[0][0];
          expect(updateMessage).toEqual({
            id: parseInt(targetParamId, 10),
            valuetype: 'ParamRange',
            value: newValue,
            path: expectedPath,
            type: 'parameter_update',
          });
          // Verify internal state updated
          const updatedParam = (fakeClient as any).findParameterByIdRecursive((fakeClient as any).currentCompositionState, parseInt(targetParamId, 10));
          expect(updatedParam.value).toBe(newValue);
          done();
        }, 50);
      }, 50);
    }, 150);
  });

  it('should handle "trigger" action for ParamTrigger and broadcast update', (done) => {
    const targetParamId = '1763903990340'; // ID for layers[0].clips[0].connected
    const expectedPath = '/composition/layers/1/clips/1/connect';
    const triggerValue = true;

    // Wait for initial state, then subscribe
    setTimeout(() => {
      mockOnMessage.mockClear(); // Clear initial state message

      // Simulate subscribe
      fakeClient.sendWebSocketMessage(mockWs, {
        action: 'subscribe',
        parameter: `/parameter/by-id/${targetParamId}`,
      });

      setTimeout(() => {
        mockOnMessage.mockClear(); // Clear subscribe response

        // Send trigger message
        fakeClient.sendWebSocketMessage(mockWs, {
          action: 'trigger',
          parameter: expectedPath,
          value: triggerValue,
        });

        setTimeout(() => {
          expect(mockOnMessage).toHaveBeenCalledTimes(1); // One update broadcast
          const updateMessage = mockOnMessage.mock.calls[0][0];
          expect(updateMessage).toEqual({
            id: parseInt(targetParamId, 10),
            valuetype: 'ParamState', // After trigger, state usually changes to Connected
            value: 'Connected',
            path: expectedPath,
            type: 'parameter_update',
          });
          // Verify internal state updated (assuming connected state changes to 'Connected')
          const updatedParam = (fakeClient as any).findParameterByIdRecursive((fakeClient as any).currentCompositionState, parseInt(targetParamId, 10));
          expect(updatedParam.value).toBe('Connected');
          done();
        }, 50);
      }, 50);
    }, 150);
  });

  it('should return error for unknown action', (done) => {
    setTimeout(() => {
      mockOnMessage.mockClear();
      fakeClient.sendWebSocketMessage(mockWs, {
        action: 'unknown_action',
        parameter: '/some/path',
        value: 'test',
      });
      setTimeout(() => {
        expect(mockOnMessage).toHaveBeenCalledTimes(1);
        expect(mockOnMessage.mock.calls[0][0]).toHaveProperty('error');
        expect(mockOnMessage.mock.calls[0][0].error).toContain('Unknown action');
        done();
      }, 50);
    }, 150);
  });
});
