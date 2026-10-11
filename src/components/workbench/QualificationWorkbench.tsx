import { useState } from 'react';
import {
  exampleQualificationProfile,
  parseQualificationProfile,
  runQualification,
  serializeQualificationReport,
  verifyQualificationReport,
  compareQualificationReports,
  redactQualificationReport,
} from '../../qualification/index';
import type { QualificationReport } from '../../qualification/index';
import { JsonOutput } from './JsonOutput';
export function QualificationWorkbench() {
  const [text, setText] = useState(() => JSON.stringify(exampleQualificationProfile, null, 2));
  const [report, setReport] = useState<QualificationReport | null>(null);
  const [saved, setSaved] = useState('');
  const [verified, setVerified] = useState(false);
  const [baseline, setBaseline] = useState('');
  const [comparison, setComparison] = useState<ReturnType<
    typeof compareQualificationReports
  > | null>(null);
  const [redacted, setRedacted] = useState(false);
  const [error, setError] = useState('');
  function run() {
    setReport(null);
    setVerified(false);
    setComparison(null);
    setError('');
    try {
      const next = runQualification(parseQualificationProfile(text));
      setReport(next);
      setSaved(serializeQualificationReport(next));
    } catch {
      setSaved('');
      setError(
        'Profile rejected. Check bounded policy, unique action cases and explicit acceptance criteria.',
      );
    }
  }
  function verify() {
    const result = verifyQualificationReport(saved);
    setVerified(result.ok);
    setError(result.ok ? '' : 'Saved report verification failed: ' + result.code);
  }
  function compare() {
    setComparison(null);
    try {
      setComparison(compareQualificationReports(baseline, saved));
      setError('');
    } catch {
      setError('Baseline comparison requires two independently valid reports.');
    }
  }
  return (
    <section className="wb-panel wb-stack" aria-label="Declared policy qualification">
      <div>
        <h3>Policy qualification</h3>
        <p>
          Evaluate only the declared synthetic action cases and acceptance criteria. A passing
          profile does not authenticate approval or establish safety outside these checks.
        </p>
      </div>
      <label>
        Qualification profile JSON
        <textarea
          aria-label="Qualification profile JSON"
          className="wb-json-editor"
          value={text}
          maxLength={1024 * 1024}
          spellCheck={false}
          onChange={(event) => {
            setText(event.target.value);
            setReport(null);
            setSaved('');
            setVerified(false);
            setComparison(null);
            setError('');
          }}
        />
      </label>
      <button type="button" className="wb-primary" onClick={run}>
        Run qualification
      </button>
      {error && (
        <p role="alert" className="wb-error">
          {error}
        </p>
      )}
      {report !== null && (
        <>
          <p role="status">
            Declared criteria {report.qualified ? 'passed' : 'failed'} · {report.summary.total}{' '}
            checks · {report.summary.missingExpectations} missing expectations · no actions
            executed.
          </p>
          <div
            className="wb-table-scroll"
            role="region"
            aria-label="Qualification criteria rows"
            tabIndex={0}
          >
            <table className="wb-table" aria-label="Qualification criteria">
              <thead>
                <tr>
                  <th>Criterion</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {report.criteria.map((item) => (
                  <tr key={item.id}>
                    <td>{item.id}</td>
                    <td>{item.passed ? 'Pass' : 'Fail'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div
            className="wb-table-scroll"
            role="region"
            aria-label="Qualification case rows"
            tabIndex={0}
          >
            <table className="wb-table" aria-label="Qualification checks">
              <thead>
                <tr>
                  <th>Case</th>
                  <th>Expected</th>
                  <th>Observed</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {report.cases.map((item) => (
                  <tr key={item.id}>
                    <td>{item.label}</td>
                    <td>{item.expected ?? 'Not declared'}</td>
                    <td>{item.result?.decision.outcome ?? 'Invalid action'}</td>
                    <td>{item.passed === null ? 'Unqualified' : item.passed ? 'Pass' : 'Fail'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="wb-checkbox">
            <input
              type="checkbox"
              checked={redacted}
              onChange={(event) => setRedacted(event.target.checked)}
            />
            Redact qualification output
          </label>
          <JsonOutput
            label="Qualification output JSON"
            value={
              redacted
                ? JSON.stringify(redactQualificationReport(report), null, 2)
                : serializeQualificationReport(report)
            }
          />
        </>
      )}
      <label>
        Saved qualification report JSON
        <textarea
          aria-label="Saved qualification report JSON"
          className="wb-json-editor"
          value={saved}
          maxLength={4 * 1024 * 1024}
          spellCheck={false}
          onChange={(event) => {
            setSaved(event.target.value);
            setVerified(false);
            setComparison(null);
            setError('');
          }}
        />
      </label>
      <button type="button" className="wb-secondary" onClick={verify}>
        Verify saved qualification report
      </button>
      {verified && <p>Report independently reconstructed. Consistency is not authentication.</p>}
      <details>
        <summary>Compare a baseline report</summary>
        <label>
          Baseline qualification report JSON
          <textarea
            aria-label="Baseline qualification report JSON"
            className="wb-json-editor"
            value={baseline}
            maxLength={4 * 1024 * 1024}
            spellCheck={false}
            onChange={(event) => {
              setBaseline(event.target.value);
              setComparison(null);
            }}
          />
        </label>
        <button type="button" className="wb-secondary" onClick={compare}>
          Compare qualification baseline
        </button>
        {comparison !== null && (
          <JsonOutput
            label="Qualification comparison JSON"
            value={JSON.stringify(comparison, null, 2)}
          />
        )}
      </details>
    </section>
  );
}
