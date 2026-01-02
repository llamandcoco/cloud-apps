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
	@echo "  make perf-test              - Full test (~12 min, all commands)"
	@echo "  make perf-test-echo         - Echo-only test (~7 min)"
	@echo "  make perf-test-quick        - Quick test (2 min)"
	@echo "  make perf-test-results      - View latest test results (terminal)"
	@echo "  make perf-test-analyze      - Analyze CloudWatch metrics (last 15 min)"
	@echo "  make perf-test-analyze-test - Analyze from latest Artillery test"
	@echo "  make perf-test-analyze-test-quiet - Analyze from latest test (auto mode)"
	@echo "  make perf-test-json         - Export metrics to JSON (dashboard)"
	@echo "  make perf-test-summary      - Quick summary of latest test"
	@echo "  make perf-test-clean        - Clean test results"
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

perf-test: perf-test-install
	@echo "$(BLUE)Running Artillery performance test...$(NC)"
	@echo "$(YELLOW)Environment: $(ENVIRONMENT)$(NC)"
	@echo "$(YELLOW)Region: $(REGION)$(NC)"
	@echo ""
	@if [ -z "$(API_GATEWAY_URL)" ]; then \
		echo "$(YELLOW)⚠ API_GATEWAY_URL not set. Getting from Terragrunt...$(NC)"; \
		export API_GATEWAY_URL=$$(cd $(SANDBOX_ROOT)/slack-api-gateway && terragrunt output -raw api_gateway_url 2>/dev/null || echo ""); \
		if [ -z "$$API_GATEWAY_URL" ]; then \
			echo "$(YELLOW)✗ Could not get API Gateway URL from Terragrunt$(NC)"; \
			echo "$(YELLOW)  Please set manually: make perf-test API_GATEWAY_URL=https://xxx.execute-api.ca-central-1.amazonaws.com$(NC)"; \
			exit 1; \
		fi; \
		echo "$(GREEN)✓ API Gateway URL: $$API_GATEWAY_URL$(NC)"; \
		export ENVIRONMENT=$(ENVIRONMENT) AWS_REGION=$(REGION); \
		cd performance-tests && artillery run artillery-config.yml --output results/test-$$(date +%Y%m%d-%H%M%S).json; \
	else \
		export ENVIRONMENT=$(ENVIRONMENT) AWS_REGION=$(REGION); \
		cd performance-tests && artillery run artillery-config.yml --output results/test-$$(date +%Y%m%d-%H%M%S).json; \
	fi

perf-test-echo: perf-test-install
	@echo "$(BLUE)Running Echo-only performance test (7 minutes, max 40 req/s)...$(NC)"
	@echo "$(YELLOW)Environment: $(ENVIRONMENT)$(NC)"
	@echo "$(YELLOW)Region: $(REGION)$(NC)"
	@echo "$(YELLOW)⚠ Max load: 40 req/s (API Gateway limit: 50 req/s)$(NC)"
	@echo ""
	@if [ -z "$(API_GATEWAY_URL)" ]; then \
		echo "$(YELLOW)⚠ API_GATEWAY_URL not set. Getting from Terragrunt...$(NC)"; \
		export API_GATEWAY_URL=$$(cd $(SANDBOX_ROOT)/slack-api-gateway && terragrunt output -raw api_gateway_url 2>/dev/null || echo ""); \
		if [ -z "$$API_GATEWAY_URL" ]; then \
			echo "$(YELLOW)✗ Could not get API Gateway URL from Terragrunt$(NC)"; \
			echo "$(YELLOW)  Please set manually: make perf-test-echo API_GATEWAY_URL=https://xxx.execute-api.ca-central-1.amazonaws.com$(NC)"; \
			exit 1; \
		fi; \
		echo "$(GREEN)✓ API Gateway URL: $$API_GATEWAY_URL$(NC)"; \
		export ENVIRONMENT=$(ENVIRONMENT) AWS_REGION=$(REGION); \
		cd performance-tests && artillery run artillery-echo-light.yml --output results/echo-test-$$(date +%Y%m%d-%H%M%S).json; \
	else \
		export ENVIRONMENT=$(ENVIRONMENT) AWS_REGION=$(REGION); \
		cd performance-tests && artillery run artillery-echo-light.yml --output results/echo-test-$$(date +%Y%m%d-%H%M%S).json; \
	fi

