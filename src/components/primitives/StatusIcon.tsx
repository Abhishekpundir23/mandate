interface StatusIconProps {
  readonly kind: 'success' | 'blocked' | 'warning' | 'info';
  readonly size?: number;
}

export function StatusIcon({ kind, size = 28 }: StatusIconProps) {
  if (kind === 'info') {
    return (
      <svg className="status-icon" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        <circle cx="16" cy="16" r="12" />
        <path d="M16 14v8M16 10h.01" />
      </svg>
    );
  }
  if (kind === 'blocked') {
    return (
      <svg className="status-icon" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        <circle cx="16" cy="16" r="12" />
        <path d="M7.5 7.5l17 17" />
      </svg>
    );
  }
  if (kind === 'warning') {
    return (
      <svg className="status-icon" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
        <circle cx="16" cy="16" r="12" />
        <path d="M16 9v9M16 23h.01" />
      </svg>
    );
  }
  return (
    <svg className="status-icon" viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <circle cx="16" cy="16" r="12" />
      <path d="M10 16.5l4 4 8-9" />
    </svg>
  );
}
