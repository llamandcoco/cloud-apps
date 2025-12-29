# =============================================================================
# Slack Bot - Makefile
# =============================================================================

.PHONY: help build upload deploy test clean clean-dist clean-all

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
	@echo "  make build-router           - Build router only"
	@echo "  make build-echo             - Build echo worker only"
	@echo ""
	@echo "$(GREEN)Upload to S3:$(NC)"
	@echo "  make upload-router          - Upload router (auto-build)"
	@echo "  make upload-echo            - Upload echo worker (auto-build)"
	@echo "  make upload-deploy          - Upload deploy worker"
	@echo "  make upload-status          - Upload status worker"
	@echo "  make upload-all             - Upload all workers"
	@echo ""
	@echo "$(GREEN)Deploy Lambda:$(NC)"
	@echo "  make deploy-router          - Upload to S3 → Deploy (default)"
	@echo "  make deploy-echo            - Upload to S3 → Deploy (default)"
	@echo "  make deploy-deploy          - Upload to S3 → Deploy (default)"
	@echo "  make deploy-status          - Upload to S3 → Deploy (default)"
	@echo ""
	@echo "$(GREEN)Deploy Lambda (Advanced):$(NC)"
	@echo "  make deploy-echo-local      - Deploy from local dist/ (no upload)"
	@echo "  make deploy-echo-s3         - Deploy from S3 (upload if not exists)"
	@echo ""
	@echo "$(GREEN)Test:$(NC)"
	@echo "  make test                   - Run unit tests"
	@echo "  make test-integration       - Run integration tests"
	@echo "  make test-router-lambda     - Test router lambda integration"
	@echo "  make test-echo-worker       - Test echo worker integration"
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

build: clean-dist
	@echo "$(BLUE)Building all Lambda functions...$(NC)"
	npm run build
	npm run package
	@echo "$(GREEN)✓ Build complete$(NC)"

build-router: clean-dist
	@echo "$(BLUE)Building router...$(NC)"
	npm run build
	$(SCRIPTS_DIR)/package.sh router
	@echo "$(GREEN)✓ Router built$(NC)"

build-echo: clean-dist
	@echo "$(BLUE)Building echo worker...$(NC)"
	npm run build
	$(SCRIPTS_DIR)/package.sh echo
	@test -f dist/echo-worker.zip || (echo "$(YELLOW)Error: echo-worker.zip not created$(NC)" && exit 1)
	@echo "$(GREEN)✓ Echo worker built: dist/echo-worker.zip$(NC)"

build-deploy: clean-dist
	@echo "$(BLUE)Building deploy worker...$(NC)"
	npm run build
	$(SCRIPTS_DIR)/package.sh deploy
	@echo "$(GREEN)✓ Deploy worker built$(NC)"

build-status: clean-dist
	@echo "$(BLUE)Building status worker...$(NC)"
	npm run build
	$(SCRIPTS_DIR)/package.sh status
	@echo "$(GREEN)✓ Status worker built$(NC)"

# -----------------------------------------------------------------------------
# Upload to S3
# -----------------------------------------------------------------------------

upload-router: build-router verify-aws
	@echo "$(BLUE)Uploading router to S3...$(NC)"
	@UPLOAD_OUTPUT=$$($(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE)) AWS_REGION=$(REGION) \
		$(SCRIPTS_DIR)/upload-lambda.sh router $(ENVIRONMENT) $(VERSION)); \
	echo "$$UPLOAD_OUTPUT"; \
	echo "$$UPLOAD_OUTPUT" | grep -o '##VERSION_ID=.*##' | sed 's/##VERSION_ID=//;s/##//' > .s3-version-id-router.tmp

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

upload-all: upload-router upload-echo upload-deploy upload-status
	@echo "$(GREEN)✓ All components uploaded$(NC)"

# -----------------------------------------------------------------------------
# Deploy Lambda
# Default: Upload to S3 → Deploy (recommended for production)
# -----------------------------------------------------------------------------

deploy-router: upload-router
	@echo "$(BLUE)Deploying router from S3 (version: $(VERSION))...$(NC)"
	@if [ -f .s3-version-id-router.tmp ]; then \
		S3_VERSION_ID=$$(cat .s3-version-id-router.tmp); \
		cd $(SANDBOX_ROOT)/slack-router-lambda && \
		USE_S3_ARTIFACTS=true LAMBDA_VERSION=$(VERSION) S3_OBJECT_VERSION=$$S3_VERSION_ID terragrunt apply; \
	else \
		cd $(SANDBOX_ROOT)/slack-router-lambda && \
		USE_S3_ARTIFACTS=true LAMBDA_VERSION=$(VERSION) terragrunt apply; \
	fi
	@echo "$(GREEN)✓ Router deployed from S3$(NC)"

