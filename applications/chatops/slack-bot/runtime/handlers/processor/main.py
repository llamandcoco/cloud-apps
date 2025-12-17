"""
Slack Bot Processor (Python)

ARCHITECTURE:
- Processes data from Slack commands
- Analyzes and generates reports
- Demonstrates Python Lambda with secure secret retrieval

SECURITY:
- Fetches secrets at runtime from Parameter Store
- Uses IAM-based access (no secrets in environment)
- Parameter paths hardcoded in code
"""

import json
import os
import time
from datetime import datetime
from typing import Dict, Any, Optional
import boto3
from botocore.exceptions import ClientError

# ============================================================================
# Configuration
# ============================================================================

ENVIRONMENT = os.environ.get('ENVIRONMENT', 'staging')
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO')

# AWS clients
ssm_client = boto3.client('ssm')

# ============================================================================
# Secret Management - RUNTIME RETRIEVAL PATTERN (Python)
# ============================================================================

class SecretCache:
    """
    Secret cache with expiration
    
    WHY CACHE?
    - Reduces Parameter Store API calls
    - Improves performance
    - Reduces cost
    
    WHY EXPIRATION?
    - Allows secret rotation
    - Balances performance and security
    """
    
    def __init__(self, ttl_seconds: int = 300):
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._ttl_seconds = ttl_seconds
    
    def get(self, key: str) -> Optional[str]:
        """Get cached secret if not expired"""
        if key not in self._cache:
            return None
        
        entry = self._cache[key]
        if entry['expires_at'] > time.time():
            log('DEBUG', f"Using cached secret: {key}")
            return entry['value']
        
        # Expired - remove from cache
        del self._cache[key]
        return None
    
    def set(self, key: str, value: str) -> None:
        """Cache secret with expiration"""
        self._cache[key] = {
            'value': value,
            'expires_at': time.time() + self._ttl_seconds
        }

# Global secret cache
_secret_cache = SecretCache(ttl_seconds=300)  # 5 minutes


def get_secret(parameter_name: str) -> str:
    """
    Fetch secret from Parameter Store with caching
    
    SECURITY PATTERN:
    ✅ Parameter path is hardcoded in code
    ✅ No environment variables with paths
    ✅ IAM policy restricts access to /slack-bot/{environment}/*
    ✅ Encryption enabled (WithDecryption=True)
    
    Args:
        parameter_name: Parameter Store path
        
    Returns:
        Secret value
        
    Raises:
        Exception: If parameter not found or access denied
    """
    # Check cache first
    cached = _secret_cache.get(parameter_name)
    if cached is not None:
        return cached
    
    log('INFO', f"Fetching secret from Parameter Store: {parameter_name}")
    
    try:
        response = ssm_client.get_parameter(
            Name=parameter_name,
            WithDecryption=True  # CRITICAL: Enable decryption
        )
        
        if 'Parameter' not in response or 'Value' not in response['Parameter']:
            raise Exception(f"Parameter {parameter_name} not found or empty")
        
        value = response['Parameter']['Value']
        
        # Cache the secret
        _secret_cache.set(parameter_name, value)
        
        return value
        
    except ClientError as e:
        # ✅ GOOD: Error doesn't leak secret value
        log('ERROR', f"Failed to fetch secret {parameter_name}: {e}")
        raise Exception(f"Failed to retrieve secret: {parameter_name}")


def get_api_key() -> str:
    """
    Get API key for external service
    
    SECURITY:
    - Path is HARDCODED, not from environment
    - Environment variable only selects which path to use
    """
    # ✅ GOOD: Hardcoded path with environment selector
    parameter_path = f"/slack-bot/{ENVIRONMENT}/api-key"
    return get_secret(parameter_path)


def get_webhook_url() -> str:
    """Get webhook URL for notifications"""
    # ✅ GOOD: Hardcoded path
    parameter_path = f"/slack-bot/{ENVIRONMENT}/webhook-url"
    return get_secret(parameter_path)


# ============================================================================
# Data Processing
# ============================================================================

