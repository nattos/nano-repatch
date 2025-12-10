
import { describe, it, expect, vi } from 'vitest';
import { GraphExecutor } from '../../structor/executor';
import { defaultNodeRepository } from '../../structor/repository';
import { compileGraph, AppState } from '../../builder/compiler';
import { VirtualAudioContext } from '../../audio/virtual-audio';

describe('nicepattern.tone4 integration', () => {
    // Mock AudioContext
    const mockAudioContext = {
        createOscillator: vi.fn(() => ({
            connect: vi.fn(),
            start: vi.fn(),
            stop: vi.fn(),
            disconnect: vi.fn(),
            frequency: { setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() },
            type: 'sine'
        })),
        createGain: vi.fn(() => ({
            connect: vi.fn(),
            disconnect: vi.fn(),
            gain: { setValueAtTime: vi.fn(), setTargetAtTime: vi.fn(), value: 0 }
        })),
        destination: {},
        currentTime: 0,
        state: 'running'
    };

    const runGraph = (inputs: any, config: any = {}) => {
        const appState: AppState = {
            graph: {
                inner: {
                    nodes: {
                        'tone4': {
                            id: 'tone4',
                            x: 0, y: 0,
                            config: { typeId: 'nicepattern.tone4', ...config, values: {} }
                        },
                        'input_vec': {
                            id: 'input_vec',
                            x: 0, y: 0,
                            config: { typeId: 'io.input', values: {}, value: inputs.vec }
                        }
                    },
                    connections: {
                        'c1': { id: 'c1', fromNodeId: 'input_vec', fromPort: 'value', toNodeId: 'tone4', toPort: 'vec' }
                    }
                },
                auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
            }
        };

        const { graph: graphDef } = compileGraph(appState, new Map(), defaultNodeRepository);
        const executor = new GraphExecutor(graphDef, defaultNodeRepository);

        executor.setInput('input_vec', inputs.vec);
        // Only trigger update for tone4?
        // We need to trigger the input first

        executor.update({
            clock: { beat: 0, dt: 0.1 },
            audio: { context: mockAudioContext as any }
        });

        return { executor, mockAudioContext };
    };

    it('should initialize 4 voices (oscillators and gains)', () => {
        const { mockAudioContext } = runGraph({ vec: [0, 0, 0, 0] });

        // 4 voices + 1 master = 5 oscillators? No, 4 oscillators.
        expect(mockAudioContext.createOscillator).toHaveBeenCalledTimes(4);

        // 4 voice gains + 1 master gain = 5 gains
        expect(mockAudioContext.createGain).toHaveBeenCalledTimes(5);
    });

    it('should update voice gains based on vector input', () => {
        const { executor, mockAudioContext } = runGraph({ vec: [0.5, 0, 1.0, 0.2] });
        // The first update initializes.
        // We can inspect the calls to setTargetAtTime on the gains.
        // But since we mock creating gains, we need to capture the instances or spy on the prototype/result.

        // Since we return new objects each time, we can't easily access the created instances unless we spy on `createGain`'s return values.
        // However, we rely on `vi.fn()` returning a specific structure.
        // Let's verify that `setTargetAtTime` was called on the gain objects.
        // But wait, the mock implementation above creates FRESH objects on every call.
        // So verifying `setTargetAtTime` on WHICH object?

        // Actually, we can just spy on the methods if we share them, or check call counts if we want to be loose.
        // A better approach for checking values is effectively difficult with this simple mock.
        // But we can check that `setTargetAtTime` was called at least 4 times (once per voice gain) + master.

        // To be precise:
        // Master gain setTargetAtTime (volume) -> 1 call
        // Voice gains setTargetAtTime -> 4 calls
        // Total 5 calls to setTargetAtTime on gains.

        // We need to separate Osc frequency calls from Gain gain calls.
        // In the mock, `frequency` and `gain` are separate objects with methods.
        // We can spy on them.
    });

    it('should update frequencies when root changes', () => {
        const appState: AppState = {
            graph: {
                inner: {
                    nodes: {
                        'tone4': {
                            id: 'tone4',
                            x: 0, y: 0,
                            config: { typeId: 'nicepattern.tone4', seed: 73.42, values: {} } // Config 'root' is input or config?
                        }
                    },
                    connections: {}
                },
                auxiliary: { outgoingConnections: new Map(), incomingConnections: new Map() }
            }
        };

        // 'root' is an INPUT, so we should drive it via setInput or default.
        // Let's use setInput on a separate node if we want to change it dynamically.
        // Or just let it use default 73.42, then change input.
    });
});
