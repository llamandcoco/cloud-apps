// LW (Long-Write) Unified Worker - Routes all long-write commands to handlers

import { createUnifiedWorkerHandler } from '../../shared/worker-utils';
import { handleBuild } from '../handlers/build';

// Import future long-write handlers here
// import { handleDeploy } from '../handlers/deploy';

/**
 * Unified LW worker handler
 * Routes commands to appropriate handlers based on command type
 */
export const handler = createUnifiedWorkerHandler({
  componentName: 'lw-worker',
  quadrantName: 'long-write',
  commandHandlers: {
    '/build': handleBuild,
    // Add new long-write commands here (no infrastructure changes needed!)
    // '/deploy': handleDeploy,
  },
});
