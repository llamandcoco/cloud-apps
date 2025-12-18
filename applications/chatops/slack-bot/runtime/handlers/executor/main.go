package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-lambda-go/events"
	"github.com/aws/aws-lambda-go/lambda"
	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/session"
	"github.com/aws/aws-sdk-go/service/ssm"
)

// ============================================================================
// Configuration
// ============================================================================

var (
	environment = getEnv("ENVIRONMENT", "staging")
	logLevel    = strings.ToUpper(getEnv("LOG_LEVEL", "INFO"))
)

// ============================================================================
// Types
// ============================================================================

// Intent represents an operation to be executed
type Intent struct {
	ID          string                 `json:"id"`
	Operation   string                 `json:"operation"`
	Parameters  map[string]interface{} `json:"parameters"`
	RequestedBy string                 `json:"requestedBy"`
	RequestedAt string                 `json:"requestedAt"`
	Cloud       string                 `json:"cloud"`
	CallbackURL string                 `json:"callbackUrl,omitempty"`
}

// OperationResult represents the result of an operation
type OperationResult struct {
	Status    string                 `json:"status"`
	Message   string                 `json:"message"`
	Data      map[string]interface{} `json:"data,omitempty"`
	Error     string                 `json:"error,omitempty"`
	Timestamp string                 `json:"timestamp"`
}

// ============================================================================
// Secret Management - RUNTIME RETRIEVAL PATTERN (Go)
// ============================================================================

// SecretCache provides thread-safe caching of secrets with expiration
//
// WHY CACHE?
// - Reduces Parameter Store API calls
// - Improves performance
// - Reduces cost
//
// WHY EXPIRATION?
// - Allows secret rotation
// - Balances performance and security
type SecretCache struct {
	cache map[string]*cachedSecret
	mutex sync.RWMutex
	ttl   time.Duration
}

type cachedSecret struct {
	value     string
	expiresAt time.Time
}

// NewSecretCache creates a new secret cache with the given TTL
func NewSecretCache(ttl time.Duration) *SecretCache {
	return &SecretCache{
		cache: make(map[string]*cachedSecret),
		ttl:   ttl,
	}
}

// Get retrieves a secret from cache if not expired
func (sc *SecretCache) Get(key string) (string, bool) {
	sc.mutex.RLock()
	defer sc.mutex.RUnlock()

	cached, exists := sc.cache[key]
	if !exists {
		return "", false
	}

	if time.Now().After(cached.expiresAt) {
		return "", false
	}

	logDebug(fmt.Sprintf("Using cached secret: %s", key))
	return cached.value, true
}

// Set stores a secret in cache with expiration
func (sc *SecretCache) Set(key, value string) {
	sc.mutex.Lock()
	defer sc.mutex.Unlock()

	// Clean up expired entries while we have the write lock
	now := time.Now()
	for k, cached := range sc.cache {
		if now.After(cached.expiresAt) {
			delete(sc.cache, k)
		}
	}

	sc.cache[key] = &cachedSecret{
		value:     value,
		expiresAt: now.Add(sc.ttl),
	}
}

// Global secret cache (5 minute TTL)
var secretCache = NewSecretCache(5 * time.Minute)

// SSM client
var ssmClient *ssm.SSM

func init() {
	sess := session.Must(session.NewSession())
	ssmClient = ssm.New(sess)
}

// GetSecret fetches a secret from Parameter Store with caching
//
// SECURITY PATTERN:
// ✅ Parameter path is hardcoded in code
// ✅ No environment variables with paths
// ✅ IAM policy restricts access to /slack-bot/{environment}/*
// ✅ Encryption enabled (WithDecryption: true)
func GetSecret(parameterName string) (string, error) {
	// Check cache first
	if value, found := secretCache.Get(parameterName); found {
		return value, nil
	}

	logInfo(fmt.Sprintf("Fetching secret from Parameter Store: %s", parameterName))

	input := &ssm.GetParameterInput{
		Name:           aws.String(parameterName),
		WithDecryption: aws.Bool(true), // CRITICAL: Enable decryption
	}

	result, err := ssmClient.GetParameter(input)
	if err != nil {
		// ✅ GOOD: Error doesn't leak secret value
		logError(fmt.Sprintf("Failed to fetch secret %s: %v", parameterName, err))
		return "", fmt.Errorf("failed to retrieve secret: %s", parameterName)
	}

	if result.Parameter == nil || result.Parameter.Value == nil {
		return "", fmt.Errorf("parameter %s not found or empty", parameterName)
	}

	value := *result.Parameter.Value

	// Cache the secret
	secretCache.Set(parameterName, value)

	return value, nil
}

