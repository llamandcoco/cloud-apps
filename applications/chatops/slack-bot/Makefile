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
	@echo "  make build-<component>      - Build specific component"
	@echo "    Components: router, echo, deploy, status, build"
	@echo ""
	@echo "$(GREEN)Upload to S3:$(NC)"
	@echo "  make upload-<component>     - Upload component (auto-build)"
	@echo "  make upload-all             - Upload all components"
	@echo ""
	@echo "$(GREEN)Deploy Lambda:$(NC)"
	@echo "  make deploy-<component>     - Upload to S3 → Deploy"
	@echo "  make deploy-build           - Deploy build worker from local (default)"
	@echo ""
	@echo "$(GREEN)Performance Testing:$(NC)"
	@echo "  make perf-test              - Run test (default: minimal ~1min)"
	@echo "    Options: PROFILE=minimal|light|full"
	@echo "  make perf-analyze           - Analyze latest test results"
	@echo "  make perf-analyze-quiet     - Analyze (quiet mode, for CI/CD)"
	@echo "  make perf-summary           - Quick summary"
	@echo "  make perf-report            - Generate HTML report"
	@echo "  make perf-capture           - Capture HTML as screenshot"
	@echo "  make perf-clean             - Clean test results"
	@echo ""
	@echo "$(GREEN)Deploy Lambda (Advanced):$(NC)"
	@echo "  make deploy-<component>-local - Deploy from local dist/ (fast, no upload)"
	@echo ""
	@echo "$(GREEN)Test:$(NC)"
	@echo "  make test                   - Run unit tests"
	@echo "  make test-integration       - Run integration tests"
	@echo "  make test-<name>            - Run specific integration test"
	@echo ""
	@echo "$(GREEN)Code Quality:$(NC)"
	@echo "  make lint                   - Run ESLint"
	@echo "  make lint-fix               - Run ESLint with auto-fix"
	@echo "  make type-check             - Run TypeScript type check"
	@echo "  make ci                     - Run all CI checks"
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

# Valid components (must match scripts/component-config.sh)
COMPONENTS := router echo deploy status build

build: clean-dist
	@echo "$(BLUE)Building all Lambda functions...$(NC)"
	npm run build
	npm run package
	@echo "$(GREEN)✓ Build complete$(NC)"

# Pattern rule: build-<component>
build-%: clean-dist
	@$(SCRIPTS_DIR)/build-component.sh $*

# -----------------------------------------------------------------------------
# Upload to S3
# -----------------------------------------------------------------------------

# Pattern rule: upload-<component>
upload-%: build-% verify-aws
	@echo "$(BLUE)Uploading $* to S3...$(NC)"
	@UPLOAD_OUTPUT=$$($(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE)) AWS_REGION=$(REGION) \
		$(SCRIPTS_DIR)/upload-lambda.sh $* $(ENVIRONMENT) $(VERSION)); \
	echo "$$UPLOAD_OUTPUT"; \
	echo "$$UPLOAD_OUTPUT" | grep -o '##VERSION_ID=.*##' | sed 's/##VERSION_ID=//;s/##//' > .s3-version-id-$*.tmp || true

upload-all: upload-router upload-echo upload-deploy upload-status upload-build
	@echo "$(GREEN)✓ All components uploaded$(NC)"

# -----------------------------------------------------------------------------
# Deploy Lambda
# Default: Upload to S3 → Deploy (recommended for production)
# -----------------------------------------------------------------------------

# Pattern rule: deploy-<component> (from S3)
# Note: deploy-build uses local build by default
deploy-build: build-build
	@VERSION=$(VERSION) SANDBOX_ROOT=$(SANDBOX_ROOT) $(SCRIPTS_DIR)/deploy-component.sh build --local

# All other components deploy from S3
deploy-%: upload-%
	@VERSION=$(VERSION) SANDBOX_ROOT=$(SANDBOX_ROOT) $(SCRIPTS_DIR)/deploy-component.sh $*

# -----------------------------------------------------------------------------
# Deploy Lambda (Advanced)
# -----------------------------------------------------------------------------

# Pattern rule: deploy-<component>-local (from local dist/, fast for testing)
# Note: We manually handle the dependency to avoid pattern matching issues
deploy-%-local: FORCE
	@COMPONENT=$(patsubst deploy-%-local,%,$@); \
	$(MAKE) build-$$COMPONENT && \
	VERSION=$(VERSION) SANDBOX_ROOT=$(SANDBOX_ROOT) $(SCRIPTS_DIR)/deploy-component.sh $$COMPONENT --local

# Deploy from S3 with smart version handling
# Usage:
#   make deploy-echo-s3                    # Interactive selection
#   VERSION=abc123 make deploy-echo-s3     # Deploy specific version
deploy-echo-s3: verify-aws
	@$(if $(AWS_PROFILE),AWS_PROFILE=$(AWS_PROFILE)) \
	AWS_REGION=$(REGION) \
	SANDBOX_ROOT=$(SANDBOX_ROOT) \
	$(SCRIPTS_DIR)/deploy-from-s3.sh echo $(ENVIRONMENT)

