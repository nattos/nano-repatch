import { describe, it, expect, vi, beforeEach } from 'vitest';
import { autorun, toJS, runInAction } from 'mobx';
import { AppController, GraphState, GridNode, Connection } from './state';

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
            expect(Object.keys(state.graph.nodes).length).toBe(0);
            expect(state.auxiliary.incomingConnections.size).toBe(0);
        });

        it('should correctly build auxiliary maps from an initial state', () => {
            const initialState: GraphState = {
                nodes: {
                    'node-1': { id: 'node-1', typeId: 'literal', x: 10, y: 10, config: 5 },
                    'node-2': { id: 'node-2', typeId: 'add', x: 20, y: 10, config: {} },
                },
                connections: {
                    'conn-1': { id: 'conn-1', fromNodeId: 'node-1', fromPort: 0, toNodeId: 'node-2', toPort: 0 },
                },
            };
            controller = new AppController(initialState);
            const state = controller.getState();
            expect(state.auxiliary.outgoingConnections.get('node-1')).toEqual(['conn-1']);
            expect(state.auxiliary.incomingConnections.get('node-2')).toEqual(['conn-1']);
        });
    });

    describe('Node Operations', () => {
        it('should create a new node and update auxiliary maps', () => {
            const newNode = controller.createNode('add', 5, 10);
            const state = controller.getState();
            expect(state.graph.nodes[newNode.id]).toBeDefined();
            expect(state.auxiliary.incomingConnections.get(newNode.id)).toEqual([]);
        });

        it('should delete a node and clean up auxiliary maps', () => {
            const nodeA = controller.createNode('A', 0, 0);
            const nodeB = controller.createNode('B', 10, 0);
            const conn = controller.createConnection(nodeA.id, 0, nodeB.id, 0);
            
            controller.deleteNode(nodeA.id);
            const state = controller.getState();
            expect(state.graph.nodes[nodeA.id]).toBeUndefined();
            expect(state.auxiliary.incomingConnections.has(nodeA.id)).toBe(false);
            expect(state.auxiliary.incomingConnections.get(nodeB.id)).not.toContain(conn.id);
        });

        it('should move one or more nodes', () => {
            const node = controller.createNode('A', 0, 0);
            controller.moveNodes([node.id], 15, 25);
            expect(controller.getState().graph.nodes[node.id].x).toBe(15);
            expect(controller.getState().graph.nodes[node.id].y).toBe(25);
        });

        it('should handle partial updates when setting node config', () => {
            const node = controller.createNode('literal', 0, 0);
            controller.setNodeConfig(node.id, { value: 10 });
            expect(controller.getState().graph.nodes[node.id].config.value).toBe(10);
            controller.setNodeConfig(node.id, { name: 'MyLiteral' });
            const finalConfig = controller.getState().graph.nodes[node.id].config;
            expect(finalConfig.value).toBe(10);
            expect(finalConfig.name).toBe('MyLiteral');
        });
    });

    describe('Connection Operations', () => {
        let nodeA: GridNode;
        let nodeB: GridNode;
        beforeEach(() => {
            nodeA = controller.createNode('A', 0, 0);
            nodeB = controller.createNode('B', 10, 0);
        });

        it('should create a connection and update auxiliary maps', () => {
            const conn = controller.createConnection(nodeA.id, 'out', nodeB.id, 'in');
            const state = controller.getState();
            expect(state.graph.connections[conn.id]).toBeDefined();
            expect(state.auxiliary.outgoingConnections.get(nodeA.id)).toEqual([conn.id]);
        });

        it('should delete a connection and update auxiliary maps', () => {
            const conn1 = controller.createConnection(nodeA.id, 0, nodeB.id, 0);
            const conn2 = controller.createConnection(nodeA.id, 1, nodeB.id, 1);
            controller.deleteConnection(conn1.id);
            const state = controller.getState();
            expect(state.graph.connections[conn1.id]).toBeUndefined();
            expect(state.auxiliary.outgoingConnections.get(nodeA.id)).toEqual([conn2.id]);
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
            expect(Object.keys(finalState.graph.nodes).length).toBe(2);
        });

        it('should undo an entire transaction in a single step', () => {
            controller.transaction(c => {
                c.createNode('A', 0, 0);
                c.createNode('B', 10, 10);
            });
            controller.undo();
            expect(Object.keys(controller.getState().graph.nodes).length).toBe(0);
        });

        it('should redo an entire transaction in a single step', () => {
            controller.transaction(c => {
                c.createNode('A', 0, 0);
                c.createNode('B', 10, 10);
            });
            controller.undo();
            controller.redo();
            expect(Object.keys(controller.getState().graph.nodes).length).toBe(2);
        });

        it('should handle a complex transaction of create, connect, and move', () => {
            const nodeA = controller.createNode('A', 0, 0);
            const initialState = controller.getState();
            controller.transaction(c => {
                const nodeB = c.createNode('B', 20, 20);
                c.createConnection(nodeA.id, 0, nodeB.id, 0);
                c.moveNodes([nodeB.id], 30, 30);
            });
            const finalState = controller.getState();
            const nodeB = Object.values(finalState.graph.nodes).find(n => n.id !== nodeA.id)!;
            expect(nodeB.x).toBe(50);
            controller.undo();
            expect(controller.getState().graph).toEqual(initialState.graph);
        });

        it('should allow reading the results of an operation within the same transaction', () => {
            const nodeA = controller.createNode('A', 0, 0);
            controller.transaction(c => {
                const nodeB = c.createNode('B', 10, 10);
                expect(Object.keys(c.getState().graph.nodes).length).toBe(2);
                c.createConnection(nodeA.id, 0, nodeB.id, 0);
                expect(Object.keys(c.getState().graph.connections).length).toBe(1);
            });
        });

        it('should result in no net change for a transaction that creates and deletes a node', () => {
            const initialState = controller.getState();
            controller.transaction(c => {
                const nodeB = c.createNode('B', 10, 10);
                c.deleteNode(nodeB.id);
            });
            expect(controller.getState().graph).toEqual(initialState.graph);
        });
    });

    describe('Undo/Redo', () => {
        it('should undo and redo a single "create node" operation', () => {
            const node = controller.createNode('A', 0, 0);
            controller.undo();
            expect(Object.keys(controller.getState().graph.nodes).length).toBe(0);
            controller.redo();
            expect(Object.keys(controller.getState().graph.nodes).length).toBe(1);
        });

        it('should clear the redo stack after a new operation is dispatched', () => {
            controller.createNode('A', 0, 0);
            controller.undo();
            controller.createNode('B', 1, 1);
            const stateBeforeRedo = controller.getState();
            controller.redo();
            expect(controller.getState()).toEqual(stateBeforeRedo);
        });

        it('should correctly undo the deletion of a node with multiple connections', () => {
            const nodeA = controller.createNode('A', 0, 0);
            const nodeB = controller.createNode('B', 10, 0);
            const nodeC = controller.createNode('C', 0, 10);
            controller.createConnection(nodeA.id, 0, nodeB.id, 0);
            controller.createConnection(nodeC.id, 0, nodeB.id, 1);
            const initialState = controller.getState();
            controller.deleteNode(nodeB.id);
            controller.undo();
            const undidState = controller.getState();
            // Sort arrays for order-independent comparison
            undidState.auxiliary.incomingConnections.get(nodeB.id)?.sort();
            initialState.auxiliary.incomingConnections.get(nodeB.id)?.sort();
            expect(undidState.graph).toEqual(initialState.graph);
        });
    });

    describe('State Integrity & Immutability', () => {
        it('should produce a new state object after each dispatched transaction', () => {
            const initialState = controller.getState();
            controller.createNode('A', 0, 0);
            const nextState = controller.getState();
            expect(initialState).not.toBe(nextState);
        });
    });

    describe('MobX Integration', () => {
        it('should react to node creation', () => {
            const history: number[] = [];
            const dispose = autorun(() => { history.push(Object.keys(controller.observableState.graph.nodes).length); });
            expect(history).toEqual([0]);
            controller.createNode('A', 0, 0);
            expect(history).toEqual([0, 1]);
            dispose();
        });

        it('should react to node config changes', () => {
            const node = controller.createNode('A', 0, 0);
            const history: any[] = [];
            const dispose = autorun(() => { history.push(controller.observableState.graph.nodes[node.id]?.config.value); });
            expect(history).toEqual([undefined]);
            controller.setNodeConfig(node.id, { value: 100 });
            expect(history).toEqual([undefined, 100]);
            dispose();
        });

        it('should batch updates within a transaction', () => {
            const history: number[] = [];
            const dispose = autorun(() => { history.push(Object.keys(controller.observableState.graph.nodes).length); });
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