// GetGCPCredentials retrieves GCP service account credentials
//
// SECURITY:
// - Path is HARDCODED, not from environment
// - Environment variable only selects which path to use
func GetGCPCredentials() (string, error) {
	// ✅ GOOD: Hardcoded path with environment selector
	parameterPath := fmt.Sprintf("/slack-bot/%s/gcp-credentials", environment)
	return GetSecret(parameterPath)
}

// GetAzureCredentials retrieves Azure credentials
func GetAzureCredentials() (string, error) {
	// ✅ GOOD: Hardcoded path
	parameterPath := fmt.Sprintf("/slack-bot/%s/azure-credentials", environment)
	return GetSecret(parameterPath)
}

// ============================================================================
// Multi-Cloud Adapter Pattern
// ============================================================================

// CloudExecutor interface defines standard operations for all cloud providers
//
// WHY INTERFACE?
// - Standard contract for all cloud adapters
// - Easy to add new clouds without changing core logic
// - Testable in isolation
// - Cloud-specific logic is encapsulated
type CloudExecutor interface {
	Execute(ctx context.Context, intent Intent) (*OperationResult, error)
	ValidateAccess(ctx context.Context) error
	GetMetadata() CloudMetadata
}

// CloudMetadata provides information about the cloud provider
type CloudMetadata struct {
	Provider string `json:"provider"`
	Region   string `json:"region"`
	Version  string `json:"version"`
}

// ============================================================================
// AWS Adapter
// ============================================================================

// AWSExecutor implements CloudExecutor for AWS
type AWSExecutor struct {
	region string
}

// NewAWSExecutor creates a new AWS executor
func NewAWSExecutor() *AWSExecutor {
	return &AWSExecutor{
		region: getEnv("AWS_REGION", "us-east-1"),
	}
}

// Execute runs an operation on AWS
func (e *AWSExecutor) Execute(ctx context.Context, intent Intent) (*OperationResult, error) {
	logInfo(fmt.Sprintf("Executing AWS operation: %s", intent.Operation))

	// Example operations
	switch intent.Operation {
	case "list-instances":
		return e.listInstances(ctx, intent.Parameters)
	case "create-vm":
		return e.createVM(ctx, intent.Parameters)
	default:
		return &OperationResult{
			Status:    "error",
			Message:   "Unknown operation",
			Error:     fmt.Sprintf("Operation not supported: %s", intent.Operation),
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}, nil
	}
}

// ValidateAccess checks if we have valid AWS credentials
func (e *AWSExecutor) ValidateAccess(ctx context.Context) error {
	// In production, you'd verify STS caller identity
	return nil
}

// GetMetadata returns AWS metadata
func (e *AWSExecutor) GetMetadata() CloudMetadata {
	return CloudMetadata{
		Provider: "aws",
		Region:   e.region,
		Version:  "1.0.0",
	}
}

