export const ALLOWED_TEMPLATE_VARIABLES = [
  'lead_name',
  'mobile',
  'assigned_user',
  'company_name',
  'followup_date',
  'followup_time',
  'lead_stage',
] as const;

export type TemplateVariable = (typeof ALLOWED_TEMPLATE_VARIABLES)[number];

export interface WhatsAppTemplateContext {
  leadName?: string | null;
  mobile?: string | null;
  assignedUser?: string | null;
  companyName?: string | null;
  followupDate?: string | null;
  followupTime?: string | null;
  leadStage?: string | null;
}

export const renderWhatsAppTemplate = (
  templateText: string | null | undefined,
  context: WhatsAppTemplateContext
): string => {
  if (!templateText) return '';

  return templateText.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, varName) => {
    switch (varName) {
      case 'lead_name':
        return context.leadName || '';
      case 'mobile':
        return context.mobile || '';
      case 'assigned_user':
        return context.assignedUser || '';
      case 'company_name':
        return context.companyName || '';
      case 'followup_date':
        return context.followupDate || '';
      case 'followup_time':
        return context.followupTime || '';
      case 'lead_stage':
        return context.leadStage || '';
      default:
        return match;
    }
  });
};

export const validateTemplateVariables = (message: string): { valid: boolean; invalidVars: string[] } => {
  const matches = message.match(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g) || [];
  const invalidVars: string[] = [];

  for (const match of matches) {
    const varName = match.replace(/[\{\}\s]/g, '');
    if (!ALLOWED_TEMPLATE_VARIABLES.includes(varName as TemplateVariable)) {
      if (!invalidVars.includes(varName)) {
        invalidVars.push(varName);
      }
    }
  }

  return {
    valid: invalidVars.length === 0,
    invalidVars,
  };
};
