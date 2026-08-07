export interface SummaryExportOptions {
  title: string;
  workspaceName?: string;
  generatedBy?: string;
  generatedAt?: string;
  periodText?: string;
  filtersText?: string;
  totalRevenue: number;
  totalLeads: number;
  userStats: Array<{
    userId: string;
    name: string;
    role: string;
    department: string;
    branch: string;
    leadsCreated: number;
    revenueGenerated: number;
  }>;
}

const formatCurrency = (val: number): string => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(val || 0);
};

/**
 * Generates a dedicated multi-page PDF document for Summary Activity & Performance Reports.
 */
export const generateSummaryReportPdfReport = (options: SummaryExportOptions): string => {
  const {
    title = 'Summary Reports',
    workspaceName = 'Seeakk Workspace',
    generatedBy = 'System User',
    generatedAt = new Date().toLocaleString(),
    periodText = 'All Time',
    filtersText = 'All Users',
    totalRevenue = 0,
    totalLeads = 0,
    userStats = [],
  } = options;

  const rowsHtml = userStats
    .map(
      (user, idx) => `
    <tr style="border-bottom: 1px solid #f1f5f9;">
      <td style="padding: 10px 14px; font-weight: 900; color: #94a3b8; width: 60px; position: sticky; left: 0; background: #ffffff;">#${idx + 1}</td>
      <td style="padding: 10px 14px; font-weight: 800; color: #0f172a; position: sticky; left: 60px; background: #ffffff;">${user.name || 'Unknown User'}</td>
      <td style="padding: 10px 14px; color: #475569; font-weight: 600;">${user.role || '-'}</td>
      <td style="padding: 10px 14px; color: #475569; font-weight: 600;">${user.branch || '-'}</td>
      <td style="padding: 10px 14px; text-align: center; font-weight: 800; color: #0f172a;">${user.leadsCreated.toLocaleString()}</td>
      <td style="padding: 10px 14px; text-align: right; font-weight: 900; color: #059669;">${formatCurrency(user.revenueGenerated)}</td>
    </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Seeakk — ${title}</title>
  <style>
    @page { size: portrait; margin: 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 24px; }
    .container { max-width: 1200px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; padding: 24px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #10b981; padding-bottom: 16px; margin-bottom: 20px; }
    .logo-title { display: flex; align-items: center; gap: 12px; }
    .badge-logo { background: #10b981; color: white; width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-weight: 900; font-size: 20px; }
    .title { font-size: 22px; font-weight: 900; color: #0f172a; }
    .subtitle { font-size: 12px; color: #64748b; font-weight: 600; margin-top: 2px; }
    .meta-box { text-align: right; font-size: 11px; color: #64748b; line-height: 1.6; }
    .action-bar { display: flex; justify-content: flex-end; margin-bottom: 16px; }
    .btn-print { background-color: #059669; color: #ffffff; border: none; padding: 8px 16px; border-radius: 8px; font-weight: 700; font-size: 12px; cursor: pointer; display: inline-flex; items-center: center; gap: 6px; }
    .btn-print:hover { background-color: #047857; }
    .filters-bar { background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; padding: 12px 16px; margin-bottom: 24px; font-size: 12px; color: #065f46; display: flex; flex-wrap: wrap; gap: 20px; }
    .cards-grid { display: flex; gap: 16px; margin-bottom: 28px; }
    .card { flex: 1; border-radius: 14px; padding: 16px 20px; border: 1px solid #e2e8f0; background: #ffffff; }
    .card-emerald { border-color: #a7f3d0; background: linear-gradient(135deg, #ecfdf5 0%, #f0fdf4 100%); }
    .card-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; color: #047857; }
    .card-val { font-size: 26px; font-weight: 900; color: #065f46; margin-top: 4px; }
    .table-container { width: 100%; border: 1px solid #e2e8f0; border-radius: 14px; overflow-x: auto; margin-bottom: 24px; }
    table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 13px; text-align: left; }
    thead th { position: sticky; top: 0; background-color: #f8fafc; border-bottom: 2px solid #e2e8f0; padding: 12px 14px; font-size: 11px; font-weight: 800; color: #475569; text-transform: uppercase; letter-spacing: 0.5px; z-index: 10; }
    footer { text-align: center; margin-top: 28px; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 16px; }
    @media print {
      body { background-color: #ffffff; padding: 0; }
      .container { border: none; box-shadow: none; max-width: 100%; }
      .no-print { display: none !important; }
      .table-container { overflow: visible; }
    }
  </style>
</head>

<body>
  <div class="container">
    <div class="action-bar no-print">
      <button class="btn-print" onclick="window.print()">🖨️ Print / Save as PDF</button>
    </div>

    <div class="header">
      <div class="logo-title">
        <div class="badge-logo">S</div>
        <div>
          <div class="title">SEEAKK — Interactive Summary Report</div>
          <div class="subtitle">Company-Wide Performance, Revenue & User Activity Summary Report</div>
        </div>
      </div>
      <div class="meta-box">
        <div><strong>Workspace:</strong> ${workspaceName}</div>
        <div><strong>Generated By:</strong> ${generatedBy}</div>
        <div><strong>Generated At:</strong> ${generatedAt}</div>
      </div>
    </div>

    <div class="filters-bar">
      <div><strong>Period:</strong> ${periodText}</div>
      <div><strong>Applied Filters:</strong> ${filtersText}</div>
      <div><strong>Total Users Included:</strong> ${userStats.length} user(s)</div>
    </div>

    <!-- Summary Cards -->
    <div class="cards-grid">
      <div class="card card-emerald">
        <div class="card-label">Total Revenue Generated</div>
        <div class="card-val">${formatCurrency(totalRevenue)}</div>
      </div>
      <div class="card card-emerald">
        <div class="card-label">Total Leads Created</div>
        <div class="card-val">${totalLeads.toLocaleString()}</div>
      </div>
    </div>

    <!-- User Performance Ranking Table -->
    <h3 style="font-size: 14px; font-weight: 800; color: #0f172a; margin-bottom: 12px;">User Performance Ranking</h3>
    <div class="table-container">
      <table>
        <thead>
          <tr>
            <th style="width: 60px; position: sticky; left: 0; background: #f8fafc; z-index: 11;">Rank</th>
            <th style="position: sticky; left: 60px; background: #f8fafc; z-index: 11;">User</th>
            <th>Role</th>
            <th>Branch</th>
            <th style="text-align: center;">Leads Created</th>
            <th style="text-align: right;">Revenue Generated</th>
          </tr>
        </thead>
        <tbody>
          ${userStats.length === 0 ? `<tr><td colSpan="6" style="text-align: center; padding: 24px; color: #94a3b8;">No matching activity found for the selected filters.</td></tr>` : rowsHtml}
        </tbody>
      </table>
    </div>

    <footer>
      SEEAKK — Dynamic Lead Performance Dynamics Platform • Generated ${generatedAt}
    </footer>
  </div>
</body>
</html>`;
};

/**
 * Generates a standalone Interactive HTML document for Summary Activity Reports.
 */
export const generateSummaryReportHtmlReport = (options: SummaryExportOptions): string => {
  return generateSummaryReportPdfReport(options);
};
