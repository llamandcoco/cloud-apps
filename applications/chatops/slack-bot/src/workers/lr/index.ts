// LR (Long-Read) Unified Worker - Routes all long-read commands to handlers

import { createUnifiedWorkerHandler } from '../../shared/worker-utils';

// Import future long-read handlers here
// import { handleAnalyze } from '../handlers/analyze';
// import { handleReport } from '../handlers/report';

/**
 * Unified LR worker handler
 * Routes commands to appropriate handlers based on command type
 */
export const handler = createUnifiedWorkerHandler({
  componentName: 'lr-worker',
  quadrantName: 'long-read',
  commandHandlers: {
    // Add new long-read commands here (no infrastructure changes needed!)
    // '/analyze': handleAnalyze,
    // '/report': handleReport,
  },
});