FORCE:
.PHONY: FORCE

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

# Pattern rule for integration tests
# Expects test script at $(SANDBOX_ROOT)/tests/integration/test-%.sh
test-%: FORCE
	@echo "$(BLUE)Testing $* integration...$(NC)"
	@cd $(SANDBOX_ROOT)/tests/integration && \
		(./test-$*.sh || echo "$(YELLOW)Note: Create test-$*.sh first$(NC)")

# -----------------------------------------------------------------------------
# Code Quality
# -----------------------------------------------------------------------------

lint:
	@echo "$(BLUE)Running ESLint...$(NC)"
	npm run lint

lint-fix:
	@echo "$(BLUE)Running ESLint with auto-fix...$(NC)"
	npm run lint:fix

type-check:
	@echo "$(BLUE)Running TypeScript type check...$(NC)"
	npm run type-check

ci:
	@echo "$(BLUE)Running CI checks (lint + type-check + test:coverage + build)...$(NC)"
	npm run ci

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
# Performance Testing
# -----------------------------------------------------------------------------

# Test profile configuration
PERF_PROFILE ?= minimal
PERF_CONFIG_minimal = artillery-echo-minimal.yml
PERF_CONFIG_light = artillery-echo-light.yml
PERF_CONFIG_full = artillery-config.yml

perf-test-install:
	@if ! command -v artillery > /dev/null; then \
		echo "$(BLUE)Installing Artillery...$(NC)"; \
		npm install -g artillery artillery-plugin-metrics-by-endpoint; \
	fi
	@cd performance-tests && npm install --no-save @aws-sdk/client-ssm 2>/dev/null || true

perf-test: perf-test-install
	@echo "$(BLUE)Running performance test [$(PERF_PROFILE)]...$(NC)"
	@if [ -z "$(API_GATEWAY_URL)" ]; then \
		API_URL=$$(cd $(SANDBOX_ROOT)/slack-api-gateway && terragrunt output -raw api_gateway_url 2>/dev/null); \
		if [ -z "$$API_URL" ]; then \
			echo "$(YELLOW)✗ Could not get API Gateway URL$(NC)"; \
			echo "$(YELLOW)  Set manually: API_GATEWAY_URL=https://xxx...$(NC)"; \
			exit 1; \
		fi; \
	else \
		API_URL=$(API_GATEWAY_URL); \
	fi; \
	CONFIG=$(PERF_CONFIG_$(PERF_PROFILE)); \
	export API_GATEWAY_URL=$$API_URL ENVIRONMENT=$(ENVIRONMENT) AWS_REGION=$(REGION); \
	cd performance-tests && artillery run $$CONFIG --output results/test-$$(date +%Y%m%d-%H%M%S).json

perf-analyze:
	@echo "$(BLUE)Analyzing latest test results...$(NC)"
	@cd performance-tests && ./analyze-performance.sh --from-test

perf-analyze-quiet:
	@cd performance-tests && ./analyze-e2e-json.sh 2>&1 | grep -E '(✓|Analyzing|Error)' || true

perf-summary:
	@LATEST=$$(ls -t performance-tests/results/*.json 2>/dev/null | grep -v '\.metrics\.json' | head -n1); \
	if [ -z "$$LATEST" ]; then echo "$(YELLOW)No results$(NC)"; exit 1; fi; \
	echo "$(GREEN)$$LATEST$(NC)"; \
	jq -r '"Requests: " + (.aggregate.counters["http.requests"] | tostring), \
	       "P50: " + (.aggregate.summaries["http.response_time"].median | tostring) + "ms", \
	       "P95: " + (.aggregate.summaries["http.response_time"].p95 | tostring) + "ms", \
	       "Errors: " + ((.aggregate.counters["errors.total"] // 0) | tostring)' $$LATEST

perf-report:
	@LATEST=$$(ls -t performance-tests/results/*.json 2>/dev/null | grep -v '\.metrics\.json' | head -n1); \
	if [ -z "$$LATEST" ]; then echo "$(YELLOW)No results$(NC)"; exit 1; fi; \
	REPORT=$${LATEST%.json}.html; \
	node performance-tests/render-report.js $$LATEST $$REPORT; \
	echo "$(GREEN)✓ Report: $$REPORT$(NC)"

perf-capture:
	@LATEST=$$(ls -t performance-tests/results/*.html 2>/dev/null | head -n1); \
	if [ -z "$$LATEST" ]; then echo "$(YELLOW)No HTML report found$(NC)"; exit 1; fi; \
	OUTPUT=$${LATEST%.html}.png; \
	node performance-tests/capture-report.js $$LATEST $$OUTPUT; \
	echo "$(GREEN)✓ Screenshot: $$OUTPUT$(NC)"

perf-clean:
	@rm -rf performance-tests/results/*.json performance-tests/results/*.html performance-tests/results/*.png
	@echo "$(GREEN)✓ Cleaned$(NC)"