// SR (Short-Read) Unified Worker - Routes all short-read commands to handlers

import { createUnifiedWorkerHandler } from '../../shared/worker-utils';
import { handleEcho } from '../handlers/echo';
import { handleStatus } from '../handlers/status';

// Import future short-read handlers here
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
    '/check-status': handleStatus,
    // Add new short-read commands here (no infrastructure changes needed!)
    // '/help': handleHelp,
  },
});
