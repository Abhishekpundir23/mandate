import { useId, useState } from 'react';
import {
  getPolicyExperiment,
  policyExperiments,
  runPolicyExperiment,
  type ExperimentReport,
} from '../../lab/experiments';
import { JsonOutput } from './JsonOutput';

export function ExperimentWorkbench() {
  const prefix = useId();
  const [selected, setSelected] = useState(policyExperiments[0]!.id);
  const [report, setReport] = useState<ExperimentReport | null>(null);
  const experiment = getPolicyExperiment(selected);
  return (
    <section className="wb-panel" aria-labelledby={prefix + '-title'}>
      <h3 id={prefix + '-title'}>Maintained policy experiments</h3>
      <p>
        Compare real gate decisions with explicit expected outcomes. These advisory examples are
        separate from the 15-case canonical benchmark.
      </p>
      <label htmlFor={prefix + '-select'}>
        Policy experiment
        <select
          id={prefix + '-select'}
          value={selected}
          onChange={(event) => {
            setSelected(event.target.value);
            setReport(null);
          }}
        >
          {policyExperiments.map((item) => (
            <option key={item.id} value={item.id}>
              {item.category} · {item.title}
            </option>
          ))}
        </select>
      </label>
      <p className="wb-help">{experiment.description}</p>
      <div className="wb-toolbar">
        <button type="button" onClick={() => setReport(runPolicyExperiment(experiment))}>
          Run policy experiment
        </button>
      </div>
      {report === null ? null : (
        <>
          <p className="wb-notice" role="status" aria-label="Experiment status">
            {report.steps.filter((step) => step.passed).length} of {report.steps.length}{' '}
            expectations passed · executionPerformed: false
          </p>
          <div
            className="wb-table-scroll"
            role="region"
            aria-label="Experiment step table"
            tabIndex={0}
          >
            <table className="wb-table" aria-label="Policy experiment steps">
              <thead>
                <tr>
                  <th scope="col">Step</th>
                  <th scope="col">Version</th>
                  <th scope="col">Expected</th>
                  <th scope="col">Actual</th>
                  <th scope="col">Result</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {report.steps.map((step) => (
                  <tr key={step.index}>
                    <th scope="row">{step.index}</th>
                    <td>{step.version}</td>
                    <td>{step.expectedOutcome}</td>
                    <td>{step.actualOutcome}</td>
                    <td>{step.passed ? 'Pass' : 'Fail'}</td>
                    <td>{step.why}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details>
            <summary>Experiment policy and report</summary>
            <JsonOutput
              label="Experiment policy JSON"
              value={JSON.stringify(experiment.policy, null, 2)}
            />
            <JsonOutput label="Experiment report JSON" value={JSON.stringify(report, null, 2)} />
          </details>
        </>
      )}
    </section>
  );
}
