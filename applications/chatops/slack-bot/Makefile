# =============================================================================
# Slack Bot - Makefile
# =============================================================================

.PHONY: help build upload deploy test clean

# -----------------------------------------------------------------------------
# Variables
# -----------------------------------------------------------------------------

# AWS Configuration (override with: make upload-echo AWS_PROFILE=your-profile)
AWS_PROFILE ?=
ENVIRONMENT := plt
REGION := ca-central-1
VERSION := $(shell git rev-parse --short HEAD 2>/dev/null || echo "local")

# AWS CLI command with optional profile
AWS_CMD := aws $(if $(AWS_PROFILE),--profile $(AWS_PROFILE),)

# Paths
SANDBOX_ROOT := ../../../../cloud-sandbox/aws/10-plt
SCRIPTS_DIR := scripts
BUILD_DIR := dist

# Colors
BLUE := \033[0;34m
GREEN := \033[0;32m
YELLOW := \033[1;33m
NC := \033[0m

# -----------------------------------------------------------------------------
# Help
# -----------------------------------------------------------------------------

help:
	@echo "$(BLUE)Slack Bot - Available Commands$(NC)"
	@echo ""
	@echo "$(GREEN)Build:$(NC)"
	@echo "  make build                  - Build all Lambda functions"
	@echo "  make build-echo             - Build echo worker only"
	@echo ""
	@echo "$(GREEN)Upload to S3:$(NC)"
	@echo "  make upload-echo            - Upload echo worker (auto-build)"
	@echo "  make upload-deploy          - Upload deploy worker"
	@echo "  make upload-status          - Upload status worker"
	@echo "  make upload-all             - Upload all workers"
	@echo ""
	@echo "$(GREEN)Deploy Lambda:$(NC)"
	@echo "  make deploy-echo            - Deploy echo worker from S3"
	@echo "  make deploy-deploy          - Deploy deploy worker from S3"
	@echo "  make deploy-status          - Deploy status worker from S3"
	@echo ""
	@echo "$(GREEN)Test:$(NC)"
	@echo "  make test                   - Run unit tests"
	@echo "  make test-integration       - Run integration tests"
	@echo "  make test-echo-worker       - Test echo worker specifically"
	@echo ""
	@echo "$(GREEN)Utilities:$(NC)"
	@echo "  make clean                  - Clean build artifacts"
	@echo "  make verify-aws             - Verify AWS credentials"
	@echo "  make info                   - Show current configuration"
	@echo ""
	@echo "$(YELLOW)Environment Variables:$(NC)"
	@echo "  AWS_PROFILE=$(AWS_PROFILE)"
	@echo "  ENVIRONMENT=$(ENVIRONMENT)"
	@echo "  REGION=$(REGION)"
	@echo "  VERSION=$(VERSION)"

# -----------------------------------------------------------------------------
# Info
# -----------------------------------------------------------------------------

info:
	@echo "$(BLUE)Current Configuration:$(NC)"
	@echo "  AWS Profile:  $(AWS_PROFILE)"
	@echo "  Environment:  $(ENVIRONMENT)"
	@echo "  Region:       $(REGION)"
	@echo "  Version:      $(VERSION)"
	@echo "  Git Branch:   $(shell git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
	@echo "  Git Commit:   $(shell git rev-parse HEAD 2>/dev/null || echo 'unknown')"

verify-aws:
	@echo "$(BLUE)Verifying AWS credentials...$(NC)"
	@$(AWS_CMD) sts get-caller-identity || \
		(echo "$(YELLOW)Error: AWS credentials not configured$(NC)" && exit 1)
	@echo "$(GREEN)✓ AWS credentials valid$(NC)"

# -----------------------------------------------------------------------------
# Build
# -----------------------------------------------------------------------------

build:
	@echo "$(BLUE)Building all Lambda functions...$(NC)"
	npm run build
	npm run package
	@echo "$(GREEN)✓ Build complete$(NC)"

build-echo:
	@echo "$(BLUE)Building echo worker...$(NC)"
	npm run build
	npm run package
	@echo "$(GREEN)✓ Echo worker built$(NC)"

build-deploy:
	@echo "$(BLUE)Building deploy worker...$(NC)"
	npm run build
	npm run package
	@echo "$(GREEN)✓ Deploy worker built$(NC)"

build-status:
	@echo "$(BLUE)Building status worker...$(NC)"
	npm run build
	npm run package
	@echo "$(GREEN)✓ Status worker built$(NC)"

# -----------------------------------------------------------------------------
# Upload to S3
# -----------------------------------------------------------------------------

upload-echo: build-echo verify-aws
	@echo "$(BLUE)Uploading echo worker to S3...$(NC)"
	@UPLOAD_OUTPUT=$$($(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE)) AWS_REGION=$(REGION) \
		$(SCRIPTS_DIR)/upload-lambda.sh echo $(ENVIRONMENT) $(VERSION)); \
	echo "$$UPLOAD_OUTPUT"; \
	echo "$$UPLOAD_OUTPUT" | grep -o '##VERSION_ID=.*##' | sed 's/##VERSION_ID=//;s/##//' > .s3-version-id-echo.tmp

upload-deploy: build-deploy verify-aws
	@echo "$(BLUE)Uploading deploy worker to S3...$(NC)"
	$(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE)) AWS_REGION=$(REGION) \
		$(SCRIPTS_DIR)/upload-lambda.sh deploy $(ENVIRONMENT) $(VERSION)

upload-status: build-status verify-aws
	@echo "$(BLUE)Uploading status worker to S3...$(NC)"
	$(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE)) AWS_REGION=$(REGION) \
		$(SCRIPTS_DIR)/upload-lambda.sh status $(ENVIRONMENT) $(VERSION)

upload-all: upload-echo upload-deploy upload-status
	@echo "$(GREEN)✓ All workers uploaded$(NC)"

# -----------------------------------------------------------------------------
# Deploy Lambda
# -----------------------------------------------------------------------------

deploy-echo: upload-echo
	@echo "$(BLUE)Deploying echo worker from S3...$(NC)"
	@if [ -f .s3-version-id-echo.tmp ]; then \
		S3_VERSION_ID=$$(cat .s3-version-id-echo.tmp); \
		echo "Using S3 Version ID: $$S3_VERSION_ID"; \
		cd $(SANDBOX_ROOT)/chatbot-echo-worker && \
		USE_S3_ARTIFACTS=true LAMBDA_VERSION=$(VERSION) S3_OBJECT_VERSION=$$S3_VERSION_ID terragrunt apply; \
	else \
		echo "$(YELLOW)Warning: Version ID not found, deploying without it$(NC)"; \
		cd $(SANDBOX_ROOT)/chatbot-echo-worker && \
		USE_S3_ARTIFACTS=true LAMBDA_VERSION=$(VERSION) terragrunt apply; \
	fi
	@echo "$(GREEN)✓ Echo worker deployed$(NC)"

deploy-deploy: upload-deploy
	@echo "$(BLUE)Deploying deploy worker from S3...$(NC)"
	cd $(SANDBOX_ROOT)/chatbot-deploy-worker && \
		USE_S3_ARTIFACTS=true LAMBDA_VERSION=$(VERSION) terragrunt apply
	@echo "$(GREEN)✓ Deploy worker deployed$(NC)"

deploy-status: upload-status
	@echo "$(BLUE)Deploying status worker from S3...$(NC)"
	cd $(SANDBOX_ROOT)/chatbot-status-worker && \
		USE_S3_ARTIFACTS=true LAMBDA_VERSION=$(VERSION) terragrunt apply
	@echo "$(GREEN)✓ Status worker deployed$(NC)"

# -----------------------------------------------------------------------------
# Quick Deploy (upload + deploy in one command)
# -----------------------------------------------------------------------------

quick-deploy-echo: upload-echo
	@echo "$(BLUE)Quick deploying echo worker...$(NC)"
	cd $(SANDBOX_ROOT)/chatbot-echo-worker && \
		USE_S3_ARTIFACTS=true LAMBDA_VERSION=$(VERSION) terragrunt apply -auto-approve

# -----------------------------------------------------------------------------
# Test
# -----------------------------------------------------------------------------

test:
	@echo "$(BLUE)Running unit tests...$(NC)"
	npm test

test-integration:
	@echo "$(BLUE)Running integration tests...$(NC)"
	cd $(SANDBOX_ROOT)/tests/integration && \
		./test-localstack.sh

test-echo-worker:
	@echo "$(BLUE)Testing echo worker integration...$(NC)"
	cd $(SANDBOX_ROOT)/tests/integration && \
		./test-echo-worker.sh || echo "$(YELLOW)Note: Create test-echo-worker.sh first$(NC)"

# -----------------------------------------------------------------------------
# Clean
# -----------------------------------------------------------------------------

clean:
	@echo "$(BLUE)Cleaning build artifacts...$(NC)"
	rm -rf $(BUILD_DIR)/*.zip
	rm -rf node_modules/.cache
	rm -f .s3-version-id-*.tmp
	@echo "$(GREEN)✓ Clean complete$(NC)"

clean-all: clean
	@echo "$(BLUE)Cleaning all dependencies...$(NC)"
	rm -rf node_modules
	@echo "$(GREEN)✓ Deep clean complete$(NC)"

# -----------------------------------------------------------------------------
# Development Shortcuts
# -----------------------------------------------------------------------------

dev-echo: upload-echo
	@echo "$(GREEN)✓ Echo worker ready for testing$(NC)"
	@echo ""
	@echo "Next steps:"
	@echo "  1. Deploy: make deploy-echo"
	@echo "  2. Test:   make test-echo-worker"

# -----------------------------------------------------------------------------
# Production Deploy
# -----------------------------------------------------------------------------

prod-upload-echo: verify-aws
	@echo "$(YELLOW)Uploading to PRODUCTION...$(NC)"
	@read -p "Are you sure? [y/N] " -n 1 -r; \
	echo; \
	if [[ $$REPLY =~ ^[Yy]$$ ]]; then \
		$(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE)) AWS_REGION=$(REGION) \
		$(SCRIPTS_DIR)/upload-lambda.sh echo prod $(VERSION); \
	fi
