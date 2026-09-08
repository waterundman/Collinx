// Configures the React testing environment so act(...) warnings/errors are
// surfaced correctly. See react.dev/reference/react/act troubleshooting:
// "The current testing environment is not configured to support act(...)"
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
