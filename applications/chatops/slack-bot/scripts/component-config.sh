#!/bin/bash
# Component configuration - Single source of truth for all component mappings

# Valid components list
export VALID_COMPONENTS="router echo deploy status build"

# Get zip filename for component
get_zip_name() {
  case "$1" in
    router) echo "router" ;;
    echo) echo "echo-worker" ;;
    deploy) echo "deploy-worker" ;;
    status) echo "status-worker" ;;
    build) echo "build-worker" ;;
    *) return 1 ;;
  esac
}

# Get Terragrunt directory path for component
get_tg_path() {
  case "$1" in
    router) echo "slack-router-lambda" ;;
    echo) echo "chatbot-echo-worker" ;;
    deploy) echo "chatbot-deploy-worker" ;;
    status) echo "chatbot-status-worker" ;;
    build) echo "chatbot-build-worker" ;;
    *) return 1 ;;
  esac
}

# Validate component name
validate_component() {
  local component="$1"
  echo "$VALID_COMPONENTS" | grep -wq "$component"
}

# Show error for invalid component
show_component_error() {
  local component="$1"
  echo -e "${YELLOW}Error: Unknown component: $component${NC}" >&2
  echo "Valid components: $VALID_COMPONENTS" >&2
  return 1
}
