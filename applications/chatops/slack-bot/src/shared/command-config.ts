// Command Configuration
// Defines behavior and requirements for each chatbot command

export interface CommandConfig {
  command: string;
  description: string;
  requiresLock: boolean;
  lockScope?: 'component-environment' | 'global';
  lockTTL?: number; // TTL in minutes
  enableCache?: boolean;
  cacheTTL?: number; // TTL in seconds
  cacheStrategy?: 'request-dedup' | 'response-cache' | 'data-cache';
}

export const COMMAND_CONFIG: Record<string, CommandConfig> = {
  '/echo': {
    command: '/echo',
    description: 'Echo command for testing',
    requiresLock: false,
    enableCache: false,
  },

  '/status': {
    command: '/status',
    description: 'Check build/deploy status',
    requiresLock: false,
    enableCache: true,
    cacheTTL: 30, // 30 seconds
    cacheStrategy: 'response-cache',
  },

  '/build': {
    command: '/build',
    description: 'Trigger GitHub Actions build',
    requiresLock: true,
    lockScope: 'component-environment',
    lockTTL: 10, // 10 minutes
    enableCache: false,
  },

  '/deploy': {
    command: '/deploy',
    description: 'Deploy to environment',
    requiresLock: true,
    lockScope: 'component-environment',
    lockTTL: 30, // 30 minutes (deploys take longer)
    enableCache: false,
  },
} as const;

/**
 * Get configuration for a command
 */
export function getCommandConfig(command: string): CommandConfig | null {
  return COMMAND_CONFIG[command] || null;
}

/**
 * Check if command requires distributed lock
 */
export function requiresLock(command: string): boolean {
  const config = getCommandConfig(command);
  return config?.requiresLock ?? false;
}

/**
 * Check if command supports caching
 */
export function supportsCache(command: string): boolean {
  const config = getCommandConfig(command);
  return config?.enableCache ?? false;
}

/**
 * Get cache TTL for command
 */
export function getCacheTTL(command: string): number {
  const config = getCommandConfig(command);
  return config?.cacheTTL ?? 0;
}

/**
 * Get lock TTL for command
 */
export function getLockTTL(command: string): number {
  const config = getCommandConfig(command);
  return config?.lockTTL ?? 10;
}
