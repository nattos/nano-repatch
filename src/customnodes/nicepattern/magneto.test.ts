
import { describe, it, expect } from 'vitest';
import { magneto } from './magneto';
import { registerNode } from '../../structor/node-helpers';
import { defaultNodeRepository } from '../../structor/repository';
import { registerNicePatternUI } from './ui-registration';

registerNode(magneto);
registerNicePatternUI();

describe('Magneto Node', () => {
    it('should be defined', () => {
        expect(magneto).toBeDefined();
    });

    it('should have correct id', () => {
        expect(magneto.id).toBe('nicepattern.magneto');
    });

    it('should have correct dimensions', async () => {
        const magnetoType = defaultNodeRepository.getNodeType('nicepattern.magneto');
        // Registering UI updates the repository entry
        const heightFn = await (magnetoType as any).ui.getBodyHeight();
        expect(heightFn()).toBe(272);
    });
});
