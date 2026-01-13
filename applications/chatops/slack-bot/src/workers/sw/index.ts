// SW (Short-Write) Unified Worker - Routes all short-write commands to handlers

import { createUnifiedWorkerHandler } from '../../shared/worker-utils';

// Import future short-write handlers here
// import { handleScale } from '../handlers/scale';
// import { handleRestart } from '../handlers/restart';

/**
 * Unified SW worker handler
 * Routes commands to appropriate handlers based on command type
 */
export const handler = createUnifiedWorkerHandler({
  componentName: 'sw-worker',
  quadrantName: 'short-write',
  commandHandlers: {
    // Add new short-write commands here (no infrastructure changes needed!)
    // '/scale': handleScale,
    // '/restart': handleRestart,
  },
});
