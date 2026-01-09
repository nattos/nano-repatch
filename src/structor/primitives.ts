import { PrimitiveNodeDefinition } from "./structor";

// Import all modules to trigger side-effect registration
import * as Binary from './nodes/binary';
import * as Unary from './nodes/unary';
import * as List from './nodes/list';
import * as Constants from './nodes/constants';
import * as Utils from './nodes/utils';
import * as IOInput from './nodes/io_input';
import * as IOOutput from './nodes/io_output';
import * as CoreSubgraph from './nodes/core_subgraph';
import * as CoreThenSubgraph from './nodes/core_thensubgraph';
import * as CorePack from './nodes/core_pack';
import * as CoreUnpack from './nodes/core_unpack';
import * as CoreIfThen from './nodes/core_ifthen';
import * as DataLiteral from './nodes/data_literal';
import * as DataHub from './nodes/data_hub';
import * as Functional from './nodes/functional';
import * as LogicSelect from './nodes/logic_select';
import * as LogicLatch from './nodes/logic_latch';
import * as LogicDelay from './nodes/logic_delay';

// Re-export all primitives for backward compatibility
export * from './nodes/binary';
export * from './nodes/unary';
export * from './nodes/list';
export * from './nodes/constants';
export * from './nodes/utils';
export * from './nodes/io_input';
export * from './nodes/io_output';
export * from './nodes/core_subgraph';
export * from './nodes/core_thensubgraph';
export * from './nodes/core_pack';
export * from './nodes/core_unpack';
export * from './nodes/core_ifthen';
export * from './nodes/data_literal';
export * from './nodes/data_hub';
export * from './nodes/functional';
export * from './nodes/logic_select';
export * from './nodes/logic_latch';
export * from './nodes/logic_delay';

// Aggregate ALL_PRIMITIVES for tests and legacy registration tools
const modules = [
  Binary, Unary, List, Constants, Utils, IOInput, IOOutput,
  CoreSubgraph, CoreThenSubgraph, CorePack, CoreUnpack, CoreIfThen, DataLiteral, DataHub, Functional,
  LogicSelect, LogicLatch, LogicDelay
];

export const ALL_PRIMITIVES: PrimitiveNodeDefinition[] = modules.flatMap(mod =>
  Object.values(mod).filter((exp): exp is PrimitiveNodeDefinition =>
    typeof exp === 'object' && exp !== null && 'kind' in exp && exp.kind === 'primitive'
  )
);