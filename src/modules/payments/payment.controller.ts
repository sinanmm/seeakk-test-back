import { Request, Response, NextFunction } from 'express';
import * as paymentService from './payment.service';

const getActor = (req: Request) => ({
  id: req.user!.id,
  roleId: req.user!.roleId,
});

export const createAdvance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      return res.status(400).json({ success: false, message: 'Workspace ID is missing.' });
    }
    const actor = getActor(req);
    const leadId = req.params.leadId as string;
    
    // File uploaded by multer is in req.file
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Proof image is required and must be under 1MB.' });
    }
    
    const proofUrl = `/uploads/${req.file.filename}`;
    
    // Handle form data which might be strings
    const amount = parseFloat(req.body.amount);
    if (isNaN(amount) || amount <= 0) {
       return res.status(400).json({ success: false, message: 'Amount must be a valid positive number.' });
    }
    const paymentDate = new Date(req.body.paymentDate);
    const remarks = req.body.remarks;

    const data = await paymentService.createAdvance(workspaceId, actor, leadId, {
      amount,
      paymentDate,
      proofUrl,
      remarks
    });

    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const approveAdvance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      return res.status(400).json({ success: false, message: 'Workspace ID is missing.' });
    }
    const actor = getActor(req);
    const leadId = req.params.leadId as string;
    const advanceId = req.params.advanceId as string;
    const { checkNumber } = req.body;
    
    if (!checkNumber) {
      return res.status(400).json({ success: false, message: 'Check Number is required for approval.' });
    }

    const data = await paymentService.approveAdvance(workspaceId, actor, leadId, advanceId, checkNumber);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const rejectAdvance = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      return res.status(400).json({ success: false, message: 'Workspace ID is missing.' });
    }
    const actor = getActor(req);
    const leadId = req.params.leadId as string;
    const advanceId = req.params.advanceId as string;
    const { reason } = req.body;

    const data = await paymentService.rejectAdvance(workspaceId, actor, leadId, advanceId, reason);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getAdvancesByLeadId = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      return res.status(400).json({ success: false, message: 'Workspace ID is missing.' });
    }
    const actor = getActor(req);
    const leadId = req.params.leadId as string;

    const data = await paymentService.getAdvancesByLeadId(workspaceId, actor, leadId);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getAllPendingAdvances = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      return res.status(400).json({ success: false, message: 'Workspace ID is missing.' });
    }
    const actor = getActor(req);

    const data = await paymentService.getAllPendingAdvances(workspaceId, actor);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

export const getPaymentHistory = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const workspaceId = req.user?.workspaceId;
    if (!workspaceId) {
      return res.status(400).json({ success: false, message: 'Workspace ID is missing.' });
    }
    const actor = getActor(req);
    const leadId = req.params.leadId as string;

    const data = await paymentService.getPaymentHistory(workspaceId, actor, leadId);
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