perf-test-quick: perf-test-install
	@echo "$(BLUE)Running quick Artillery test (2 minutes)...$(NC)"
	@export ENVIRONMENT=$(ENVIRONMENT) AWS_REGION=$(REGION); \
	if [ -z "$(API_GATEWAY_URL)" ]; then \
		export API_GATEWAY_URL=$$(cd $(SANDBOX_ROOT)/slack-api-gateway && terragrunt output -raw api_gateway_url 2>/dev/null || echo "https://placeholder.execute-api.ca-central-1.amazonaws.com"); \
	fi; \
	cd performance-tests && artillery quick --count 100 --num 10 $$API_GATEWAY_URL/slack

perf-test-results:
	@echo "$(BLUE)Viewing latest test results...$(NC)"
	@cd performance-tests && ./view-results.sh

perf-test-report:
	@echo "$(BLUE)Generating HTML report from latest test...$(NC)"
	@REPORT_JSON=$${REPORT_JSON:-$$(ls -t performance-tests/results/*-test-*.json 2>/dev/null | grep -v '\.metrics\.json' | head -n1)}; \
	if [ -z "$$REPORT_JSON" ]; then \
		echo "$(YELLOW)✗ No test results found$(NC)"; \
		exit 1; \
	fi; \
	REPORT_HTML=$${REPORT_HTML:-$${REPORT_JSON%.json}.html}; \
	node performance-tests/render-report.js $$REPORT_JSON $$REPORT_HTML; \
	echo "$(GREEN)✓ Report written: $$REPORT_HTML$(NC)"

perf-test-summary:
	@echo "$(BLUE)Quick summary of latest test...$(NC)"
	@LATEST=$$(ls -t performance-tests/results/*-test-*.json 2>/dev/null | head -n1); \
	if [ -z "$$LATEST" ]; then \
		echo "$(YELLOW)✗ No test results found$(NC)"; \
		exit 1; \
	fi; \
	echo "$(GREEN)File: $$LATEST$(NC)"; \
	echo ""; \
	jq -r '"Requests: " + (.aggregate.counters["http.requests"] | tostring), \
	        "P50: " + (.aggregate.summaries["http.response_time"].median | tostring) + "ms", \
	        "P95: " + (.aggregate.summaries["http.response_time"].p95 | tostring) + "ms", \
	        "P99: " + (.aggregate.summaries["http.response_time"].p99 | tostring) + "ms", \
	        "Errors: " + ((.aggregate.counters["errors.total"] // 0) | tostring)' \
	        $$LATEST 2>/dev/null || cat $$LATEST | grep -A 20 "aggregate"

perf-test-install:
	@echo "$(BLUE)Checking Artillery installation...$(NC)"
	@if ! command -v artillery > /dev/null; then \
		echo "$(YELLOW)Installing Artillery globally...$(NC)"; \
		npm install -g artillery artillery-plugin-metrics-by-endpoint; \
	fi
	@echo "$(BLUE)Installing test dependencies...$(NC)"
	@cd performance-tests && npm install --no-save @aws-sdk/client-ssm 2>/dev/null || true
	@echo "$(GREEN)✓ Artillery ready$(NC)"

perf-test-clean:
	@echo "$(BLUE)Cleaning performance test results...$(NC)"
	rm -rf performance-tests/results/*.json
	rm -rf performance-tests/results/*.html
	@echo "$(GREEN)✓ Performance test results cleaned$(NC)"

perf-test-analyze:
	@echo "$(BLUE)Analyzing performance test results from CloudWatch...$(NC)"
	@cd performance-tests && ./analyze-performance.sh 15
perf-test-analyze-test:
	@echo "$(BLUE)Analyzing from latest Artillery test result...$(NC)"
	@cd performance-tests && ./analyze-performance.sh --from-test

perf-test-analyze-test-quiet:
	@echo "$(BLUE)Analyzing from latest Artillery test result (quiet mode)...$(NC)"
	@cd performance-tests && ./analyze-performance.sh --from-test --quiet 2>/dev/null

perf-test-json:
	@echo "$(BLUE)Exporting E2E metrics to JSON...$(NC)"
	@cd performance-tests && ./analyze-e2e-json.sh >/dev/null
	@echo "$(GREEN)✓ Metrics file created in performance-tests/results/$(NC)"