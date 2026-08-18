import { z } from 'zod';

export const whatsappTemplateCategoryEnum = z.enum([
  'Follow-up',
  'Meeting',
  'Quotation',
  'Payment',
  'New Enquiry',
  'Thank You',
  'General',
  'Custom',
]);

export const createWhatsAppTemplateSchema = z.object({
  name: z.string().trim().min(1, 'Template Name is required').max(100, 'Name is too long'),
  category: whatsappTemplateCategoryEnum,
  message: z.string().trim().min(1, 'Message is required').max(1000, 'Message cannot exceed 1000 characters'),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional().default('ACTIVE'),
});

export type CreateWhatsAppTemplateInput = z.infer<typeof createWhatsAppTemplateSchema>;

export const updateWhatsAppTemplateSchema = createWhatsAppTemplateSchema.partial();
export type UpdateWhatsAppTemplateInput = z.infer<typeof updateWhatsAppTemplateSchema>;
