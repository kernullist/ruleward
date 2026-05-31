import type { Diagnostic, DiagLoc, Severity } from '../diagnostics';

/** Diagnostic[] → SARIF 2.1.0 (teardown §6 / FROZEN §2 정본). 둘 다 없는 차별 출력. */

const LEVEL: Record<Severity, 'error' | 'warning' | 'note'> = {
  error: 'error',
  warning: 'warning',
  info: 'note',
};

const INFO_URI = 'https://github.com/kernullist/agent_instruction_lint';

function physical(l: DiagLoc): Record<string, unknown> {
  const region: Record<string, unknown> = {};
  if (l.line) region['startLine'] = l.line;
  if (l.endLine) region['endLine'] = l.endLine;
  if (l.col) region['startColumn'] = l.col;
  return {
    physicalLocation: {
      artifactLocation: { uri: l.file },
      ...(Object.keys(region).length ? { region } : {}),
    },
  };
}

export function toSarif(diagnostics: Diagnostic[], toolVersion = '0.0.0'): Record<string, unknown> {
  const ruleIds = [...new Set(diagnostics.map((d) => d.checkId))];
  const rules = ruleIds.map((id) => ({
    id,
    shortDescription: { text: id },
    helpUri: `${INFO_URI}/blob/main/docs/checks/${id.replace('/', '-')}.md`,
    defaultConfiguration: { level: LEVEL[worstLevelFor(diagnostics, id)] },
  }));

  const results = diagnostics.map((d) => {
    const r: Record<string, unknown> = {
      ruleId: d.checkId,
      level: LEVEL[d.severity],
      message: { text: d.message },
      locations: [physical(d.location)],
      partialFingerprints: { 'ail/v1': d.fingerprint },
      properties: { confidence: d.confidence, engine: d.engine },
    };
    if (d.related?.length) {
      r['relatedLocations'] = d.related.map((rel) => ({ ...physical(rel.loc), message: { text: rel.role } }));
    }
    if (d.fix?.kind === 'auto') {
      r['fixes'] = [
        {
          description: { text: d.fix.description },
          artifactChanges: d.fix.edits.map((e) => ({
            artifactLocation: { uri: e.file },
            replacements: [{ deletedRegion: { startLine: e.line }, insertedContent: { text: e.newText } }],
          })),
        },
      ];
    }
    return r;
  });

  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: { driver: { name: 'ail', version: toolVersion, informationUri: INFO_URI, rules } },
        results,
      },
    ],
  };
}

function worstLevelFor(diags: Diagnostic[], checkId: string): Severity {
  let worst: Severity = 'info';
  for (const d of diags) {
    if (d.checkId !== checkId) continue;
    if (d.severity === 'error') return 'error';
    if (d.severity === 'warning') worst = 'warning';
  }
  return worst;
}