deploy-echo: upload-echo
	@echo "$(BLUE)Deploying echo worker from S3 (version: $(VERSION))...$(NC)"
	@if [ -f .s3-version-id-echo.tmp ]; then \
		S3_VERSION_ID=$$(cat .s3-version-id-echo.tmp); \
		cd $(SANDBOX_ROOT)/chatbot-echo-worker && \
		USE_S3_ARTIFACTS=true LAMBDA_VERSION=$(VERSION) S3_OBJECT_VERSION=$$S3_VERSION_ID terragrunt apply; \
	else \
		cd $(SANDBOX_ROOT)/chatbot-echo-worker && \
		USE_S3_ARTIFACTS=true LAMBDA_VERSION=$(VERSION) terragrunt apply; \
	fi
	@echo "$(GREEN)✓ Echo worker deployed from S3$(NC)"

deploy-deploy: upload-deploy
	@echo "$(BLUE)Deploying deploy worker from S3 (version: $(VERSION))...$(NC)"
	cd $(SANDBOX_ROOT)/chatbot-deploy-worker && \
		USE_S3_ARTIFACTS=true LAMBDA_VERSION=$(VERSION) terragrunt apply
	@echo "$(GREEN)✓ Deploy worker deployed from S3$(NC)"

deploy-status: upload-status
	@echo "$(BLUE)Deploying status worker from S3 (version: $(VERSION))...$(NC)"
	cd $(SANDBOX_ROOT)/chatbot-status-worker && \
		USE_S3_ARTIFACTS=true LAMBDA_VERSION=$(VERSION) terragrunt apply
	@echo "$(GREEN)✓ Status worker deployed from S3$(NC)"

# -----------------------------------------------------------------------------
# Deploy Lambda (Advanced)
# -----------------------------------------------------------------------------

# Deploy from local dist/ without uploading (fast for testing)
deploy-echo-local: build-echo
	@echo "$(BLUE)Deploying echo worker from local build...$(NC)"
	cd $(SANDBOX_ROOT)/chatbot-echo-worker && terragrunt apply
	@echo "$(GREEN)✓ Echo worker deployed from local$(NC)"

# Deploy from S3, upload only if version doesn't exist
deploy-echo-s3:
	@echo "$(BLUE)Deploying echo worker from S3 (version: $(VERSION))...$(NC)"
	@S3_BUCKET="laco-plt-lambda-artifacts"; \
	S3_KEY="plt/echo/builds/$(VERSION).zip"; \
	if $(AWS_CMD) s3api head-object --bucket $$S3_BUCKET --key $$S3_KEY --region $(REGION) >/dev/null 2>&1; then \
		echo "$(GREEN)✓ Version $(VERSION) exists in S3, deploying...$(NC)"; \
	else \
		echo "$(YELLOW)Version $(VERSION) not found in S3, uploading first...$(NC)"; \
		$(MAKE) upload-echo; \
	fi
	@cd $(SANDBOX_ROOT)/chatbot-echo-worker && \
		USE_S3_ARTIFACTS=true LAMBDA_VERSION=$(VERSION) terragrunt apply
	@echo "$(GREEN)✓ Echo worker deployed from S3$(NC)"

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

test-router-lambda:
	@echo "$(BLUE)Testing router lambda integration...$(NC)"
	cd $(SANDBOX_ROOT)/tests/integration && \
		./test-router-lambda.sh

test-echo-worker:
	@echo "$(BLUE)Testing echo worker integration...$(NC)"
	cd $(SANDBOX_ROOT)/tests/integration && \
		./test-echo-worker.sh || echo "$(YELLOW)Note: Create test-echo-worker.sh first$(NC)"

# -----------------------------------------------------------------------------
# Clean
# -----------------------------------------------------------------------------

clean-dist:
	@echo "$(BLUE)Cleaning dist artifacts...$(NC)"
	@rm -rf dist/*.zip
	@rm -rf build
	@echo "$(GREEN)✓ Dist cleaned$(NC)"

clean:
	@echo "$(BLUE)Cleaning build artifacts...$(NC)"
	rm -rf $(BUILD_DIR)/*.zip
	rm -rf build
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
