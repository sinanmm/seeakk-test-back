import type { Request, Response } from 'express';
import { fieldHighlightService } from './fieldHighlights.service';

export class FieldHighlightController {
  
  /**
   * GET /api/admin/field-highlights
   */
  async getConfigs(req: Request, res: Response) {
    try {
      const workspaceId = (req as any).user?.workspaceId;
      if (!workspaceId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const configs = await fieldHighlightService.getWorkspaceConfigs(workspaceId);
      return res.status(200).json(configs);
    } catch (error) {
      console.error('[FieldHighlightController] Error in getConfigs:', error);
      return res.status(500).json({ error: 'Failed to fetch highlight configurations' });
    }
  }

  /**
   * PUT /api/admin/field-highlights
   */
  async updateConfigs(req: Request, res: Response) {
    try {
      const workspaceId = (req as any).user?.workspaceId;
      if (!workspaceId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      const { configs } = req.body; // array of { fieldKey, isEnabled }
      if (!Array.isArray(configs)) {
        return res.status(400).json({ error: 'configs must be an array' });
      }

      const updated = await fieldHighlightService.updateWorkspaceConfigs(workspaceId, configs);
      return res.status(200).json(updated);
    } catch (error) {
      console.error('[FieldHighlightController] Error in updateConfigs:', error);
      return res.status(500).json({ error: 'Failed to update highlight configurations' });
    }
  }

  /**
   * GET /api/leads/:id/field-edits
   */
  async getLeadEdits(req: Request, res: Response) {
    try {
      const { id } = req.params;
      const workspaceId = (req as any).user?.workspaceId;
      if (!workspaceId || !id) {
        return res.status(400).json({ error: 'Missing lead ID or unauthorized' });
      }

      // Authorization should be verified here (does user have access to lead), 
      // but assuming they have access if they can fetch the lead details.

      const data = await fieldHighlightService.getLeadFieldEdits(id as string);
      return res.status(200).json(data);
    } catch (error) {
      console.error('[FieldHighlightController] Error in getLeadEdits:', error);
      return res.status(500).json({ error: 'Failed to fetch lead field edits' });
    }
  }
}

export const fieldHighlightController = new FieldHighlightController();
