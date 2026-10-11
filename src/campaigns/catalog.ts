import { policyExperiments } from '../lab/experiments';
import { scenarioCatalog } from '../scenarios/catalog';
import { parseCampaign } from './schema';
import { scenarioCampaignCases } from './catalog-scenarios';
import { traceCampaignCases } from './catalog-traces';
export const maintainedCampaign = parseCampaign(
  JSON.stringify({
    schemaVersion: 1,
    id: 'authority-evidence-regressions',
    title: 'Authority and evidence adversarial campaign',
    scenarios: [scenarioCatalog[0]],
    cases: [
      ...policyExperiments.map((experiment) => ({
        id: 'policy-' + experiment.id,
        title: experiment.title,
        category: experiment.category,
        kind: 'POLICY',
        experiment,
        expected: { passed: true },
      })),
      ...scenarioCampaignCases,
      ...traceCampaignCases,
    ],
  }),
);
