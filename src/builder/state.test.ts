import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autorun, toJS, runInAction } from 'mobx';
import { AppController, GraphInnerState, GridNode, Connection } from './state';

// A helper to get the first item from a record
const first = <T>(record: Record<string, T>): T | undefined => {
    const key = Object.keys(record)[0];
    return key ? record[key] : undefined;
};

describe('AppController', () => {
    let controller: AppController;

    beforeEach(() => {
        controller = new AppController();
    });

    describe('Initialization', () => {
        it('should initialize with a default empty state', () => {
            const state = controller.getState();
            expect(Object.keys(state.graph.inner.nodes).length).toBe(0);
            expect(state.graph.auxiliary.incomingConnections.size).toBe(0);
        });

        it('should correctly build auxiliary maps from an initial state', () => {
            const initialState: GraphInnerState = {
                nodes: {
                    'node-1': { id: 'node-1', x: 10, y: 10, config: { typeId: 'literal', literal: { value: 5 } } },
                    'node-2': { id: 'node-2', x: 20, y: 10, config: { typeId: 'add' } },
                },
                connections: {
                    'conn-1': { id: 'conn-1', fromNodeId: 'node-1', fromPort: 0, toNodeId: 'node-2', toPort: 0 },
                },
            };
            controller = new AppController(initialState);
            const state = controller.getState();
            expect(state.graph.auxiliary.outgoingConnections.get('node-1')).toEqual(['conn-1']);
            expect(state.graph.auxiliary.incomingConnections.get('node-2')).toEqual(['conn-1']);
        });
    });

    describe('Node Operations', () => {
        it('should create a new node with the correct typeId in config', () => {
            const newNode = controller.createNode('add', 5, 10);
            const state = controller.getState();
            expect(state.graph.inner.nodes[newNode.id].config.typeId).toBe('add');
        });

        it('should delete a node and clean up auxiliary maps', () => {
            const nodeA = controller.createNode('A', 0, 0);
            const nodeB = controller.createNode('B', 10, 0);
            const conn = controller.createConnection(nodeA.id, 0, nodeB.id, 0);
            controller.deleteNode(nodeA.id);
            const state = controller.getState();
            expect(state.graph.inner.nodes[nodeA.id]).toBeUndefined();
            expect(state.graph.auxiliary.incomingConnections.has(nodeA.id)).toBe(false);
        });

        it('should move one or more nodes', () => {
            const node = controller.createNode('A', 0, 0);
            controller.moveNodes([node.id], 15, 25);
            expect(controller.getState().graph.inner.nodes[node.id].x).toBe(15);
        });

        it('should change a node typeId and preserve old config', () => {
            const node = controller.createNode('literal', 0, 0);
            controller.setNodeConfig(node.id, { literal: { value: 10 } });
            controller.setNodeConfig(node.id, { typeId: 'add' });
            const finalNode = controller.getState().graph.inner.nodes[node.id];
            expect(finalNode.config.typeId).toBe('add');
            expect(finalNode.config.literal.value).toBe(10);
        });
    });

    describe('Connection Operations', () => {
        let nodeA: GridNode;
        let nodeB: GridNode;
        beforeEach(() => {
            nodeA = controller.createNode('A', 0, 0);
            nodeB = controller.createNode('B', 10, 0);
        });

        it('should create a connection', () => {
            const conn = controller.createConnection(nodeA.id, 'out', nodeB.id, 'in');
            const state = controller.getState();
            expect(state.graph.inner.connections[conn.id]).toBeDefined();
        });

        it('should delete a connection', () => {
            const conn1 = controller.createConnection(nodeA.id, 0, nodeB.id, 0);
            controller.deleteConnection(conn1.id);
            const state = controller.getState();
            expect(state.graph.inner.connections[conn1.id]).toBeUndefined();
        });
    });

    describe('Transactions', () => {
        it('should group multiple operations into a single state change', () => {
            const initialState = controller.getState();
            controller.transaction(c => {
                c.createNode('A', 0, 0);
                c.createNode('B', 10, 10);
            });
            const finalState = controller.getState();
            expect(finalState).not.toBe(initialState);
            expect(Object.keys(finalState.graph.inner.nodes).length).toBe(2);
        });

        it('should undo an entire transaction', () => {
            controller.transaction(c => {
                c.createNode('A', 0, 0);
                c.createNode('B', 10, 10);
            });
            controller.undo();
            expect(Object.keys(controller.getState().graph.inner.nodes).length).toBe(0);
        });

        it('should redo an entire transaction', () => {
            controller.transaction(c => {
                c.createNode('A', 0, 0);
                c.createNode('B', 10, 10);
            });
            controller.undo();
            controller.redo();
            expect(Object.keys(controller.getState().graph.inner.nodes).length).toBe(2);
        });

        it('should handle a complex transaction', () => {
            const nodeA = controller.createNode('A', 0, 0);
            const initialState = controller.getState();
            controller.transaction(c => {
                const nodeB = c.createNode('B', 20, 20);
                c.createConnection(nodeA.id, 0, nodeB.id, 0);
                c.moveNodes([nodeB.id], 30, 30);
            });
            const finalState = controller.getState();
            const nodeB = Object.values(finalState.graph.inner.nodes).find(n => n.id !== nodeA.id)!;
            expect(nodeB.x).toBe(50);
            controller.undo();
            expect(controller.getState().graph.inner).toEqual(initialState.graph.inner);
        });

        it('should allow in-transaction reads', () => {
            const nodeA = controller.createNode('A', 0, 0);
            controller.transaction(c => {
                const nodeB = c.createNode('B', 10, 10);
                expect(Object.keys(c.getState().graph.inner.nodes).length).toBe(2);
                c.createConnection(nodeA.id, 0, nodeB.id, 0);
                expect(Object.keys(c.getState().graph.inner.connections).length).toBe(1);
            });
        });

        it('should handle self-canceling transactions', () => {
            const initialState = controller.getState();
            controller.transaction(c => {
                const nodeB = c.createNode('B', 10, 10);
                c.deleteNode(nodeB.id);
            });
            expect(controller.getState().graph.inner).toEqual(initialState.graph.inner);
        });
    });

    describe('Undo/Redo', () => {
        it('should undo/redo a single operation', () => {
            const node = controller.createNode('A', 0, 0);
            controller.undo();
            expect(Object.keys(controller.getState().graph.inner.nodes).length).toBe(0);
            controller.redo();
            expect(Object.keys(controller.getState().graph.inner.nodes).length).toBe(1);
        });

        it('should clear the redo stack on a new action', () => {
            controller.createNode('A', 0, 0);
            controller.undo();
            controller.createNode('B', 1, 1);
            const stateBeforeRedo = controller.getState();
            controller.redo();
            expect(controller.getState()).toEqual(stateBeforeRedo);
        });

        it('should undo deletion of a complex node', () => {
            const nodeA = controller.createNode('A', 0, 0);
            const nodeB = controller.createNode('B', 10, 0);
            const nodeC = controller.createNode('C', 0, 10);
            controller.createConnection(nodeA.id, 0, nodeB.id, 0);
            controller.createConnection(nodeC.id, 0, nodeB.id, 1);
            const initialState = controller.getState();
            controller.deleteNode(nodeB.id);
            controller.undo();
            const undidState = controller.getState();
            undidState.graph.auxiliary.incomingConnections.get(nodeB.id)?.sort();
            initialState.graph.auxiliary.incomingConnections.get(nodeB.id)?.sort();
            expect(undidState.graph.inner).toEqual(initialState.graph.inner);
        });
    });

    describe('State Integrity & Immutability', () => {
        it('should produce a new state object after a transaction', () => {
            const initialState = controller.getState();
            controller.createNode('A', 0, 0);
            const nextState = controller.getState();
            expect(initialState).not.toBe(nextState);
        });
    });

    describe('MobX Integration', () => {
        it('should react to node creation', () => {
            const history: number[] = [];
            const dispose = autorun(() => { history.push(Object.keys(controller.observableState.graph.inner.nodes).length); });
            expect(history).toEqual([0]);
            controller.createNode('A', 0, 0);
            expect(history).toEqual([0, 1]);
            dispose();
        });

        it('should react to node config changes', () => {
            const node = controller.createNode('literal', 0, 0);
            const history: any[] = [];
            const dispose = autorun(() => { history.push(controller.observableState.graph.inner.nodes[node.id]?.config.literal?.value); });
            expect(history).toEqual([undefined]);
            controller.setNodeConfig(node.id, { literal: { value: 100 } });
            expect(history).toEqual([undefined, 100]);
            dispose();
        });

        it('should batch updates within a transaction', () => {
            const history: number[] = [];
            const dispose = autorun(() => { history.push(Object.keys(controller.observableState.graph.inner.nodes).length); });
            expect(history).toEqual([0]);
            controller.transaction(c => {
                c.createNode('A', 0, 0);
                c.createNode('B', 10, 10);
            });
            expect(history).toEqual([0, 2]);
            dispose();
        });
    });
});
