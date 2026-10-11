import { useState } from 'react';
import { applyPolicy, checkWorkbenchAction, createWorkbenchState, editActionField, editPolicy,
  loadTemplateDraft, resetPolicyDraft, resetWorkbenchSession } from '../../app/workbench-model';
import { AppHeader, type AppView } from '../AppHeader';
import { AccessibleTabs } from '../primitives/AccessibleTabs';
import { ActionComposer } from './ActionComposer';
import { AuthorityTimeline } from './AuthorityTimeline';
import { DecisionExplanation } from './DecisionExplanation';
import { PolicyAnalysis } from './PolicyAnalysis';
import { PolicyEditor } from './PolicyEditor';
import { VersionCompare } from './VersionCompare';
import { SessionWorkbench } from './SessionWorkbench';
import { CampaignWorkbench } from './CampaignWorkbench';
import { TraceWorkbench } from './TraceWorkbench';
import { ImpactWorkbench } from './ImpactWorkbench';
import { RevisionWorkbench } from './RevisionWorkbench';
import { LabWorkbench } from './LabWorkbench';

export function WorkbenchView({ onNavigate }: { readonly onNavigate: (view: AppView) => void }) {
  const [state, setState] = useState(() => createWorkbenchState());
  const dirty = state.draftText !== state.appliedText;
  return <div className="app-shell wb-shell">
    <AppHeader activeView="workbench" onViewChange={onNavigate} scenarios={[]} selectedScenarioId=""
      onScenarioChange={() => undefined} onRun={() => setState(applyPolicy)} running={false} />
    <main id="workbench-workspace" className="wb-workspace" aria-label="Authority workbench">
      <div className="wb-heading">
        <div><p className="wb-eyebrow">Local developer tools</p><h2>Authority workbench</h2>
          <p>Advisory checks only. No declared action is executed.</p></div>
        <div className="wb-policy-summary"><strong>{state.snapshot.policyId} · version {state.snapshot.current.version}</strong>
          <span>{state.session.recordCount} recorded {state.session.recordCount === 1 ? 'check' : 'checks'}</span>
          <details><summary>Applied policy digest</summary><code>{state.snapshot.policyDigest}</code></details>
        </div>
      </div>
      <AccessibleTabs label="Workbench tools" defaultTabId="policy" className="wb-tabs" tabs={[
        { id: 'policy', label: 'Policy', content: <div className="wb-policy-grid">
          <PolicyEditor value={state.draftText} appliedPolicyId={state.snapshot.policyId} dirty={dirty}
            diagnostics={state.diagnostics} notice={state.notice}
            onEdit={(text) => setState((current) => editPolicy(current, text))}
            onApply={() => setState(applyPolicy)} onReset={() => setState(resetPolicyDraft)}
            onTemplate={(id) => setState((current) => loadTemplateDraft(current, id))} />
          <div className="wb-action-column">
            <ActionComposer draft={state.action} snapshot={state.snapshot} disabled={dirty} error={state.actionError}
              onField={(field, value) => setState((current) => editActionField(current, field, value))}
              onCheck={() => setState(checkWorkbenchAction)} />
            <DecisionExplanation snapshot={state.snapshot} result={state.result} />
          </div>
        </div> },
        { id: 'revisions', label: 'Revisions', content: <RevisionWorkbench key={state.snapshot.policyDigest} snapshot={state.snapshot} dirty={dirty}
          onApply={(text) => setState((current) => applyPolicy(editPolicy(current, text)))} /> },
        { id: 'history', label: 'History', content: <AuthorityTimeline key={state.snapshot.policyDigest} snapshot={state.snapshot} /> },
        { id: 'compare', label: 'Compare', content: <VersionCompare key={state.snapshot.policyDigest} snapshot={state.snapshot} /> },
        { id: 'impact', label: 'Impact', content: <ImpactWorkbench key={state.snapshot.policyDigest} snapshot={state.snapshot} /> },
        { id: 'sessions', label: 'Sessions', content: <SessionWorkbench session={state.session} onReset={() => setState(resetWorkbenchSession)} /> },
        { id: 'lab', label: 'Lab', content: <LabWorkbench /> },
        { id: 'traces', label: 'Traces', content: <TraceWorkbench /> },
        { id: 'campaigns', label: 'Campaigns', content: <CampaignWorkbench /> },
        { id: 'analysis', label: 'Analysis', content: <PolicyAnalysis snapshot={state.snapshot} /> },
      ]} />
    </main>
    <footer className="app-footer wb-footer"><span>In memory · no declared action executed</span>
      <span>Policy and session hashes identify content; they do not authenticate human approval.</span></footer>
  </div>;
}
