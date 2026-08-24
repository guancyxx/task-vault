import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { agentProgress, type AgentPhase } from '../src/model/agentProgress';
import type { Status, Task } from '../src/model/types';

interface CorpusCase {
  name: string;
  status: Status;
  assignee: string;
  dispatched: string | null;
  body: string;
  expect: {
    tsPhase: AgentPhase | null;
    tsLastActivity: string | null;
  };
}

interface Corpus {
  cases: CorpusCase[];
}

const corpusPath = fileURLToPath(new URL('./corpus/agent-log.json', import.meta.url));
const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as Corpus;

describe('agentProgress (FR-028 cross-impl corpus)', () => {
  for (const c of corpus.cases) {
    it(c.name, () => {
      const task: Task = {
        id: c.name,
        title: c.name,
        status: c.status,
        created: '2026-08-19T09:00',
        assignee: c.assignee,
        dispatched: c.dispatched ?? undefined,
      };
      const expected = c.expect.tsPhase === null
        ? null
        : c.expect.tsLastActivity === null
          ? { phase: c.expect.tsPhase }
          : { phase: c.expect.tsPhase, lastActivity: c.expect.tsLastActivity };
      expect(agentProgress(task, c.body)).toEqual(expected);
    });
  }
});
