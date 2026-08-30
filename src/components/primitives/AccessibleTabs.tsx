import { useId, useState, type KeyboardEvent, type ReactNode } from 'react';

import { useAccessibleFocusRegistry } from '../../platform/browser-capabilities';

export interface AccessibleTab {
  readonly id: string;
  readonly label: string;
  readonly content: ReactNode;
}

interface AccessibleTabsProps {
  readonly label: string;
  readonly tabs: readonly AccessibleTab[];
  readonly defaultTabId: string;
  readonly className?: string;
}

export function AccessibleTabs({
  label,
  tabs,
  defaultTabId,
  className = '',
}: AccessibleTabsProps) {
  const prefix = useId();
  const [selectedId, setSelectedId] = useState(defaultTabId);
  const tabFocus = useAccessibleFocusRegistry();
  const selected = tabs.find(({ id }) => id === selectedId) ?? tabs[0];

  const selectAt = (index: number): void => {
    const next = tabs[index];
    if (next === undefined) return;
    setSelectedId(next.id);
    tabFocus.focus(next.id);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let target: number | undefined;
    if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') target = 0;
    if (event.key === 'End') target = tabs.length - 1;
    if (target === undefined) return;
    event.preventDefault();
    selectAt(target);
  };

  if (selected === undefined) return null;

  return (
    <div className={`accessible-tabs ${className}`.trim()}>
      <div className="tab-list" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const isSelected = tab.id === selected.id;
          return (
            <button
              key={tab.id}
              ref={tabFocus.refFor(tab.id)}
              id={`${prefix}-${tab.id}-tab`}
              type="button"
              role="tab"
              aria-selected={isSelected}
              aria-controls={`${prefix}-${tab.id}-panel`}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => setSelectedId(tab.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => {
        const isSelected = tab.id === selected.id;
        return (
          <div
            key={tab.id}
            id={`${prefix}-${tab.id}-panel`}
            role="tabpanel"
            aria-labelledby={`${prefix}-${tab.id}-tab`}
            tabIndex={isSelected ? 0 : -1}
            hidden={!isSelected}
          >
            {tab.content}
          </div>
        );
      })}
    </div>
  );
}
