// Slack Block Kit templates for EKS deployment approval workflow

import { DeploymentRequest } from './dynamodb-client';

export interface SlackMessage {
  channel?: string;
  text: string;
  blocks?: any[];
  replace_original?: boolean;
  response_type?: 'in_channel' | 'ephemeral';
}

/**
 * Create approval request message with interactive buttons
 */
export function createApprovalMessage(request: DeploymentRequest): SlackMessage {
  const action = request.deployment_type === 'create_cluster' ? 'Creation' : 'Deletion';
  const emoji = request.deployment_type === 'create_cluster' ? '🚀' : '🗑️';
  const { cluster_name, environment, version } = request.cluster_config;

  return {
    text: `EKS Cluster ${action} Approval Request`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `${emoji} EKS Cluster ${action} Request`,
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Cluster:*\n\`${cluster_name}\``
          },
          {
            type: 'mrkdwn',
            text: `*Environment:*\n\`${environment}\``
          },
          {
            type: 'mrkdwn',
            text: `*Action:*\n${action}`
          },
          {
            type: 'mrkdwn',
            text: `*Scheduled:*\n${new Date(request.scheduled_time).toLocaleString('en-US', { timeZone: 'America/Toronto' })}`
          }
        ]
      },
      ...(version ? [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Kubernetes Version:* \`${version}\``
        }
      }] : []),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Request ID: \`${request.request_id}\``
          }
        ]
      },
      {
        type: 'divider'
      },
      {
        type: 'actions',
        block_id: `approval_${request.request_id}`,
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Approve ✓',
              emoji: true
            },
            style: 'primary',
            value: request.request_id,
            action_id: 'approve_deployment'
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Deny ✗',
              emoji: true
            },
            style: 'danger',
            value: request.request_id,
            action_id: 'deny_deployment'
          }
        ]
      }
    ]
  };
}

/**
 * Create retry reminder message
 */
export function createRetryMessage(request: DeploymentRequest): SlackMessage {
  const action = request.deployment_type === 'create_cluster' ? 'Creation' : 'Deletion';
  const { cluster_name, environment } = request.cluster_config;

  return {
    text: `🔔 [Reminder ${request.retry_count}/${request.max_retries}] EKS Cluster ${action} Approval Needed`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `🔔 Reminder: EKS Cluster ${action} Approval Needed`,
          emoji: true
        }
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Cluster:* \`${cluster_name}\`\n*Environment:* \`${environment}\`\n*Retry:* ${request.retry_count}/${request.max_retries}`
        }
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `⏰ Will remind again in ${request.retry_interval_minutes} minutes.`
          }
        ]
      },
      {
        type: 'actions',
        block_id: `approval_${request.request_id}`,
        elements: [
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Approve ✓',
              emoji: true
            },
            style: 'primary',
            value: request.request_id,
            action_id: 'approve_deployment'
          },
          {
            type: 'button',
            text: {
              type: 'plain_text',
              text: 'Deny ✗',
              emoji: true
            },
            style: 'danger',
            value: request.request_id,
            action_id: 'deny_deployment'
          }
        ]
      }
    ]
  };
}

/**
 * Create approval completed message (replaces original)
 */
export function createApprovedMessage(user_id: string, action: string): SlackMessage {
  return {
    replace_original: true,
    text: `✅ Deployment Approved by <@${user_id}>`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `✅ *Deployment Approved*\n${action} will start shortly.\nApproved by: <@${user_id}>`
        }
      }
    ]
  };
}

/**
 * Create denial message (replaces original)
 */
export function createDeniedMessage(user_id: string): SlackMessage {
  return {
    replace_original: true,
    text: `❌ Deployment Denied by <@${user_id}>`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `❌ *Deployment Denied*\nOperation has been cancelled.\nDenied by: <@${user_id}>`
        }
      }
    ]
  };
}

/**
 * Create expired message
 */
export function createExpiredMessage(request: DeploymentRequest): SlackMessage {
  const { cluster_name } = request.cluster_config;

  return {
    text: `⏰ Deployment Approval Request Expired: ${cluster_name}`,
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `⏰ *Deployment Approval Request Expired*\n\nCluster: \`${cluster_name}\`\nMaximum retry attempts (${request.max_retries}) exceeded.\n\nRequest ID: \`${request.request_id}\``
        }
      }
    ]
  };
}

/**
 * Create success notification
 */
export function createSuccessMessage(request: DeploymentRequest, logs_url?: string, duration?: number): SlackMessage {
  const action = request.deployment_type === 'create_cluster' ? 'Creation' : 'Deletion';
  const { cluster_name, environment } = request.cluster_config;

  return {
    text: `✅ EKS Cluster ${action} Completed: ${cluster_name}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `✅ EKS Cluster ${action} Completed`,
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Cluster:*\n\`${cluster_name}\``
          },
          {
            type: 'mrkdwn',
            text: `*Environment:*\n\`${environment}\``
          },
          {
            type: 'mrkdwn',
            text: `*Status:*\n✅ Success`
          },
          ...(duration ? [{
            type: 'mrkdwn',
            text: `*Duration:*\n${Math.round(duration / 60)} minutes`
          }] : [])
        ]
      },
      ...(logs_url ? [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${logs_url}|📋 View CloudWatch Logs>`
        }
      }] : []),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Request ID: \`${request.request_id}\` | ${new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' })}`
          }
        ]
      }
    ]
  };
}

/**
 * Create failure notification
 */
export function createFailureMessage(request: DeploymentRequest, error_message: string, logs_url?: string): SlackMessage {
  const action = request.deployment_type === 'create_cluster' ? 'Creation' : 'Deletion';
  const { cluster_name, environment } = request.cluster_config;

  return {
    text: `❌ EKS Cluster ${action} Failed: ${cluster_name}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `❌ EKS Cluster ${action} Failed`,
          emoji: true
        }
      },
      {
        type: 'section',
        fields: [
          {
            type: 'mrkdwn',
            text: `*Cluster:*\n\`${cluster_name}\``
          },
          {
            type: 'mrkdwn',
            text: `*Environment:*\n\`${environment}\``
          }
        ]
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Error:*\n\`\`\`${error_message}\`\`\``
        }
      },
      ...(logs_url ? [{
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `<${logs_url}|📋 View CloudWatch Logs>`
        }
      }] : []),
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `Request ID: \`${request.request_id}\` | ${new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' })}`
          }
        ]
      }
    ]
  };
}
