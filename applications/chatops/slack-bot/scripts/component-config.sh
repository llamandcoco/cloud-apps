#!/bin/bash
# Component configuration - Single source of truth for all component mappings

# Valid components list
export VALID_COMPONENTS="router sr lw lr sw"

# Get zip filename for component
get_zip_name() {
  case "$1" in
    router) echo "router" ;;
    sr) echo "sr-worker" ;;
    lw) echo "lw-worker" ;;
    lr) echo "lr-worker" ;;
    sw) echo "sw-worker" ;;
    *) return 1 ;;
  esac
}

# Get Terragrunt directory path for component
get_tg_path() {
  case "$1" in
    router) echo "slack-router-lambda" ;;
    sr) echo "chatbot-command-sr-worker" ;;
    lw) echo "chatbot-command-lw-worker" ;;
    lr) echo "chatbot-command-lr-worker" ;;
    sw) echo "chatbot-command-sw-worker" ;;
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