def process_data(intent: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process data based on intent
    
    This is where you'd implement your actual data processing logic.
    For example:
    - Analyze AWS costs
    - Generate infrastructure reports
    - Process Slack user data
    - Aggregate metrics
    
    Args:
        intent: Intent object with operation and parameters
        
    Returns:
        Processing result
    """
    operation = intent.get('operation', 'unknown')
    parameters = intent.get('parameters', {})
    
    log('INFO', f"Processing operation: {operation}")
    
    # Example processing operations
    if operation == 'cost-report':
        return generate_cost_report(parameters)
    elif operation == 'infra-audit':
        return audit_infrastructure(parameters)
    elif operation == 'user-stats':
        return analyze_user_stats(parameters)
    else:
        return {
            'status': 'unknown_operation',
            'message': f"Unknown operation: {operation}"
        }


def generate_cost_report(parameters: Dict[str, Any]) -> Dict[str, Any]:
    """
    Generate AWS cost report
    
    DEMONSTRATES:
    - Using Python for data processing
    - Fetching secrets for API access
    - Returning structured data
    """
    log('INFO', "Generating cost report")
    
    # Fetch API key for cost API (if using external service)
    try:
        api_key = get_api_key()
        log('INFO', "API key retrieved successfully")
    except Exception as e:
        log('ERROR', f"Failed to retrieve API key: {e}")
        return {
            'status': 'error',
            'message': 'Failed to retrieve API credentials'
        }
    
    # Example: Query AWS Cost Explorer
    # In production, you'd use boto3 to query Cost Explorer
    # ce_client = boto3.client('ce')
    # response = ce_client.get_cost_and_usage(...)
    
    # For demo, return mock data
    return {
        'status': 'success',
        'report': {
            'period': parameters.get('period', 'last_30_days'),
            'total_cost': 1234.56,
            'breakdown': {
                'compute': 800.00,
                'storage': 234.56,
                'network': 200.00
            }
        },
        'generated_at': datetime.utcnow().isoformat()
    }


def audit_infrastructure(parameters: Dict[str, Any]) -> Dict[str, Any]:
    """Audit infrastructure configuration"""
    log('INFO', "Auditing infrastructure")
    
    # Example audit checks
    return {
        'status': 'success',
        'audit': {
            'checks_passed': 42,
            'checks_failed': 3,
            'warnings': 7,
            'findings': [
                'S3 bucket public access detected',
                'Unused security groups found',
                'EC2 instances without tags'
            ]
        },
        'audited_at': datetime.utcnow().isoformat()
    }


def analyze_user_stats(parameters: Dict[str, Any]) -> Dict[str, Any]:
    """Analyze user statistics"""
    log('INFO', "Analyzing user statistics")
    
    return {
        'status': 'success',
        'stats': {
            'active_users': 156,
            'commands_executed': 2341,
            'most_used_command': 'cost-report'
        },
        'analyzed_at': datetime.utcnow().isoformat()
    }


# ============================================================================
# Notification
# ============================================================================

def send_notification(result: Dict[str, Any], callback_url: Optional[str]) -> None:
    """
    Send notification with processing result
    
    DEMONSTRATES:
    - Using webhook URL from Parameter Store
    - Secure callback to Slack
    """
    if not callback_url:
        log('INFO', "No callback URL provided, skipping notification")
        return
    
    try:
        # In production, you'd use requests library to POST to callback_url
        # import requests
        # requests.post(callback_url, json=notification_data)
        
        log('INFO', f"Notification sent to {callback_url[:20]}...")
    except Exception as e:
        log('ERROR', f"Failed to send notification: {e}")


# ============================================================================
# Lambda Handler
# ============================================================================

def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Main Lambda handler
    
    FLOW:
    1. Parse intent from event
    2. Process data based on operation
    3. Send notification with result
    4. Return processing result
    
    Args:
        event: Lambda event (direct invoke or custom source)
        context: Lambda context
        
    Returns:
        Processing result
    """
    try:
        log('INFO', "Processor handler invoked")
        
        # Parse intent
        # Event can be direct invoke or from another service
        if isinstance(event, str):
            intent = json.loads(event)
        else:
            intent = event
        
        log('INFO', f"Processing intent: {intent.get('id', 'unknown')}")
        
        # Process data
        result = process_data(intent)
        
        # Send notification
        callback_url = intent.get('callbackUrl')
        send_notification(result, callback_url)
        
        log('INFO', "Processing completed successfully")
        
        return {
            'statusCode': 200,
            'body': json.dumps(result)
        }
        
    except Exception as e:
        log('ERROR', f"Handler error: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({
                'status': 'error',
                'message': 'Internal processing error'
            })
        }


# ============================================================================
# Utilities
# ============================================================================

def log(level: str, message: str) -> None:
    """
    Structured logging
    
    CloudWatch Logs will capture these as JSON for easy querying
    """
    levels = {
        'DEBUG': 0,
        'INFO': 1,
        'WARN': 2,
        'ERROR': 3
    }
    
    current_level = levels.get(LOG_LEVEL, 1)
    message_level = levels.get(level, 1)
    
    if message_level >= current_level:
        print(json.dumps({
            'level': level,
            'message': message,
            'timestamp': datetime.utcnow().isoformat()
        }))


# ============================================================================
# Example Usage
# ============================================================================

if __name__ == '__main__':
    # Local testing
    test_event = {
        'id': 'test-intent-123',
        'operation': 'cost-report',
        'parameters': {
            'period': 'last_7_days'
        },
        'requestedBy': 'user123',
        'requestedAt': datetime.utcnow().isoformat(),
        'cloud': 'aws'
    }
    
    result = handler(test_event, None)
    print(json.dumps(result, indent=2))
