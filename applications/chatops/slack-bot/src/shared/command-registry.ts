// Command Registry - Categorizes commands by execution time and side effects
//
// This registry maps each command to its execution quadrant, which determines:
// - IAM role and permissions
// - Timeout configuration
// - Queue assignment (future: separate queues per quadrant)
// - Approval requirements
//
// Quadrants:
// - short-read: Fast queries (<30s, read-only)
// - short-write: Fast mutations (<30s, write operations)
// - long-read: Slow queries (>30s, read-only)
// - long-write: Slow mutations (>30s, write operations)

/**
 * Command execution category based on time and side effects
 */
export type CommandCategory = 'short-read' | 'short-write' | 'long-read' | 'long-write';

/**
 * Metadata for a Slack command
 */
export interface CommandMetadata {
  /** Command name (e.g., "/check-status", "/deploy") */
  name: string;
  
  /** Execution quadrant */
  category: CommandCategory;
  
  /** Timeout in seconds */
  timeout: number;
  
  /** Whether command requires approval workflow */
  requiresApproval: boolean;
  
  /** AWS IAM permissions required */
  permissions: string[];
  
  /** Human-readable description */
  description: string;
}

/**
 * Command registry mapping command names to metadata
 */
export const COMMAND_REGISTRY: Record<string, CommandMetadata> = {
  // ========================================================================
  // SHORT + READ: Fast queries (<30s, read-only)
  // ========================================================================
  
  '/check-status': {
    name: '/check-status',
    category: 'short-read',
    timeout: 30,
    requiresApproval: false,
    permissions: [
      'cloudwatch:GetMetricData',
      'cloudwatch:GetMetricStatistics',
      'lambda:GetFunction',
      'lambda:ListFunctions',
      'ecs:DescribeServices',
      'ecs:DescribeClusters'
    ],
    description: 'Check system health and service status'
  },
  
  '/health': {
    name: '/health',
    category: 'short-read',
    timeout: 15,
    requiresApproval: false,
    permissions: [
      'cloudwatch:GetMetricData',
      'lambda:GetFunction',
      'ecs:DescribeServices'
    ],
    description: 'Quick health check of critical services'
  },
  
  '/metrics': {
    name: '/metrics',
    category: 'short-read',
    timeout: 20,
    requiresApproval: false,
    permissions: [
      'cloudwatch:GetMetricData',
      'cloudwatch:GetMetricStatistics',
      'cloudwatch:ListMetrics'
    ],
    description: 'Fetch real-time performance metrics'
  },
  
  '/echo': {
    name: '/echo',
    category: 'short-read',
    timeout: 10,
    requiresApproval: false,
    permissions: [],
    description: 'Test command that echoes back input (no AWS permissions needed)'
  },
  
  // ========================================================================
  // SHORT + WRITE: Fast mutations (<30s, write operations)
  // ========================================================================
  
  '/scale': {
    name: '/scale',
    category: 'short-write',
    timeout: 30,
    requiresApproval: true,
    permissions: [
      'ecs:UpdateService',
      'ecs:DescribeServices',
      'application-autoscaling:RegisterScalableTarget',
      'application-autoscaling:PutScalingPolicy'
    ],
    description: 'Scale ECS service task count'
  },
  
  '/restart': {
    name: '/restart',
    category: 'short-write',
    timeout: 30,
    requiresApproval: true,
    permissions: [
      'lambda:UpdateFunctionConfiguration',
      'ecs:UpdateService',
      'ecs:DescribeServices'
    ],
    description: 'Restart Lambda function or ECS service'
  },
  
  // ========================================================================
  // LONG + READ: Slow queries (>30s, read-only)
  // ========================================================================
  
  '/analyze': {
    name: '/analyze',
    category: 'long-read',
    timeout: 300,
    requiresApproval: false,
    permissions: [
      'athena:StartQueryExecution',
      'athena:GetQueryExecution',
      'athena:GetQueryResults',
      's3:GetObject',
      's3:ListBucket',
      'glue:GetTable',
      'glue:GetDatabase'
    ],
    description: 'Run analytical queries on data lake'
  },
  
  '/report': {
    name: '/report',
    category: 'long-read',
    timeout: 180,
    requiresApproval: false,
    permissions: [
      'cloudwatch:GetMetricData',
      'ce:GetCostAndUsage',
      'ce:GetCostForecast',
      's3:GetObject',
      's3:ListBucket'
    ],
    description: 'Generate cost and usage reports'
  },
  
  // ========================================================================
  // LONG + WRITE: Slow mutations (>30s, write operations)
  // ========================================================================
  
  '/deploy': {
    name: '/deploy',
    category: 'long-write',
    timeout: 600,
    requiresApproval: true,
    permissions: [
      'codedeploy:CreateDeployment',
      'codedeploy:GetDeployment',
      'ecs:UpdateService',
      'ecs:DescribeServices',
      'lambda:UpdateFunctionCode',
      'lambda:UpdateFunctionConfiguration',
      's3:GetObject',
      's3:PutObject'
    ],
    description: 'Deploy new version of application'
  },
  
  '/migrate': {
    name: '/migrate',
    category: 'long-write',
    timeout: 600,
    requiresApproval: true,
    permissions: [
      'rds:ModifyDBInstance',
      'rds:DescribeDBInstances',
      'dynamodb:UpdateTable',
      'dynamodb:DescribeTable',
      's3:PutObject',
      's3:GetObject'
    ],
    description: 'Run database migration scripts'
  },
  
  '/build': {
    name: '/build',
    category: 'long-write',
    timeout: 300,
    requiresApproval: false,
    permissions: [
      'codebuild:StartBuild',
      'codebuild:BatchGetBuilds',
      's3:PutObject',
      's3:GetObject'
    ],
    description: 'Trigger build pipeline'
  }
};

/**
 * Get metadata for a specific command
 * 
 * @param commandName - The command name (e.g., "/check-status")
 * @returns Command metadata or undefined if command not found
 */
export function getCommandMetadata(commandName: string): CommandMetadata | undefined {
  return COMMAND_REGISTRY[commandName];
}

/**
 * Get all commands in a specific category
 * 
 * @param category - The command category to filter by
 * @returns Array of command metadata matching the category
 */
export function getCommandsByCategory(category: CommandCategory): CommandMetadata[] {
  return Object.values(COMMAND_REGISTRY).filter(cmd => cmd.category === category);
}

/**
 * Get all commands that require approval
 * 
 * @returns Array of command metadata for commands requiring approval
 */
export function getCommandsRequiringApproval(): CommandMetadata[] {
  return Object.values(COMMAND_REGISTRY).filter(cmd => cmd.requiresApproval);
}

/**
 * Validate if a command exists in the registry
 * 
 * @param commandName - The command name to check
 * @returns True if command exists in registry
 */
export function isValidCommand(commandName: string): boolean {
  return commandName in COMMAND_REGISTRY;
}

/**
 * Get all unique permissions across all commands in a category
 * 
 * @param category - The command category
 * @returns Array of unique permission strings
 */
export function getCategoryPermissions(category: CommandCategory): string[] {
  const commands = getCommandsByCategory(category);
  const allPermissions = commands.flatMap(cmd => cmd.permissions);
  return [...new Set(allPermissions)];
}
