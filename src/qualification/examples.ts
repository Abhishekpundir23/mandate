import { getPolicyTemplate } from '../policy/templates';
import { exampleCaseSuite } from '../impact/examples';
import { validateQualificationProfile } from './profile';
export const exampleQualificationProfile = validateQualificationProfile({
  schemaVersion: 1,
  kind: 'policy-qualification-profile',
  id: 'draft-boundaries',
  title: 'Declared draft boundaries',
  policy: getPolicyTemplate('draft-only').policy,
  cases: {
    ...exampleCaseSuite,
    cases: exampleCaseSuite.cases.map((item) => ({
      ...item,
      expected: { after: item.id === 'push' ? 'BLOCK' : 'ALLOW' },
    })),
  },
  criteria: {
    minimumCases: 3,
    requiredCaseIds: ['read', 'commit', 'push'],
    requireAllExpectations: true,
    maximumUnexpected: 0,
    maximumOutcomes: { ALLOW: 2, BLOCK: 1, CONFIRM: 0 },
  },
});
