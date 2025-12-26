import './curve/nodes';
import './debug/nodes-registration';
import './expr/nodes';
import './gen/nodes';
import './math/nodes';
import './midi/nodes';
import './nicepattern/nodes';
import './seq/nodes';
import '../structor/register-primitives';
import { registerPrimitives } from '../structor/register-primitives';

// Register all core primitive nodes
registerPrimitives();

