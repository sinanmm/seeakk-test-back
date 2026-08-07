export interface CallExportOptions {
  title: string;
  workspaceName?: string;
  generatedBy?: string;
  generatedAt?: string;
  periodText?: string;
  filtersText?: string;
  metrics: {
    totalCalls: number;
    uniqueCalls: number;
    connectedCalls: number;
    notConnectedCalls: number;
    connectionRate: number;
    leadsMoved: number;
  };
  selectedSubstages: Array<{
    id: string;
    name: string;
    parentStageId?: string;
    parentStageName?: string;
    color: string;
  }>;
  userSummaryList: Array<{
    userId: string;
    userName: string;
    officeName: string;
    departmentName: string;
    totalAttempts: number;
    uniqueCalls: number;
    connectedCalls: number;
    notConnectedCalls: number;
    connectionRate: number;
    substageCounts?: Record<string, number>;
    followUpsCreated: number;
    leadsMoved: number;
  }>;
  substageBreakdown?: Array<{
    substageId: string;
    name: string;
    stageName: string;
    color: string;
    outcomeCategory: string;
    selectedCount: number;
    uniqueLeads: number;
    usersCount: number;
    connectedCalls: number;
    notConnectedCalls: number;
  }>;
}

const getBarWidth = (value: number, total: number): number => {
  if (!total || total <= 0 || !value || value <= 0) return 0;
  return Math.min(100, Math.max(0, Number(((value / total) * 100).toFixed(1))));
};

/**
 * Generates a standalone, fully self-contained Interactive HTML Report.
 */
