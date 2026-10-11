import { parseCaseSuite } from './cases';
export const exampleCaseSuite = parseCaseSuite(JSON.stringify({ schemaVersion: 1, id: 'coding-actions',
  title: 'Declared coding actions', cases: [
    { id: 'read', label: 'Read README', action: { operation: 'workspace.readFile', args: { repositoryId: 'mandate', path: 'README.md' } } },
    { id: 'commit', label: 'Prepare local commit', action: { operation: 'git.commit', args: {
      repositoryId: 'mandate', treeDigest: 'a'.repeat(64), messageDigest: 'b'.repeat(64),
    } } },
    { id: 'push', label: 'Push main', action: { operation: 'git.push', args: {
      repositoryId: 'mandate', remoteId: 'origin', ref: 'refs/heads/main', commitOid: 'c'.repeat(40),
    } } },
  ] }));
