
import { describe, it, expect } from 'vitest';
import { magneto } from './magneto';
import { registerNode } from '../../structor/node-helpers';

registerNode(magneto);

describe('Magneto Node', () => {
    it('should be defined', () => {
        expect(magneto).toBeDefined();
    });

    it('should have correct id', () => {
        expect(magneto.id).toBe('nicepattern.magneto');
    });

    it('should have correct dimensions', async () => {
        const heightFn = await magneto.ui.getBodyHeight();
        expect(heightFn()).toBe(272);
    });
});
