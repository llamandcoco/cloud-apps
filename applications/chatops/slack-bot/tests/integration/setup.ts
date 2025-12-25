/**
 * Setup file for integration tests
 * Configures LocalStack endpoints and AWS SDK clients
 */

import { config } from '../../src/shared/config';

// Set environment for LocalStack
process.env.ENVIRONMENT = 'local';
process.env.AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
process.env.AWS_REGION = 'ca-central-1';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.EVENTBRIDGE_BUS_NAME = 'laco-local-chatbot';

// Verify LocalStack is running
beforeAll(async () => {
  const maxRetries = 10;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      const response = await fetch(`${process.env.AWS_ENDPOINT_URL}/health`);
      if (response.ok) {
        console.log('✓ LocalStack is running');
        return;
      }
    } catch (error) {
      attempt++;
      if (attempt < maxRetries) {
        console.log(`LocalStack not ready, retrying... (${attempt}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }

  throw new Error('LocalStack failed to start. Run: docker-compose -f docker-compose.local.yml up -d');
});
