import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AppController, AppState, GridNode, Connection } from './state';

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
            expect(Object.keys(state.nodes).length).toBe(0);
            expect(Object.keys(state.connections).length).toBe(0);
        });

        it('should correctly populate the observableState mirror from an initial state', () => {
            const initialState: AppState = {
                nodes: { 'node-1': { id: 'node-1', typeId: 'literal', x: 10, y: 10, config: 5 } },
                connections: {},
            };
            controller = new AppController(initialState);
            // For now, observableState is a direct copy. This test will become more meaningful with MobX.
            expect(controller.observableState).toEqual(initialState);
        });
    });

    describe('Node Operations', () => {
        it('should create a new node with the correct type and position', () => {
            vi.spyOn(controller, 'dispatch');
            controller.createNode('add', 5, 10);
            
            const state = controller.getState();
            const node = first(state.nodes);

            expect(node).toBeDefined();
            expect(node?.typeId).toBe('add');
            expect(node?.x).toBe(5);
            expect(node?.y).toBe(10);
            expect(controller.dispatch).toHaveBeenCalledOnce();
        });

        it('should delete a node and automatically remove its connected connections', () => {
            // Setup: Create two nodes and a connection
            controller.createNode('A', 0, 0);
            controller.createNode('B', 10, 0);
            const nodeA = first(controller.getState().nodes)!;
            const nodeB = first(Object.values(controller.getState().nodes).filter(n => n.id !== nodeA.id))!;
            controller.createConnection(nodeA.id, 0, nodeB.id, 0);
            expect(Object.keys(controller.getState().connections).length).toBe(1);

            // Test: Delete one node
            controller.deleteNode(nodeA.id);
            const state = controller.getState();
            expect(Object.keys(state.nodes).length).toBe(1);
            expect(state.nodes[nodeB.id]).toBeDefined();
            expect(Object.keys(state.connections).length).toBe(0); // Connection should be gone
        });

        it('should move one or more nodes to a new position', () => {
            controller.createNode('A', 0, 0);
            const node = first(controller.getState().nodes)!;
            
            controller.moveNodes([node.id], 15, 25);
            const movedNode = controller.getState().nodes[node.id];
            expect(movedNode.x).toBe(15);
            expect(movedNode.y).toBe(25);
        });

        it('should handle partial updates when setting node config, leaving other properties intact', () => {
            controller.createNode('literal', 0, 0);
            const node = first(controller.getState().nodes)!;
            controller.setNodeConfig(node.id, { value: 10 });
            expect(controller.getState().nodes[node.id].config.value).toBe(10);

            controller.setNodeConfig(node.id, { name: 'MyLiteral' });
            const finalConfig = controller.getState().nodes[node.id].config;
            expect(finalConfig.value).toBe(10); // Should still be there
            expect(finalConfig.name).toBe('MyLiteral');
        });
    });

    describe('Connection Operations', () => {
        beforeEach(() => {
            controller.createNode('A', 0, 0);
            controller.createNode('B', 10, 0);
        });

        it('should create a connection between two node ports', () => {
            const nodeA = Object.values(controller.getState().nodes)[0];
            const nodeB = Object.values(controller.getState().nodes)[1];
            controller.createConnection(nodeA.id, 'out', nodeB.id, 'in');

            const state = controller.getState();
            const conn = first(state.connections);
            expect(conn).toBeDefined();
            expect(conn?.fromNodeId).toBe(nodeA.id);
            expect(conn?.toNodeId).toBe(nodeB.id);
        });

        it('should delete a connection by its ID without affecting other connections', () => {
            const nodeA = Object.values(controller.getState().nodes)[0];
            const nodeB = Object.values(controller.getState().nodes)[1];
            controller.createConnection(nodeA.id, 0, nodeB.id, 0);
            controller.createConnection(nodeA.id, 1, nodeB.id, 1);
            
            const connIdToDelete = Object.keys(controller.getState().connections)[0];
            controller.deleteConnection(connIdToDelete);

            const state = controller.getState();
            expect(Object.keys(state.connections).length).toBe(1);
            expect(state.connections[connIdToDelete]).toBeUndefined();
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
            expect(Object.keys(finalState.nodes).length).toBe(2);
            // This test will also check that only one entry is added to the undo stack
            // once the implementation is complete.
        });

        it('should undo an entire transaction in a single step', () => {
            controller.transaction(c => {
                c.createNode('A', 0, 0);
                c.createNode('B', 10, 10);
            });
            expect(Object.keys(controller.getState().nodes).length).toBe(2);

            controller.undo();
            expect(Object.keys(controller.getState().nodes).length).toBe(0);
        });

        it('should redo an entire transaction in a single step', () => {
            controller.transaction(c => {
                c.createNode('A', 0, 0);
                c.createNode('B', 10, 10);
            });
            controller.undo();
            expect(Object.keys(controller.getState().nodes).length).toBe(0);

            controller.redo();
            expect(Object.keys(controller.getState().nodes).length).toBe(2);
        });

        it('should handle a complex transaction of create, connect, and move', () => {
            controller.createNode('A', 0, 0);
            const initialState = controller.getState();
            const nodeA = first(initialState.nodes)!;

            controller.transaction(c => {
                // 1. Create node B
                c.createNode('B', 20, 20);
                const nodeB = first(Object.values(c.getState().nodes).filter(n => n.id !== nodeA.id))!;
                
                // 2. Connect A to B
                c.createConnection(nodeA.id, 0, nodeB.id, 0);

                // 3. Move node B
                c.moveNodes([nodeB.id], 30, 30);
            });

            // Assert final state
            const finalState = controller.getState();
            expect(Object.keys(finalState.nodes).length).toBe(2);
            const finalNodeB = first(Object.values(finalState.nodes).filter(n => n.id !== nodeA.id))!;
            expect(finalNodeB.x).toBe(30);
            expect(finalNodeB.y).toBe(30);
            expect(Object.keys(finalState.connections).length).toBe(1);
            const conn = first(finalState.connections)!;
            expect(conn.fromNodeId).toBe(nodeA.id);
            expect(conn.toNodeId).toBe(finalNodeB.id);

            // Assert undo
            controller.undo();
            expect(controller.getState()).toEqual(initialState);

            // Assert redo
            controller.redo();
            expect(controller.getState()).toEqual(finalState);
        });

        it('should allow reading the results of an operation within the same transaction', () => {
            const nodeA = controller.createNode('A', 0, 0);

            controller.transaction(c => {
                const nodeB = c.createNode('B', 10, 10);
                
                // Check that the state inside the transaction is updated
                const internalState = c.getState();
                expect(Object.keys(internalState.nodes).length).toBe(2);
                expect(internalState.nodes[nodeB.id]).toBeDefined();

                // Use the result of the first operation in the second
                const connection = c.createConnection(nodeA.id, 0, nodeB.id, 0);
                expect(Object.keys(c.getState().connections).length).toBe(1);
                expect(c.getState().connections[connection.id]).toBeDefined();
            });

            // Final state should be correct
            const finalState = controller.getState();
            expect(Object.keys(finalState.nodes).length).toBe(2);
            expect(Object.keys(finalState.connections).length).toBe(1);
        });
    });


    describe('Undo/Redo', () => {
        it('should undo a single "create node" operation', () => {
            controller.createNode('A', 0, 0);
            expect(Object.keys(controller.getState().nodes).length).toBe(1);
            
            controller.undo();
            expect(Object.keys(controller.getState().nodes).length).toBe(0);
        });

        it('should redo an undone "create node" operation', () => {
            controller.createNode('A', 0, 0);
            controller.undo();
            expect(Object.keys(controller.getState().nodes).length).toBe(0);

            controller.redo();
            expect(Object.keys(controller.getState().nodes).length).toBe(1);
        });

        it('should clear the redo stack after a new operation is dispatched', () => {
            controller.createNode('A', 0, 0);
            controller.undo(); // Redo stack now has one item

            controller.createNode('B', 1, 1); // New operation
            
            const stateBeforeRedo = controller.getState();
            controller.redo(); // Should do nothing
            expect(controller.getState()).toEqual(stateBeforeRedo);
        });
    });

    describe('State Integrity & Immutability', () => {
        it('should produce a new state object after each dispatched transaction', () => {
            const initialState = controller.getState();
            controller.createNode('A', 0, 0);
            const nextState = controller.getState();

            expect(initialState).not.toBe(nextState);
            expect(initialState.nodes).not.toBe(nextState.nodes);
        });
    });
});