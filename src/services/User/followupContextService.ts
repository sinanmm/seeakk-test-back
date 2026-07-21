import prisma from '../../config/prisma';

export const getLeadFollowupContext = async (leadId: string, workspaceId: string) => {
  if (!leadId) throw new Error('Lead ID is required');

  // Fetch the latest Lead Remark
  let leadRemarks: string | null = null;
  const latestRemark = await prisma.leadRemark.findFirst({
    where: { leadId, workspaceId },
    orderBy: { createdAt: 'desc' },
    select: { text: true },
  });

  if (latestRemark?.text) {
    leadRemarks = latestRemark.text;
  } else {
    // Fallback to lead.remarks if no LeadRemark entries exist
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { remarks: true },
    });
    leadRemarks = lead?.remarks || null;
  }

  // Fetch the Last Completed Follow-up
  const lastFollowup = await prisma.followUp.findFirst({
    where: { 
      leadId, 
      workspaceId,
      status: 'COMPLETED',
    },
    orderBy: { completedAt: 'desc' },
    include: {
      user: {
        select: { name: true },
      },
    },
  });

  let lastCompletedFollowup = null;
  if (lastFollowup && lastFollowup.completedAt) {
    lastCompletedFollowup = {
      note: lastFollowup.completionDescription || lastFollowup.description || 'No note provided',
      completedBy: lastFollowup.user?.name || 'Unknown',
      completedAt: lastFollowup.completedAt.toISOString(),
    };
  }

  return {
    leadRemarks,
    lastCompletedFollowup,
  };
};
