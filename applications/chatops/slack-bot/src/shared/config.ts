// Application configuration from environment variables

export interface AppConfig {
  orgPrefix: string;
  environment: string;
  awsRegion: string;
  parameterPrefix: string;
  eventBridgeBusName: string;
  logLevel: string;
  isLocal: boolean;
}

class Configuration {
  private config: AppConfig;

  constructor() {
    this.config = {
      orgPrefix: process.env.ORG_PREFIX || 'laco',
      environment: process.env.ENVIRONMENT || 'local',
      awsRegion: process.env.AWS_REGION || 'ca-central-1',
      parameterPrefix: process.env.AWS_PARAMETER_PREFIX || '/laco/local',
      eventBridgeBusName: process.env.EVENTBRIDGE_BUS_NAME || 'laco-local-chatbot',
      logLevel: process.env.LOG_LEVEL || 'info',
      isLocal: process.env.ENVIRONMENT === 'local'
    };
  }

  get(): AppConfig {
    return this.config;
  }

  getParameterPath(secretName: string): string {
    return `${this.config.parameterPrefix}/aws/secrets/${secretName}`;
  }

  getResourceName(resourceType: string, name: string): string {
    return `${this.config.orgPrefix}-${this.config.environment}-${resourceType}-${name}`;
  }

  isDevelopment(): boolean {
    return this.config.environment === 'local' || this.config.environment === 'dev';
  }

  isProduction(): boolean {
    return this.config.environment === 'prd';
  }
}

export const config = new Configuration();