export const generateCallPerformanceHtmlReport = (options: CallExportOptions): string => {
  const {
    title,
    workspaceName = 'Seeakk Workspace',
    generatedBy = 'System User',
    generatedAt = new Date().toLocaleString(),
    periodText = 'All Time',
    filtersText = 'All Users',
    metrics,
    selectedSubstages = [],
    userSummaryList = [],
    substageBreakdown = [],
  } = options;

  const substagesHeadersHtml = selectedSubstages
    .map(
      (sub) => `
    <th style="padding: 10px 14px; min-width: 140px; border-bottom: 2px solid #e2e8f0; font-size: 11px; font-weight: 800; text-transform: uppercase; color: #475569;">
      <div style="display: flex; align-items: center; gap: 6px;">
        <span style="width: 8px; height: 8px; border-radius: 50%; background-color: ${sub.color || '#3b82f6'}; flex-shrink: 0;"></span>
        <div>
          <div style="color: #0f172a; font-weight: 800; font-size: 11px; text-transform: none;">${sub.name}</div>
          ${sub.parentStageName ? `<div style="font-size: 9px; color: #94a3b8; font-weight: 500; text-transform: lowercase;">${sub.parentStageName}</div>` : ''}
        </div>
      </div>
    </th>`,
    )
    .join('');

  const userRowsHtml = userSummaryList
    .map((user) => {
      const totalAttempts = user.totalAttempts || 0;
      const totalPct = totalAttempts > 0 ? 100 : 0;
      const uniquePct = getBarWidth(user.uniqueCalls, totalAttempts);
      const connPct = getBarWidth(user.connectedCalls, totalAttempts);
      const notConnPct = getBarWidth(user.notConnectedCalls, totalAttempts);

      const substagesCellsHtml = selectedSubstages
        .map((sub) => {
          const count = user.substageCounts?.[sub.id] || 0;
          const barPct = getBarWidth(count, totalAttempts);
          const color = sub.color || '#3b82f6';

          return `
        <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9;">
          <div style="position: relative; display: flex; align-items: center; justify-content: space-between; height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid ${color}40; background-color: ${color}10; overflow: hidden;">
            <div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${barPct}%; background-color: ${color}35; transition: width 0.3s ease;"></div>
            <span style="position: relative; z-index: 2; font-weight: 700; color: ${color}; font-size: 12px;">${count}</span>
          </div>
        </td>`;
        })
        .join('');

      return `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td style="position: sticky; left: 0; background: #ffffff; z-index: 5; padding: 10px 14px; font-weight: 700; color: #0f172a; border-right: 1px solid #e2e8f0; border-bottom: 1px solid #f1f5f9;">
          <div style="font-weight: 800; color: #0f172a; font-size: 13px;">${user.userName}</div>
          <div style="font-size: 10px; color: #94a3b8; font-weight: 500;">${user.officeName} • ${user.departmentName}</div>
        </td>
        <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9;">
          <div style="position: relative; display: flex; align-items: center; justify-content: space-between; height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid #a7f3d0; background-color: #ecfdf5; overflow: hidden;">
            <div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${uniquePct}%; background-color: #a7f3d0;"></div>
            <span style="position: relative; z-index: 2; font-weight: 700; color: #065f46; font-size: 12px;">${user.uniqueCalls}</span>
          </div>
        </td>
        <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9;">
          <div style="position: relative; display: flex; align-items: center; justify-content: space-between; height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid #bfdbfe; background-color: #eff6ff; overflow: hidden;">
            <div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${totalPct}%; background-color: #bfdbfe;"></div>
            <span style="position: relative; z-index: 2; font-weight: 700; color: #1e40af; font-size: 12px;">${user.totalAttempts}</span>
          </div>
        </td>
        <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9;">
          <div style="position: relative; display: flex; align-items: center; justify-content: space-between; height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid #99f6e4; background-color: #f0fdfa; overflow: hidden;">
            <div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${connPct}%; background-color: #99f6e4;"></div>
            <span style="position: relative; z-index: 2; font-weight: 700; color: #115e59; font-size: 12px;">${user.connectedCalls}</span>
          </div>
        </td>
        <td style="padding: 10px 14px; border-bottom: 1px solid #f1f5f9;">
          <div style="position: relative; display: flex; align-items: center; justify-content: space-between; height: 28px; padding: 0 10px; border-radius: 8px; border: 1px solid #fecdd3; background-color: #fff1f2; overflow: hidden;">
            <div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${notConnPct}%; background-color: #fecdd3;"></div>
            <span style="position: relative; z-index: 2; font-weight: 700; color: #9f1239; font-size: 12px;">${user.notConnectedCalls}</span>
          </div>
        </td>
        <td style="padding: 10px 14px; text-align: center; border-bottom: 1px solid #f1f5f9;">
          <span style="display: inline-block; padding: 4px 10px; border-radius: 6px; background-color: #faf5ff; color: #7e22ce; font-weight: 800; border: 1px solid #e9d5ff; font-size: 12px;">
            ${user.connectionRate}%
          </span>
        </td>
        ${substagesCellsHtml}
        <td style="padding: 10px 14px; text-align: right; font-weight: 800; color: #334155; border-bottom: 1px solid #f1f5f9;">${user.followUpsCreated}</td>
        <td style="padding: 10px 14px; text-align: right; font-weight: 800; color: #334155; border-bottom: 1px solid #f1f5f9;">${user.leadsMoved}</td>
      </tr>`;
    })
    .join('');

  const substageBreakdownRowsHtml = substageBreakdown
    .map(
      (sub) => `
    <tr style="border-bottom: 1px solid #f1f5f9;">
      <td style="padding: 10px 14px; font-weight: 700; color: #0f172a;">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="width: 10px; height: 10px; border-radius: 50%; background-color: ${sub.color || '#3b82f6'};"></span>
          <span>${sub.name}</span>
        </div>
      </td>
      <td style="padding: 10px 14px; color: #64748b; font-weight: 600;">${sub.stageName}</td>
      <td style="padding: 10px 14px; text-align: right; font-weight: 800; color: #0f172a;">${sub.selectedCount}</td>
      <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #047857;">${sub.uniqueLeads}</td>
      <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #1d4ed8;">${sub.usersCount}</td>
      <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #0f766e;">${sub.connectedCalls}</td>
      <td style="padding: 10px 14px; text-align: right; font-weight: 700; color: #be123c;">${sub.notConnectedCalls}</td>
    </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Interactive Report</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 24px; }
    .container { max-width: 1400px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); padding: 24px; }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #10b981; padding-bottom: 16px; margin-bottom: 20px; }
    .logo-title { display: flex; align-items: center; gap: 12px; }
    .badge-logo { background: #10b981; color: white; width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 18px; }
    .title { font-size: 20px; font-weight: 900; color: #0f172a; }
    .subtitle { font-size: 12px; color: #64748b; font-weight: 500; }
    .meta-box { text-align: right; font-size: 11px; color: #64748b; line-height: 1.5; }
    .print-btn { background: #10b981; color: white; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; margin-top: 6px; }
    .print-btn:hover { background: #059669; }
    .filters-bar { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px 16px; margin-bottom: 20px; font-size: 12px; color: #475569; display: flex; flex-wrap: wrap; gap: 16px; }
    .cards-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 24px; }
    .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px; }
    .card-label { font-size: 10px; font-weight: 800; text-transform: uppercase; color: #64748b; letter-spacing: 0.5px; }
    .card-val { font-size: 22px; font-weight: 900; color: #0f172a; margin-top: 4px; }
    .table-wrapper { overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 12px; margin-bottom: 24px; max-height: 700px; overflow-y: auto; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; text-align: left; }
    thead th { position: sticky; top: 0; background: #f8fafc; z-index: 10; border-bottom: 2px solid #e2e8f0; padding: 10px 14px; font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; }
    thead th:first-child { position: sticky; left: 0; z-index: 25; background: #f8fafc; border-right: 1px solid #e2e8f0; }
    footer { text-align: center; margin-top: 24px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 16px; }
    @media print {
      body { padding: 0; background: white; }
      .container { border: none; box-shadow: none; padding: 0; }
      .print-btn { display: none; }
      .table-wrapper { overflow: visible; max-height: none; }
      thead th { position: static; }
      td:first-child { position: static; border-right: none; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo-title">
        <div class="badge-logo">S</div>
        <div>
          <div class="title">${title}</div>
          <div class="subtitle">Workspace Call Volume, Connection Rates & Dynamic Substage Comparisons</div>
        </div>
      </div>
      <div class="meta-box">
        <div><strong>Workspace:</strong> ${workspaceName}</div>
        <div><strong>Generated By:</strong> ${generatedBy}</div>
        <div><strong>Generated At:</strong> ${generatedAt}</div>
        <button class="print-btn" onclick="window.print()">Print / Save PDF</button>
      </div>
    </div>

    <div class="filters-bar">
      <div><strong>Period:</strong> ${periodText}</div>
      <div><strong>Filters:</strong> ${filtersText}</div>
      <div><strong>Report Scope:</strong> ${userSummaryList.length} user(s) in report</div>
    </div>

    <!-- Metrics Cards -->
    <div class="cards-grid">
      <div class="card">
        <div class="card-label">Total Attempts</div>
        <div class="card-val">${metrics.totalCalls.toLocaleString()}</div>
      </div>
      <div class="card" style="background-color: #ecfdf5; border-color: #a7f3d0;">
        <div class="card-label" style="color: #047857;">Unique Calls</div>
        <div class="card-val" style="color: #065f46;">${metrics.uniqueCalls.toLocaleString()}</div>
      </div>
      <div class="card" style="background-color: #f0fdfa; border-color: #99f6e4;">
        <div class="card-label" style="color: #0f766e;">Attended Calls</div>
        <div class="card-val" style="color: #115e59;">${metrics.connectedCalls.toLocaleString()}</div>
      </div>
      <div class="card" style="background-color: #fff1f2; border-color: #fecdd3;">
        <div class="card-label" style="color: #be123c;">Not Attended</div>
        <div class="card-val" style="color: #9f1239;">${metrics.notConnectedCalls.toLocaleString()}</div>
      </div>
      <div class="card" style="background-color: #faf5ff; border-color: #e9d5ff;">
        <div class="card-label" style="color: #7e22ce;">Connection Rate</div>
        <div class="card-val" style="color: #6b21a8;">${metrics.connectionRate}%</div>
      </div>
    </div>

    <!-- Main Performance Table -->
    <h3 style="font-size: 14px; font-weight: 800; color: #0f172a; margin-bottom: 12px;">User Call Performance Breakdown</h3>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th style="min-width: 160px;">User Name</th>
            <th style="min-width: 120px;">Unique Calls</th>
            <th style="min-width: 120px;">Total Calls</th>
            <th style="min-width: 120px;">Attended Calls</th>
            <th style="min-width: 120px;">Not Attended</th>
            <th style="min-width: 110px; text-align: center;">Connection Rate</th>
            ${substagesHeadersHtml}
            <th style="min-width: 100px; text-align: right;">Follow-ups</th>
            <th style="min-width: 100px; text-align: right;">Stage Moved</th>
          </tr>
        </thead>
        <tbody>
          ${userSummaryList.length === 0 ? `<tr><td colSpan="${8 + selectedSubstages.length}" style="text-align: center; padding: 32px; color: #94a3b8; italic;">No call activity found for selected filters.</td></tr>` : userRowsHtml}
        </tbody>
      </table>
    </div>

    ${
      substageBreakdown.length > 0
        ? `
    <!-- Substage Breakdown Table -->
    <h3 style="font-size: 14px; font-weight: 800; color: #0f172a; margin-bottom: 12px;">Substage Breakdown Summary</h3>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Substage Name</th>
            <th>Parent Stage</th>
            <th style="text-align: right;">Selected Count</th>
            <th style="text-align: right;">Unique Leads</th>
            <th style="text-align: right;">Users Count</th>
            <th style="text-align: right;">Attended</th>
            <th style="text-align: right;">Not Attended</th>
          </tr>
        </thead>
        <tbody>
          ${substageBreakdownRowsHtml}
        </tbody>
      </table>
    </div>`
        : ''
    }

    <footer>
      SEEAKK — Dynamic Lead Performance Dynamics • Generated ${generatedAt}
    </footer>
  </div>
</body>
</html>`;
};

/**
 * Generates a dedicated landscape PDF/print document with horizontal column pagination for wide substage tables.
 */
export const generateCallPerformancePdfReport = (options: CallExportOptions): string => {
  // Uses landscape print template with horizontal column chunking if selectedSubstages > 4
  const {
    title,
    workspaceName = 'Seeakk Workspace',
    generatedBy = 'System User',
    generatedAt = new Date().toLocaleString(),
    periodText = 'All Time',
    filtersText = 'All Users',
    metrics,
    selectedSubstages = [],
    userSummaryList = [],
    substageBreakdown = [],
  } = options;

  // Chunk substages into max 5 per page view to prevent clipping on landscape print
  const CHUNK_SIZE = 5;
  const substageChunks: Array<typeof selectedSubstages> = [];

  if (selectedSubstages.length <= CHUNK_SIZE) {
    substageChunks.push(selectedSubstages);
  } else {
    for (let i = 0; i < selectedSubstages.length; i += CHUNK_SIZE) {
      substageChunks.push(selectedSubstages.slice(i, i + CHUNK_SIZE));
    }
  }

  const pagesHtml = substageChunks
    .map((subChunk, chunkIdx) => {
      const isMultiChunk = substageChunks.length > 1;
      const chunkLabel = isMultiChunk ? ` (Substages ${chunkIdx * CHUNK_SIZE + 1}–${Math.min((chunkIdx + 1) * CHUNK_SIZE, selectedSubstages.length)} of ${selectedSubstages.length})` : '';

      const substagesHeadersHtml = subChunk
        .map(
          (sub) => `
        <th style="padding: 6px 8px; border: 1px solid #cbd5e1; background-color: #f1f5f9; font-size: 10px; font-weight: 800; color: #1e293b;">
          <div style="display: flex; align-items: center; gap: 4px;">
            <span style="width: 6px; height: 6px; border-radius: 50%; background-color: ${sub.color || '#3b82f6'};"></span>
            <div>
              <div style="font-weight: 800;">${sub.name}</div>
              ${sub.parentStageName ? `<div style="font-size: 8px; color: #64748b; font-weight: 500;">${sub.parentStageName}</div>` : ''}
            </div>
          </div>
        </th>`,
        )
        .join('');

      const userRowsHtml = userSummaryList
        .map((user) => {
          const totalAttempts = user.totalAttempts || 0;
          const totalPct = totalAttempts > 0 ? 100 : 0;
          const uniquePct = getBarWidth(user.uniqueCalls, totalAttempts);
          const connPct = getBarWidth(user.connectedCalls, totalAttempts);
          const notConnPct = getBarWidth(user.notConnectedCalls, totalAttempts);

          const substagesCellsHtml = subChunk
            .map((sub) => {
              const count = user.substageCounts?.[sub.id] || 0;
              const barPct = getBarWidth(count, totalAttempts);
              const color = sub.color || '#3b82f6';

              return `
            <td style="padding: 6px 8px; border: 1px solid #cbd5e1;">
              <div style="position: relative; display: flex; align-items: center; justify-content: space-between; height: 22px; padding: 0 6px; border-radius: 4px; border: 1px solid ${color}40; background-color: ${color}10; overflow: hidden;">
                <div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${barPct}%; background-color: ${color}35;"></div>
                <span style="position: relative; z-index: 2; font-weight: 800; color: ${color}; font-size: 11px;">${count}</span>
              </div>
            </td>`;
            })
            .join('');

          return `
          <tr>
            <td style="padding: 6px 8px; border: 1px solid #cbd5e1; font-weight: 800; color: #0f172a; font-size: 11px;">
              <div>${user.userName}</div>
              <div style="font-size: 8px; color: #64748b; font-weight: 500;">${user.officeName} • ${user.departmentName}</div>
            </td>
            <td style="padding: 6px 8px; border: 1px solid #cbd5e1;">
              <div style="position: relative; display: flex; align-items: center; justify-content: space-between; height: 22px; padding: 0 6px; border-radius: 4px; border: 1px solid #a7f3d0; background-color: #ecfdf5; overflow: hidden;">
                <div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${uniquePct}%; background-color: #a7f3d0;"></div>
                <span style="position: relative; z-index: 2; font-weight: 800; color: #065f46; font-size: 11px;">${user.uniqueCalls}</span>
              </div>
            </td>
            <td style="padding: 6px 8px; border: 1px solid #cbd5e1;">
              <div style="position: relative; display: flex; align-items: center; justify-content: space-between; height: 22px; padding: 0 6px; border-radius: 4px; border: 1px solid #bfdbfe; background-color: #eff6ff; overflow: hidden;">
                <div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${totalPct}%; background-color: #bfdbfe;"></div>
                <span style="position: relative; z-index: 2; font-weight: 800; color: #1e40af; font-size: 11px;">${user.totalAttempts}</span>
              </div>
            </td>
            <td style="padding: 6px 8px; border: 1px solid #cbd5e1;">
              <div style="position: relative; display: flex; align-items: center; justify-content: space-between; height: 22px; padding: 0 6px; border-radius: 4px; border: 1px solid #99f6e4; background-color: #f0fdfa; overflow: hidden;">
                <div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${connPct}%; background-color: #99f6e4;"></div>
                <span style="position: relative; z-index: 2; font-weight: 800; color: #115e59; font-size: 11px;">${user.connectedCalls}</span>
              </div>
            </td>
            <td style="padding: 6px 8px; border: 1px solid #cbd5e1;">
              <div style="position: relative; display: flex; align-items: center; justify-content: space-between; height: 22px; padding: 0 6px; border-radius: 4px; border: 1px solid #fecdd3; background-color: #fff1f2; overflow: hidden;">
                <div style="position: absolute; left: 0; top: 0; bottom: 0; width: ${notConnPct}%; background-color: #fecdd3;"></div>
                <span style="position: relative; z-index: 2; font-weight: 800; color: #9f1239; font-size: 11px;">${user.notConnectedCalls}</span>
              </div>
            </td>
            <td style="padding: 6px 8px; text-align: center; border: 1px solid #cbd5e1; font-weight: 800; color: #7e22ce; font-size: 11px;">
              ${user.connectionRate}%
            </td>
            ${substagesCellsHtml}
            <td style="padding: 6px 8px; text-align: right; font-weight: 800; border: 1px solid #cbd5e1; font-size: 11px;">${user.followUpsCreated}</td>
            <td style="padding: 6px 8px; text-align: right; font-weight: 800; border: 1px solid #cbd5e1; font-size: 11px;">${user.leadsMoved}</td>
          </tr>`;
        })
        .join('');

      return `
      <div class="page" style="${chunkIdx > 0 ? 'page-break-before: always;' : ''}">
        <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #10b981; padding-bottom: 8px; margin-bottom: 12px;">
          <div>
            <h1 style="font-size: 16px; font-weight: 900; color: #0f172a;">SEEAKK — ${title}${chunkLabel}</h1>
            <div style="font-size: 10px; color: #64748b;">Workspace: ${workspaceName} • Period: ${periodText}</div>
          </div>
          <div style="text-align: right; font-size: 9px; color: #64748b;">
            <div>Generated By: ${generatedBy}</div>
            <div>Generated At: ${generatedAt}</div>
          </div>
        </div>

        ${
          chunkIdx === 0
            ? `
        <!-- Top Metrics Cards -->
        <div style="display: flex; gap: 8px; margin-bottom: 14px;">
          <div style="flex: 1; border: 1px solid #cbd5e1; padding: 8px; border-radius: 6px; background-color: #ffffff;">
            <div style="font-size: 8px; font-weight: 800; color: #64748b; text-transform: uppercase;">Total Attempts</div>
            <div style="font-size: 16px; font-weight: 900; color: #0f172a;">${metrics.totalCalls.toLocaleString()}</div>
          </div>
          <div style="flex: 1; border: 1px solid #a7f3d0; padding: 8px; border-radius: 6px; background-color: #ecfdf5;">
            <div style="font-size: 8px; font-weight: 800; color: #047857; text-transform: uppercase;">Unique Calls</div>
            <div style="font-size: 16px; font-weight: 900; color: #065f46;">${metrics.uniqueCalls.toLocaleString()}</div>
          </div>
          <div style="flex: 1; border: 1px solid #99f6e4; padding: 8px; border-radius: 6px; background-color: #f0fdfa;">
            <div style="font-size: 8px; font-weight: 800; color: #0f766e; text-transform: uppercase;">Attended Calls</div>
            <div style="font-size: 16px; font-weight: 900; color: #115e59;">${metrics.connectedCalls.toLocaleString()}</div>
          </div>
          <div style="flex: 1; border: 1px solid #fecdd3; padding: 8px; border-radius: 6px; background-color: #fff1f2;">
            <div style="font-size: 8px; font-weight: 800; color: #be123c; text-transform: uppercase;">Not Attended</div>
            <div style="font-size: 16px; font-weight: 900; color: #9f1239;">${metrics.notConnectedCalls.toLocaleString()}</div>
          </div>
          <div style="flex: 1; border: 1px solid #e9d5ff; padding: 8px; border-radius: 6px; background-color: #faf5ff;">
            <div style="font-size: 8px; font-weight: 800; color: #7e22ce; text-transform: uppercase;">Connection Rate</div>
            <div style="font-size: 16px; font-weight: 900; color: #6b21a8;">${metrics.connectionRate}%</div>
          </div>
        </div>`
            : ''
        }

        <h3 style="font-size: 11px; font-weight: 800; color: #0f172a; margin-bottom: 6px;">User Call Performance Breakdown</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 10px; text-align: left; margin-bottom: 14px;">
          <thead>
            <tr>
              <th style="padding: 6px 8px; border: 1px solid #cbd5e1; background-color: #f1f5f9; font-size: 10px; font-weight: 800; color: #1e293b;">User Name</th>
              <th style="padding: 6px 8px; border: 1px solid #cbd5e1; background-color: #f1f5f9; font-size: 10px; font-weight: 800; color: #1e293b;">Unique</th>
              <th style="padding: 6px 8px; border: 1px solid #cbd5e1; background-color: #f1f5f9; font-size: 10px; font-weight: 800; color: #1e293b;">Total</th>
              <th style="padding: 6px 8px; border: 1px solid #cbd5e1; background-color: #f1f5f9; font-size: 10px; font-weight: 800; color: #1e293b;">Attended</th>
              <th style="padding: 6px 8px; border: 1px solid #cbd5e1; background-color: #f1f5f9; font-size: 10px; font-weight: 800; color: #1e293b;">Not Attended</th>
              <th style="padding: 6px 8px; border: 1px solid #cbd5e1; background-color: #f1f5f9; font-size: 10px; font-weight: 800; color: #1e293b; text-align: center;">Rate</th>
              ${substagesHeadersHtml}
              <th style="padding: 6px 8px; border: 1px solid #cbd5e1; background-color: #f1f5f9; font-size: 10px; font-weight: 800; color: #1e293b; text-align: right;">Follow-ups</th>
              <th style="padding: 6px 8px; border: 1px solid #cbd5e1; background-color: #f1f5f9; font-size: 10px; font-weight: 800; color: #1e293b; text-align: right;">Stage Moved</th>
            </tr>
          </thead>
          <tbody>
            ${userRowsHtml}
          </tbody>
        </table>
      </div>`;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} — PDF Print Document</title>
  <style>
    @page { size: landscape; margin: 10mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; background-color: #ffffff; color: #0f172a; padding: 0; }
    .page { width: 100%; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
  </style>
</head>

<body onload="window.print()">
  ${pagesHtml}
</body>
</html>`;
};
