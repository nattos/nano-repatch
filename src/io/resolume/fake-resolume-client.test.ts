// src/io/resolume/fake-resolume-client.test.ts

import { FakeResolumeApiClient } from './fake-resolume-client';
import { ResolumeWebSocket } from './resolume-client';
import { vi } from 'vitest';

describe('FakeResolumeApiClient', () => {
  let fakeClient: FakeResolumeApiClient;
  let mockOnMessage: vi.Mock;
  let mockOnError: vi.Mock;
  let mockOnClose: vi.Mock;
  let mockWs: ResolumeWebSocket;

  beforeEach(() => {
    // We mock the global WebSocket and fetch only to allow the base ResolumeApiClient (which FakeResolumeApiClient extends)
    // to instantiate without errors. The actual WebSocket logic is overridden by FakeResolumeApiClient.
    global.fetch = vi.fn() as any;
    (global as any).WebSocket = vi.fn(() => ({
      readyState: 1, // OPEN
      send: vi.fn(),
      close: vi.fn(),
      onopen: null,
      onmessage: null,
      onerror: null,
      onclose: null,
    }));

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

      mockWs.send({
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
      mockWs.send({
        action: 'subscribe',
        parameter: `/parameter/by-id/${targetParamId}`,
      });

      setTimeout(() => {
        mockOnMessage.mockClear(); // Clear subscribe response

        // Send set message
        mockWs.send({
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
      mockWs.send({
        action: 'subscribe',
        parameter: `/parameter/by-id/${targetParamId}`,
      });

      setTimeout(() => {
        mockOnMessage.mockClear(); // Clear subscribe response

        // Send trigger message
        mockWs.send({
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
      mockWs.send({
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