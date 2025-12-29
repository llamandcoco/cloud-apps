// Type definitions for Slack events and responses

export interface SlackCommand {
  command: string;
  text: string;
  response_url: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  channel_name: string;
  team_id: string;
  team_domain: string;
  trigger_id: string;
}

export interface SlackResponse {
  response_type: 'ephemeral' | 'in_channel';
  text: string;
  blocks?: SlackBlock[];
}

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
  };
  elements?: unknown[];
}

export interface EventBridgeEvent {
  source: string;
  'detail-type': string;
  detail: SlackCommand;
}

export interface WorkerMessage {
  command: string;
  text: string;
  response_url: string;
  user_id: string;
  user_name: string;
  channel_id: string;
  correlation_id?: string; // For request tracing (Slack timestamp)
}
