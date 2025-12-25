/**
 * Minimal Slack Web API test using bot token
 * Fetches token from env (local) or SSM-style env var when running locally.
 * Posts a message to the provided channel.
 *
 * Usage:
 *   ENVIRONMENT=local SLACK_BOT_TOKEN=xoxb-... 
 *   ts-node scripts/test-slack-post.ts "#test-channel" "Hello from local test"
 */

import axios from 'axios';

async function main() {
  const [channel, text] = process.argv.slice(2);
  const token = process.env.SLACK_BOT_TOKEN;

  if (!channel || !text) {
    console.error('Usage: ts-node scripts/test-slack-post.ts <channel> <text>');
    process.exit(1);
  }
  if (!token) {
    console.error('Error: Set SLACK_BOT_TOKEN environment variable');
    process.exit(1);
  }

  try {
    const resp = await axios.post(
      'https://slack.com/api/chat.postMessage',
      { channel, text },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    if (!resp.data.ok) {
      console.error('Slack API error:', resp.data);
      process.exit(1);
    }

    console.log('Message sent. ts:', resp.data.ts, 'channel:', resp.data.channel);
  } catch (err: any) {
    console.error('Failed to call Slack API:', err.response?.status, err.response?.data || err.message);
    process.exit(1);
  }
}

main();
