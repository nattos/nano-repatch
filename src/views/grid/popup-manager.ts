import { makeAutoObservable } from 'mobx';
import { AppController, generateId } from '../../builder/state';
import { defaultNodeRepository } from '../../structor/repository';

export interface PopupState {
  x: number;
  y: number;
  gridX: number;
  gridY: number;
  initialValue: string;
  nodeId?: string;
  isNew?: boolean;
  connectionId?: string;
}

export class GridPopupManager {
  public popup: PopupState | null = null;
  private longEdit: any | null = null; // Type: LongEdit, but avoiding strict dependency on class instance structure if tricky

  constructor(private appController: AppController) {
    makeAutoObservable(this, { appController: false });
  }

  startCreation(x: number, y: number, gridX: number, gridY: number, initialValue: string, connectionId?: string) {
    const generatedId = generateId('node');

    // Start Long Edit immediately
    this.longEdit = this.appController.beginLongEdit({
      apply: (c) => {
        // Create node (transactionally rolled back/re-applied during preview)
        c.createNode(initialValue, gridX, gridY, { id: generatedId });

        // If creating on a wire, perform splice (only if initialValue matches a known type?
        // Actually createNode uses initialValue as typeId.
        // Wire splice logic is usually dependent on the committed type.
      },
      cancel: () => {
        this.longEdit = null;
      }
    });

    this.popup = {
      x, y, gridX, gridY, initialValue, nodeId: generatedId, isNew: true, connectionId
    };
  }

  updatePreview(typeId: string) {
    if (!this.popup) return;

    // Unify logic from GraphGrid.handlePopupPreview
    let realTypeId = typeId;
    let extraConfig: any = {};

    if (!defaultNodeRepository.getNodeType(typeId) && typeId.includes('.')) {
      realTypeId = 'core.subgraph';
      extraConfig = { subgraphId: typeId };
    }

    const applyCallback = (c: AppController) => {
      // Create or Update
      if (this.popup!.isNew) {
        c.createNode(realTypeId, this.popup!.gridX, this.popup!.gridY, { id: this.popup!.nodeId!, ...extraConfig });
      } else {
        c.setNodeConfig(this.popup!.nodeId!, { typeId: realTypeId, ...extraConfig });
      }

      // Handle Connection Splice (Live Rewire)
      if (this.popup!.connectionId) {
        const connId = this.popup!.connectionId!;
        const oldConn = this.appController.observableState.graph.inner.connections[connId];
        if (oldConn) {
          const nodeType = defaultNodeRepository.getNodeType(typeId);
          const firstInput = nodeType?.inputs?.[0]?.name || 'in';
          const firstOutput = nodeType?.outputs?.[0]?.name || 'out';

          c.deleteConnection(connId);
          c.createConnection(oldConn.fromNodeId, oldConn.fromPort, this.popup!.nodeId!, firstInput);
          c.createConnection(this.popup!.nodeId!, firstOutput, oldConn.toNodeId, oldConn.toPort);
        }
      }
    };

    if (this.longEdit) {
      this.longEdit.applyAgain(applyCallback);
    } else {
      // Should not happen if started correctly, but handle gracefully
      this.longEdit = this.appController.beginLongEdit({
        apply: applyCallback,
        cancel: () => { this.longEdit = null; }
      });
    }
  }

  commit() {
    if (this.longEdit) {
      if (this.longEdit.accept) {
        this.longEdit.accept();
      }
      this.longEdit = null;
    }
    this.popup = null;
  }

  cancel() {
    if (this.longEdit) {
      this.longEdit.cancel();
      this.longEdit = null;
    }
    this.popup = null;
  }
}
