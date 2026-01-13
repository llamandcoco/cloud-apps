// SR (Short-Read) Unified Worker - Routes all short-read commands to handlers

import { createUnifiedWorkerHandler } from '../../shared/worker-utils';
import { handleEcho } from '../handlers/echo';

// Import future short-read handlers here
// import { handleStatus } from '../handlers/status';
// import { handleHelp } from '../handlers/help';

/**
 * Unified SR worker handler
 * Routes commands to appropriate handlers based on command type
 */
export const handler = createUnifiedWorkerHandler({
  componentName: 'sr-worker',
  quadrantName: 'short-read',
  commandHandlers: {
    '/echo': handleEcho,
    // Add new short-read commands here (no infrastructure changes needed!)
    // '/status': handleStatus,
    // '/help': handleHelp,
  },
});
