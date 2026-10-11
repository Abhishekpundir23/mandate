import { describe, expect, test } from 'vitest';
import { getPolicyTemplate } from '../policy/templates';
import { recordSession } from '../sessions/record';
import { exampleCaseSuite } from '../impact/examples';
import { createTraceBundle } from '../inspection/bundle';
import { scenarioCatalog } from '../scenarios/catalog';
import { maintainedCampaign } from '../campaigns/catalog';
import { createWorkspace, serializeWorkspace, verifyWorkspace } from './bundle';
import {
  addWorkspaceEntry,
  removeWorkspaceEntry,
  renameWorkspaceEntry,
  replaceWorkspaceEntry,
} from './mutate';
import { queryWorkspace, summarizeWorkspace, redactWorkspace } from './inventory';
import type { WorkspaceEntry } from './types';
const policy = getPolicyTemplate('draft-only').policy;
const policyEntry = (): WorkspaceEntry => ({
  id: 'policy',
  label: 'Private policy name',
  kind: 'POLICY',
  references: [],
  payload: policy,
});
const entries = (): WorkspaceEntry[] => [
  policyEntry(),
  {
    id: 'session',
    label: 'Private session',
    kind: 'SESSION',
    references: ['policy'],
    payload: recordSession(
      JSON.stringify(policy),
      [exampleCaseSuite.cases[0]!.action],
      'private-session',
    ),
  },
  {
    id: 'cases',
    label: 'Declared cases',
    kind: 'CASES',
    references: ['policy'],
    payload: exampleCaseSuite,
  },
  {
    id: 'trace',
    label: 'Paired evidence',
    kind: 'TRACE',
    references: [],
    payload: createTraceBundle(scenarioCatalog[0]!),
  },
  {
    id: 'campaign',
    label: 'Regression campaign',
    kind: 'CAMPAIGN',
    references: [],
    payload: maintainedCampaign,
  },
];
const workspace = () => createWorkspace('work', 'Private workspace', entries());
describe('portable validated workspace bundles', () => {
  test('collects all typed artifacts and independently verifies their content', () => {
    const bundle = workspace();
    expect(bundle.entries.map((entry) => entry.id)).toEqual([
      'campaign',
      'cases',
      'policy',
      'session',
      'trace',
    ]);
    expect(bundle.manifest.entries).toHaveLength(5);
    expect(bundle.manifest.rootDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyWorkspace(serializeWorkspace(bundle))).toMatchObject({
      ok: true,
      authenticated: false,
      workspace: bundle,
    });
    expect(Object.isFrozen(bundle.entries[0]!.payload)).toBe(true);
  });
  test('canonical ordering makes manifests reproducible across input permutations', () => {
    const left = createWorkspace('work', 'Same', entries());
    const right = createWorkspace('work', 'Same', entries().reverse());
    expect(right).toEqual(left);
    expect(serializeWorkspace(right)).toBe(serializeWorkspace(left));
  });
  test('empty workspaces verify without inventing artifact success', () => {
    const empty = createWorkspace('empty', '', []);
    expect(verifyWorkspace(serializeWorkspace(empty)).ok).toBe(true);
    expect(summarizeWorkspace(empty)).toMatchObject({ entries: 0, checks: 0, scenarios: 0 });
  });
  test('manifest identity binds labels and all entry payloads', () => {
    const bundle = JSON.parse(serializeWorkspace(workspace()));
    bundle.label = 'Different';
    expect(verifyWorkspace(JSON.stringify(bundle))).toMatchObject({
      ok: false,
      code: 'MANIFEST_MISMATCH',
    });
    const second = JSON.parse(serializeWorkspace(workspace()));
    second.entries[0].label = 'Different';
    expect(verifyWorkspace(JSON.stringify(second))).toMatchObject({
      ok: false,
      code: 'MANIFEST_MISMATCH',
    });
  });
  test('nested forged sessions fail replay before a manifest can legitimize them', () => {
    const value = entries();
    const session = value.find((entry) => entry.kind === 'SESSION')!;
    const forged = JSON.parse(JSON.stringify(session.payload));
    forged.records[0].result.decision.outcome = 'BLOCK';
    expect(() =>
      createWorkspace(
        'work',
        '',
        value.map((entry) => (entry.id === session.id ? { ...entry, payload: forged } : entry)),
      ),
    ).toThrow();
  });
  test('nested forged trace observations fail independent reconstruction', () => {
    const value = entries();
    const trace = value.find((entry) => entry.kind === 'TRACE')!;
    const forged = JSON.parse(JSON.stringify(trace.payload));
    forged.comparison.mandate.receipt.exactMandateSuccess = false;
    expect(() =>
      createWorkspace(
        'work',
        '',
        value.map((entry) => (entry.id === trace.id ? { ...entry, payload: forged } : entry)),
      ),
    ).toThrow();
  });
  test('sessions must reference a bundled policy with the same canonical digest', () => {
    const value = entries();
    expect(() =>
      createWorkspace(
        'work',
        '',
        value.filter((entry) => entry.kind !== 'POLICY'),
      ),
    ).toThrow();
    expect(() =>
      createWorkspace(
        'work',
        '',
        value.map((entry) =>
          entry.kind === 'POLICY'
            ? { ...entry, payload: getPolicyTemplate('read-only').policy }
            : entry,
        ),
      ),
    ).toThrow();
    expect(() =>
      createWorkspace(
        'work',
        '',
        value.map((entry) =>
          entry.kind === 'SESSION' ? { ...entry, references: ['trace'] } : entry,
        ),
      ),
    ).toThrow();
  });
  test('case suites must use repositories and remotes configured by their referenced policy', () => {
    const value = entries();
    const cases = JSON.parse(JSON.stringify(exampleCaseSuite));
    cases.cases[0].action.args.repositoryId = 'unknown';
    expect(() =>
      createWorkspace(
        'work',
        '',
        value.map((entry) => (entry.kind === 'CASES' ? { ...entry, payload: cases } : entry)),
      ),
    ).toThrow();
  });
  test.each([
    (value: WorkspaceEntry[]) => [...value, value[0]!],
    (value: WorkspaceEntry[]) => value.map((entry) => ({ ...entry, extra: true })),
    (value: WorkspaceEntry[]) =>
      value.map((entry) => (entry.kind === 'TRACE' ? { ...entry, references: ['policy'] } : entry)),
    (value: WorkspaceEntry[]) =>
      value.map((entry) =>
        entry.kind === 'SESSION' ? { ...entry, references: ['policy', 'policy'] } : entry,
      ),
  ])('rejects duplicate or ambiguous workspace entries %#', (alter) => {
    expect(() =>
      createWorkspace('work', '', JSON.parse(JSON.stringify(alter(entries())))),
    ).toThrow();
  });
  test('byte/depth exhaustion and malformed JSON return bounded redacted verification errors', () => {
    for (const text of [
      ' '.repeat(8 * 1024 * 1024 + 1),
      '['.repeat(57) + '0' + ']'.repeat(57),
      '{',
    ]) {
      const result = verifyWorkspace(text);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result).length).toBeLessThan(200);
    }
  });
  test('the workspace node budget is enforced before schema validation', () => {
    const text = '[' + '0,'.repeat(1000000) + '0]';
    expect(verifyWorkspace(text)).toMatchObject({ ok: false, code: 'INVALID_INPUT' });
  }, 30000);
  test('creator and serializer reject accessors without invoking them', () => {
    let calls = 0;
    const entry = policyEntry();
    Object.defineProperty(entry, 'payload', {
      enumerable: true,
      get() {
        calls++;
        return policy;
      },
    });
    expect(() => createWorkspace('work', '', [entry])).toThrow();
    expect(calls).toBe(0);
    const bundle = workspace();
    const forged = { ...bundle };
    Object.defineProperty(forged, 'entries', {
      enumerable: true,
      get() {
        calls++;
        return bundle.entries;
      },
    });
    expect(() => serializeWorkspace(forged)).toThrow();
    expect(calls).toBe(0);
  });
});
describe('immutable workspace edits and inventories', () => {
  test('removal options reject accessors and unknown fields without invoking them', () => {
    let calls = 0;
    const options = Object.defineProperty({}, 'cascade', {
      enumerable: true,
      get() {
        calls++;
        return true;
      },
    });
    expect(() => removeWorkspaceEntry(workspace(), 'policy', options)).toThrow();
    expect(calls).toBe(0);
    expect(() =>
      removeWorkspaceEntry(workspace(), 'policy', { cascade: true, extra: true } as {
        cascade: boolean;
      }),
    ).toThrow();
  });
  test('adding and replacing an entry rebuilds the manifest without mutating the baseline', () => {
    const base = createWorkspace('work', '', [policyEntry()]);
    const original = serializeWorkspace(base);
    const next = addWorkspaceEntry(base, {
      id: 'cases',
      label: 'Cases',
      kind: 'CASES',
      references: ['policy'],
      payload: exampleCaseSuite,
    });
    expect(next.entries).toHaveLength(2);
    expect(serializeWorkspace(base)).toBe(original);
    const changed = replaceWorkspaceEntry(next, {
      ...next.entries.find((entry) => entry.id === 'cases')!,
      label: 'Renamed label',
    });
    expect(changed.manifest.rootDigest).not.toBe(next.manifest.rootDigest);
    expect(() => addWorkspaceEntry(next, policyEntry())).toThrow();
    expect(() => replaceWorkspaceEntry(next, { ...policyEntry(), id: 'missing' })).toThrow();
  });
  test('removal refuses referenced policies unless cascade is explicitly selected', () => {
    const base = workspace();
    expect(() => removeWorkspaceEntry(base, 'policy')).toThrow();
    const next = removeWorkspaceEntry(base, 'policy', { cascade: true });
    expect(next.entries.map((entry) => entry.id)).toEqual(['campaign', 'trace']);
    expect(base.entries).toHaveLength(5);
    expect(() => removeWorkspaceEntry(base, 'missing')).toThrow();
  });
  test('renaming updates references atomically without changing nested policy/session identities', () => {
    const base = workspace();
    const next = renameWorkspaceEntry(base, 'policy', 'authority');
    expect(next.entries.find((entry) => entry.kind === 'SESSION')!.references).toEqual([
      'authority',
    ]);
    expect(next.entries.find((entry) => entry.kind === 'POLICY')!.payload).toEqual(policy);
    expect(() => renameWorkspaceEntry(base, 'policy', 'trace')).toThrow();
    expect(() => renameWorkspaceEntry(base, 'missing', 'new')).toThrow();
    expect(() => renameWorkspaceEntry(base, 'policy', 'bad id')).toThrow();
  });
  test('queries combine typed inventory and bounded text without searching sensitive payloads', () => {
    const base = workspace();
    expect(queryWorkspace(base, { kind: 'SESSION' }).items.map((entry) => entry.id)).toEqual([
      'session',
    ]);
    expect(queryWorkspace(base, { text: 'PRIVATE' }).total).toBe(2);
    expect(queryWorkspace(base, { text: 'README.md' }).total).toBe(0);
    expect(queryWorkspace(base, { page: 2, pageSize: 2 }).items.map((entry) => entry.id)).toEqual([
      'policy',
      'session',
    ]);
    expect(() => queryWorkspace(base, { pageSize: 101 })).toThrow();
    expect(() => queryWorkspace(base, { text: 'x'.repeat(257) })).toThrow();
  });
  test('redacted inventories preserve typed counts and hashed references without content disclosure', () => {
    const redacted = redactWorkspace(workspace());
    const text = JSON.stringify(redacted);
    expect(redacted).toMatchObject({
      kind: 'redacted-workspace-report',
      replayable: false,
      authenticated: false,
    });
    expect(redacted.summary.kinds).toEqual({
      POLICY: 1,
      SESSION: 1,
      CASES: 1,
      TRACE: 1,
      CAMPAIGN: 1,
    });
    for (const secret of [
      'Private workspace',
      'Private policy name',
      'README.md',
      'draftSaved',
      'Do not push',
    ])
      expect(text).not.toContain(secret);
  });
});