func (e *AWSExecutor) listInstances(ctx context.Context, params map[string]interface{}) (*OperationResult, error) {
	// Example: Use AWS SDK to list EC2 instances
	// In production: ec2.DescribeInstances(...)

	return &OperationResult{
		Status:  "success",
		Message: "Instances listed successfully",
		Data: map[string]interface{}{
			"instances": []string{"i-1234567890abcdef0", "i-0987654321fedcba0"},
			"count":     2,
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (e *AWSExecutor) createVM(ctx context.Context, params map[string]interface{}) (*OperationResult, error) {
	instanceType := params["instance-type"]
	if instanceType == nil {
		instanceType = "t3.micro"
	}

	// Example: Use AWS SDK to create EC2 instance
	// In production: ec2.RunInstances(...)

	return &OperationResult{
		Status:  "success",
		Message: "VM created successfully",
		Data: map[string]interface{}{
			"instance_id":   "i-newinstance123",
			"instance_type": instanceType,
			"state":         "pending",
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

// ============================================================================
// GCP Adapter
// ============================================================================

// GCPExecutor implements CloudExecutor for Google Cloud Platform
type GCPExecutor struct {
	credentials string
}

// NewGCPExecutor creates a new GCP executor
func NewGCPExecutor() (*GCPExecutor, error) {
	// ✅ SECURITY: Fetch credentials at runtime
	credentials, err := GetGCPCredentials()
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve GCP credentials: %w", err)
	}

	return &GCPExecutor{
		credentials: credentials,
	}, nil
}

// Execute runs an operation on GCP
func (e *GCPExecutor) Execute(ctx context.Context, intent Intent) (*OperationResult, error) {
	logInfo(fmt.Sprintf("Executing GCP operation: %s", intent.Operation))

	// Parse credentials (in production, use proper JSON parsing)
	// credentialsJSON := json.Unmarshal(e.credentials)

	switch intent.Operation {
	case "list-instances":
		return e.listInstances(ctx, intent.Parameters)
	case "create-vm":
		return e.createVM(ctx, intent.Parameters)
	default:
		return &OperationResult{
			Status:    "error",
			Message:   "Unknown operation",
			Error:     fmt.Sprintf("Operation not supported: %s", intent.Operation),
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}, nil
	}
}

// ValidateAccess checks if we have valid GCP credentials
func (e *GCPExecutor) ValidateAccess(ctx context.Context) error {
	// In production, verify credentials by making a test API call
	return nil
}

// GetMetadata returns GCP metadata
func (e *GCPExecutor) GetMetadata() CloudMetadata {
	return CloudMetadata{
		Provider: "gcp",
		Region:   "us-central1",
		Version:  "1.0.0",
	}
}

func (e *GCPExecutor) listInstances(ctx context.Context, params map[string]interface{}) (*OperationResult, error) {
	// Example: Use GCP SDK to list compute instances
	// In production: compute.Instances.List(...)

	logInfo("Listing GCP instances")

	return &OperationResult{
		Status:  "success",
		Message: "GCP instances listed successfully",
		Data: map[string]interface{}{
			"instances": []string{"instance-1", "instance-2"},
			"count":     2,
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (e *GCPExecutor) createVM(ctx context.Context, params map[string]interface{}) (*OperationResult, error) {
	machineType := params["machine-type"]
	if machineType == nil {
		machineType = "e2-micro"
	}

	logInfo(fmt.Sprintf("Creating GCP VM: %v", machineType))

	return &OperationResult{
		Status:  "success",
		Message: "GCP VM created successfully",
		Data: map[string]interface{}{
			"instance_name": "new-instance-gcp",
			"machine_type":  machineType,
			"status":        "PROVISIONING",
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

// ============================================================================
// Azure Adapter
// ============================================================================

// AzureExecutor implements CloudExecutor for Microsoft Azure
type AzureExecutor struct {
	credentials string
}

// NewAzureExecutor creates a new Azure executor
func NewAzureExecutor() (*AzureExecutor, error) {
	// ✅ SECURITY: Fetch credentials at runtime
	credentials, err := GetAzureCredentials()
	if err != nil {
		return nil, fmt.Errorf("failed to retrieve Azure credentials: %w", err)
	}

	return &AzureExecutor{
		credentials: credentials,
	}, nil
}

// Execute runs an operation on Azure
func (e *AzureExecutor) Execute(ctx context.Context, intent Intent) (*OperationResult, error) {
	logInfo(fmt.Sprintf("Executing Azure operation: %s", intent.Operation))

	switch intent.Operation {
	case "list-instances":
		return e.listInstances(ctx, intent.Parameters)
	case "create-vm":
		return e.createVM(ctx, intent.Parameters)
	default:
		return &OperationResult{
			Status:    "error",
			Message:   "Unknown operation",
			Error:     fmt.Sprintf("Operation not supported: %s", intent.Operation),
			Timestamp: time.Now().UTC().Format(time.RFC3339),
		}, nil
	}
}

// ValidateAccess checks if we have valid Azure credentials
func (e *AzureExecutor) ValidateAccess(ctx context.Context) error {
	return nil
}

// GetMetadata returns Azure metadata
func (e *AzureExecutor) GetMetadata() CloudMetadata {
	return CloudMetadata{
		Provider: "azure",
		Region:   "eastus",
		Version:  "1.0.0",
	}
}

func (e *AzureExecutor) listInstances(ctx context.Context, params map[string]interface{}) (*OperationResult, error) {
	logInfo("Listing Azure VMs")

	return &OperationResult{
		Status:  "success",
		Message: "Azure VMs listed successfully",
		Data: map[string]interface{}{
			"instances": []string{"vm-1", "vm-2"},
			"count":     2,
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func (e *AzureExecutor) createVM(ctx context.Context, params map[string]interface{}) (*OperationResult, error) {
	vmSize := params["vm-size"]
	if vmSize == nil {
		vmSize = "Standard_B1s"
	}

	logInfo(fmt.Sprintf("Creating Azure VM: %v", vmSize))

	return &OperationResult{
		Status:  "success",
		Message: "Azure VM created successfully",
		Data: map[string]interface{}{
			"vm_name": "new-vm-azure",
			"vm_size": vmSize,
			"state":   "Creating",
		},
		Timestamp: time.Now().UTC().Format(time.RFC3339),
	}, nil
}

// ============================================================================
// Executor Factory
// ============================================================================

// GetExecutor returns the appropriate cloud executor based on cloud provider
//
// HOW TO ADD A NEW CLOUD:
// 1. Implement CloudExecutor interface
// 2. Add case in this switch statement
// 3. Add credentials to Parameter Store
// 4. Grant IAM permissions
// 5. Test in isolation
func GetExecutor(cloud string) (CloudExecutor, error) {
	switch cloud {
	case "aws":
		return NewAWSExecutor(), nil
	case "gcp":
		return NewGCPExecutor()
	case "azure":
		return NewAzureExecutor()
	default:
		return nil, fmt.Errorf("unknown cloud provider: %s", cloud)
	}
}

// ============================================================================
// Lambda Handler
// ============================================================================

// Handler processes SQS events containing intents
//
// FLOW:
// 1. Parse intents from SQS messages
// 2. Select appropriate cloud executor
// 3. Execute operation
// 4. Return result
func Handler(ctx context.Context, sqsEvent events.SQSEvent) error {
	logInfo(fmt.Sprintf("Processing %d messages", len(sqsEvent.Records)))

	for _, record := range sqsEvent.Records {
		if err := processIntent(ctx, record.Body); err != nil {
			logError(fmt.Sprintf("Failed to process intent: %v", err))
			// Continue processing other messages
		}
	}

	return nil
}

func processIntent(ctx context.Context, body string) error {
	// Parse intent
	var intent Intent
	if err := json.Unmarshal([]byte(body), &intent); err != nil {
		return fmt.Errorf("failed to parse intent: %w", err)
	}

	logInfo(fmt.Sprintf("Processing intent: %s - %s on %s", intent.ID, intent.Operation, intent.Cloud))

	// Get cloud executor
	executor, err := GetExecutor(intent.Cloud)
	if err != nil {
		return fmt.Errorf("failed to get executor: %w", err)
	}

	// Validate access
	if err := executor.ValidateAccess(ctx); err != nil {
		return fmt.Errorf("access validation failed: %w", err)
	}

	// Execute operation
	result, err := executor.Execute(ctx, intent)
	if err != nil {
		return fmt.Errorf("execution failed: %w", err)
	}

	logInfo(fmt.Sprintf("Execution completed: %s - %s", intent.ID, result.Status))

	// In production, send result to callback URL
	if intent.CallbackURL != "" {
		// sendCallback(intent.CallbackURL, result)
		logInfo(fmt.Sprintf("Result would be sent to: %s", intent.CallbackURL))
	}

	return nil
}

// ============================================================================
// Utilities
// ============================================================================

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func logInfo(message string) {
	logMessage("INFO", message)
}

func logDebug(message string) {
	logMessage("DEBUG", message)
}

func logError(message string) {
	logMessage("ERROR", message)
}

func logMessage(level, message string) {
	levels := map[string]int{
		"DEBUG": 0,
		"INFO":  1,
		"WARN":  2,
		"ERROR": 3,
	}

	currentLevel := levels[logLevel]
	messageLevel := levels[level]

	if messageLevel >= currentLevel {
		logData := map[string]string{
			"level":     level,
			"message":   message,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
		}

		jsonData, _ := json.Marshal(logData)
		log.Println(string(jsonData))
	}
}

// ============================================================================
// Main
// ============================================================================

func main() {
	lambda.Start(Handler)
}
