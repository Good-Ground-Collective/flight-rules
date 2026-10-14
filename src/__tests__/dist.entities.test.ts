import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));

const runPackageFixture = (source: string): unknown =>
  JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", source], {
      cwd: root,
      encoding: "utf8",
    }),
  );

describe("packaged tracker entity composition", () => {
  it("retains confirmed identities from real root adapters in SDK operations without retrying", () => {
    const output = runPackageFixture(`
      import { GitHubTaskTracker, JiraTaskTracker } from '@good-ground-collective/flight-rules';
      import { DefaultTrackerEntityOperations, LaunchOperationAccessPolicy } from '@good-ground-collective/flight-rules/sdk';
      const results = [];
      for (const backend of ['github', 'jira']) {
        const routes = backend === 'github'
          ? ['ticket-create', 'epic-edit', 'ticket-edit', 'initiative-edit', 'tdd-create']
          : ['epic-create', 'initiative-create', 'ticket-create', 'epic-edit', 'ticket-edit', 'initiative-edit', 'tdd-create'];
        for (const route of routes) {
          const calls = [];
          const failed = async () => { throw new Error('follow-up failed'); };
          let written = false;
          const write = async (kind) => { calls.push(kind); written = true; return { data: { number: 901 } }; };
          let tracker;
          if (backend === 'github') {
            tracker = new GitHubTaskTracker({ token: 'fixture', owner: 'fixture', repo: 'fixture' });
            tracker.octokit = {
              rest: { issues: {
                create: () => write('create'),
                update: () => write('edit'),
                updateMilestone: () => write('edit'),
                get: async () => written ? failed() : { data: { body: '', labels: [] } },
                getMilestone: failed, listForRepo: failed, listComments: failed,
              } },
              request: failed,
            };
            tracker.gql = async (query) => {
              if (query.includes('query GetRepoAndCategory')) return { repository: { id: 'repo', discussionCategory: { id: 'category' } } };
              if (query.includes('mutation CreateDiscussion')) {
                await write('create');
                return { createDiscussion: { discussion: { number: 901 } } };
              }
              return failed();
            };
          } else {
            tracker = new JiraTaskTracker({ host: 'fixture.atlassian.net', email: 'fixture@example.com', token: 'fixture', project: 'PROJ', jpdProject: 'IDEA', confluenceSpaceKey: 'DOCS' });
            tracker.client.request = async (method, path) => {
              if (path.includes('/createmeta/')) return { issueTypes: [{ name: 'Epic' }, { name: 'Story' }] };
              if (path === '/project/IDEA') return { projectTypeKey: 'product_discovery' };
              if (method === 'POST' && path === '/issue') { await write('create'); return { key: 'PROJ-901' }; }
              if (method === 'PUT') return write('edit');
              if (!written && path.startsWith('/issue/')) return { fields: { description: null } };
              return failed();
            };
            tracker.confluence.request = async (method, path) => {
              if (path === '/spaces') return { results: [{ id: 'space' }] };
              if (method === 'POST' && path === '/pages') { await write('create'); return { id: '901' }; }
              return failed();
            };
          }
          const id = backend === 'github' || route === 'tdd-create' ? '901' : 'PROJ-901';
          const input = route.endsWith('-edit')
            ? { id, body: 'Portable body' }
            : { title: 'Created once', body: 'Portable body', ...(route === 'ticket-create' || route === 'tdd-create' ? { epicId: backend === 'github' ? '77' : 'PROJ-77' } : {}) };
          const registry = new DefaultTrackerEntityOperations({ cwd: process.cwd(), getTracker: () => tracker })
            .registry(new LaunchOperationAccessPolicy({ allowedOperationIds: [route] }));
          results.push({ backend, route, id, calls, result: await registry.invoke(route, input) });
        }
      }
      console.log(JSON.stringify(results));
    `);

    expect(output).toEqual(
      [
        ...["ticket-create", "epic-edit", "ticket-edit", "initiative-edit", "tdd-create"].map(
          (route) => ({ backend: "github", route, id: "901" }),
        ),
        ...[
          "epic-create",
          "initiative-create",
          "ticket-create",
          "epic-edit",
          "ticket-edit",
          "initiative-edit",
          "tdd-create",
        ].map((route) => ({
          backend: "jira",
          route,
          id: route === "tdd-create" ? "901" : "PROJ-901",
        })),
      ].map(({ backend, route, id }) => ({
        backend,
        route,
        id,
        calls: [route.endsWith("-edit") ? "edit" : "create"],
        result: {
          status: "partial",
          data: expect.objectContaining({ id }),
          error: { name: "TaskTrackerPartialWriteError", message: "follow-up failed" },
        },
      })),
    );
  });

  it("provides tracker review plans through the public core factory with its config and PR host", () => {
    const output = runPackageFixture(`
      import { DefaultFlightRules } from '@good-ground-collective/flight-rules';
      const core = new DefaultFlightRules({ cwd: process.cwd(), env: {} });
      const calls = [];
      core.tracker = () => ({
        getEpic: async () => ({ id: '1', title: 'Epic', childIssues: [{ id: '2', title: 'Ticket', status: 'In Review', blockedBy: [] }] }),
        getInitiative: async () => ({ id: '3', title: 'Initiative', epics: [{ id: '1' }] }),
      });
      core.prHost = () => ({ defaultBranch: async () => 'main', listOpenPullRequestsForTickets: async (ids) => { calls.push(ids); return []; } });
      core.config = () => ({ inReviewStatus: 'In Review' });
      const registry = core.trackerEntityOperations().registry();
      console.log(JSON.stringify({ calls, results: [await registry.invoke('epic-review-plan', { id: '1' }), await registry.invoke('initiative-review-plan', { id: '3' })] }));
    `);
    expect(output).toMatchObject({
      calls: [["2"], ["2"]],
      results: [
        { status: "success", data: { epic: { id: "1", title: "Epic" }, defaultBranch: "main" } },
        {
          status: "success",
          data: { initiative: { id: "3", title: "Initiative" }, defaultBranch: "main" },
        },
      ],
    });
  });

  it("rewrites an absolute reference for a relative attachment through the public evidence service", () => {
    const output = runPackageFixture(`
      import { mkdtempSync, writeFileSync, rmSync, realpathSync } from 'node:fs';
      import { tmpdir } from 'node:os';
      import { join, relative } from 'node:path';
      import { TrackerEvidenceService } from '@good-ground-collective/flight-rules';
      const directory = mkdtempSync(join(tmpdir(), 'fr-package-evidence-'));
      try {
        const path = join(realpathSync(directory), 'proof.png');
        writeFileSync(path, 'fixture');
        const specs = [relative(process.cwd(), path)];
        const service = new TrackerEvidenceService({ tracker: { addAttachment: async () => ({ id: 'ATT-1', filename: 'proof.png', mimeType: 'image/png' }) } });
        console.log(JSON.stringify(await service.attach({ ticketId: '1', body: '![Proof](' + path + ')', specs })));
      } finally { rmSync(directory, { recursive: true, force: true }); }
    `);
    expect(output).toMatchObject({
      body: "![Proof](attachment:proof.png)",
      attachments: [{ id: "ATT-1", referenced: true }],
    });
  });
});
