import bcrypt from 'bcryptjs';
import logger from '../../utils/logger';
import auditService from '../../services/Audit/auditService';
import { buildInviteAcceptUrl } from './inviteLinks';
import { sendInvitationEmail } from '../../services/Email/emailService';
import { createInviteTokenPair, hashInviteToken } from '../../utils/inviteToken';
import { InviteError } from './invite.errors';
import { toInviteEligibilityUser, userHasActivatedAccount } from './inviteEligibility';
import * as repository from './invite.repository';
import type { AcceptInviteInput, CreateInviteInput, ValidateInviteQueryInput } from './invite.validation';

type Actor = {
  id: string;
  workspaceId?: string | null;
  name?: string | null;
};

type InviteServiceDependencies = {
  repository: typeof repository;
  tokenFactory: typeof createInviteTokenPair;
  hashToken: typeof hashInviteToken;
  sendInvitationEmail: typeof sendInvitationEmail;
  hashPassword: typeof bcrypt.hash;
  audit: typeof auditService;
  now: () => Date;
};

const INVITE_TTL_MS = 24 * 60 * 60 * 1000;

const buildExpiryDate = (now: Date): Date => new Date(now.getTime() + INVITE_TTL_MS);

type InviteActionContext = {
  ipAddress?: string;
  userAgent?: string;
  preferredFrontendOrigin?: string | null;
};

const buildInviteLink = (token: string, context?: InviteActionContext): string =>
  buildInviteAcceptUrl(token, context?.preferredFrontendOrigin);

const INVITE_CREATED_MANUAL_MESSAGE =
  'Invite created, but email delivery is unavailable. Share the invite link manually.';
const INVITE_RESENT_MANUAL_MESSAGE =
  'Invite refreshed, but email delivery is unavailable. Share the invite link manually.';
const EXISTING_INVITE_MANUAL_MESSAGE =
  'An active invite already existed. We refreshed it, but email delivery is unavailable. Share the invite link manually.';

const ACCESS_LINK_CLIPBOARD_MESSAGE = 'Access link generated.';
const ACCESS_LINK_EMAIL_SENT_MESSAGE = 'Access link ready. Invitation email sent.';

const toResponseUser = (user: any) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  workspaceId: user.workspaceId,
  role: user.role
    ? {
        id: user.role.id,
        name: user.role.name,
      }
    : null,
});

export const createInviteService = (deps: InviteServiceDependencies) => {
  const assertWorkspace = async (workspaceId: string) => {
    const workspace = await deps.repository.findWorkspaceById(workspaceId);
    if (!workspace) {
      throw new InviteError('Workspace not found for invite creation.', 404, 'WORKSPACE_NOT_FOUND');
    }
    return workspace;
  };

  const resolveRoleId = async (value: string | undefined, workspaceId: string) => {
    if (!value) return null;
    const role = await deps.repository.findRoleByIdOrName(value, workspaceId);
    if (!role) {
      throw new InviteError('Role not found in this workspace.', 400, 'ROLE_NOT_FOUND');
    }
    return role.id;
  };

  const resolveDepartmentId = async (value: string | undefined, workspaceId: string) => {
    if (!value) return null;
    const department = await deps.repository.findDepartmentByIdOrName(value, workspaceId);
    if (!department) {
      throw new InviteError('Department not found in this workspace.', 400, 'DEPARTMENT_NOT_FOUND');
    }
    return department.id;
  };

  const assertOffice = async (officeId: string | undefined, workspaceId: string) => {
    if (!officeId) return null;
    const office = await deps.repository.findOfficeById(officeId, workspaceId);
    if (!office) {
      throw new InviteError('Active office not found in this workspace.', 400, 'OFFICE_NOT_FOUND');
    }
    return office.id;
  };

  const assertSupervisor = async (supervisorId: string | undefined, workspaceId: string) => {
    if (!supervisorId) return null;
    const supervisor = await deps.repository.findSupervisorById(supervisorId, workspaceId);
    if (!supervisor) {
      throw new InviteError('Supervisor not found in this workspace.', 400, 'SUPERVISOR_NOT_FOUND');
    }
    return supervisor.id;
  };

  const getValidatedInvite = async (rawToken: string) => {
    const tokenHash = deps.hashToken(rawToken);
    const invite = await deps.repository.findInviteByTokenHash(tokenHash);

    if (!invite || !invite.user) {
      throw new InviteError('Invite token is invalid.', 404, 'INVITE_NOT_FOUND');
    }

    const now = deps.now();
    if (invite.usedAt) {
      throw new InviteError('Invite token has already been used.', 409, 'INVITE_ALREADY_USED');
    }

    if (invite.expiresAt <= now) {
      throw new InviteError('Invite token has expired.', 410, 'INVITE_EXPIRED');
    }

    if (!invite.user.workspaceId || invite.user.workspaceId !== invite.workspaceId) {
      throw new InviteError('Invite token is not valid for this workspace.', 409, 'INVITE_WORKSPACE_MISMATCH');
    }

    const invitee = toInviteEligibilityUser(invite.user);
    if (userHasActivatedAccount(invitee)) {
      throw new InviteError('This invitation has already been accepted.', 409, 'INVITE_ALREADY_USED');
    }

    return invite;
  };

  const buildMailIconInvitePayload = async (input: {
    user: any;
    workspace: { companyName: string };
    actor: Actor;
    context?: InviteActionContext;
    rawToken: string;
    expiresAt: Date;
    invite: { id: string; createdAt: Date };
    auditAction: string;
    auditEntityId: string;
    auditDetails: Record<string, unknown>;
  }) => {
    const inviteLink = buildInviteLink(input.rawToken, input.context);
    const { emailDelivered, deliveryErrorMessage } = await sendInvitationBestEffort(input.user.email, {
      recipientName: input.user.name || input.user.email,
      workspaceName: input.workspace.companyName,
      inviterName: input.actor.name || input.actor.id,
      inviteToken: input.rawToken,
      expiresAt: input.expiresAt,
    });

    await deps.audit.log({
      userId: input.actor.id,
      workspaceId: input.user.workspaceId,
      action: input.auditAction,
      entityType: 'Invite',
      entityId: input.auditEntityId,
      details: {
        ...input.auditDetails,
        emailDelivered,
        delivery: emailDelivered ? 'EMAIL' : 'CLIPBOARD',
      },
      ipAddress: input.context?.ipAddress,
      userAgent: input.context?.userAgent,
    });

    return {
      message: emailDelivered ? ACCESS_LINK_EMAIL_SENT_MESSAGE : ACCESS_LINK_CLIPBOARD_MESSAGE,
      invite: {
        id: input.invite.id,
        status: 'PENDING',
        expiresAt: input.expiresAt.toISOString(),
        createdAt: input.invite.createdAt.toISOString(),
      },
      user: toResponseUser(input.user),
      delivery: emailDelivered ? 'EMAIL' : 'CLIPBOARD',
      deliveryErrorMessage,
      inviteLink,
    };
  };

  const sendInvitationBestEffort = async (
    email: string,
    input: {
      recipientName: string;
      workspaceName: string;
      inviterName?: string | null;
      inviteToken: string;
      expiresAt: Date;
    },
  ): Promise<{ emailDelivered: boolean; deliveryErrorMessage: string | null }> => {
    try {
      console.log(`[InviteService] Dispatching invitation email to: ${email}`);
      const delivered = await deps.sendInvitationEmail(email, input);
      console.log(`[InviteService] Email dispatch result for ${email}: ${delivered}`);
      return {
        emailDelivered: delivered === true,
        deliveryErrorMessage: null,
      };
    } catch (error: any) {
      logger.warn('Invitation email failed', {
        module: 'invites',
        email,
        error: error?.message || String(error),
      });
      return {
        emailDelivered: false,
        deliveryErrorMessage:
          error?.message || 'Failed to deliver invitation email. Please verify SMTP configuration.',
      };
    }
  };

  return {
    async createInvite(input: CreateInviteInput, actor: Actor, context?: InviteActionContext) {
      const workspaceId = actor.workspaceId?.trim();
      if (!workspaceId) {
        throw new InviteError('Inviting users requires an authenticated workspace context.', 403, 'WORKSPACE_REQUIRED');
      }

      const workspace = await assertWorkspace(workspaceId);

      const existingEmail = await deps.repository.findUserByEmail(input.email);
      const canRestoreSoftDeletedByEmail = Boolean(existingEmail && existingEmail.deletedAt);
      if (existingEmail && !canRestoreSoftDeletedByEmail) {
        throw new InviteError('A user with this email already exists.', 409, 'EMAIL_ALREADY_EXISTS');
      }

      if (input.username) {
        const existingUsername = await deps.repository.findUserByUsername(input.username);
        if (existingUsername) {
          throw new InviteError('This username is already taken.', 409, 'USERNAME_ALREADY_EXISTS');
        }
      }

      const [roleId, departmentId, officeId, supervisorId] = await Promise.all([
        resolveRoleId(input.roleId, workspaceId),
        resolveDepartmentId(input.departmentId, workspaceId),
        assertOffice(input.officeId, workspaceId),
        assertSupervisor(input.supervisorId, workspaceId),
      ]);

      const { rawToken, tokenHash } = deps.tokenFactory();
      const now = deps.now();
      const expiresAt = buildExpiryDate(now);

      const result = await deps.repository.createInvitedUserWithInvite({
        workspaceId,
        createdBy: actor.id,
        tokenHash,
        expiresAt,
        restoreUserId: canRestoreSoftDeletedByEmail ? existingEmail?.id : null,
        userData: {
          name: input.name,
          username: input.username ?? null,
          email: input.email,
          phone: input.phone ?? null,
          roleId,
          departmentId,
          supervisorId,
          officeId,
          countryId: input.countryId ?? null,
          stateId: input.stateId ?? null,
          districtId: input.districtId ?? null,
          assignedLocationIds: input.assignedLocationIds,
        },
      });

      const { emailDelivered, deliveryErrorMessage } = await sendInvitationBestEffort(result.user.email, {
        recipientName: result.user.name || result.user.email,
        workspaceName: workspace.companyName,
        inviterName: actor.name || actor.id,
        inviteToken: rawToken,
        expiresAt,
      });

      await deps.audit.log({
        userId: actor.id,
        workspaceId,
        action: 'USER_INVITE_CREATED',
        entityType: 'Invite',
        entityId: result.invite.id,
        details: {
          inviteeUserId: result.user.id,
          inviteeEmail: result.user.email,
          expiresAt: expiresAt.toISOString(),
        },
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      return {
        message: emailDelivered
          ? 'Invitation email sent successfully.'
          : INVITE_CREATED_MANUAL_MESSAGE,
        invite: {
          id: result.invite.id,
          email: result.user.email,
          expiresAt: result.invite.expiresAt.toISOString(),
          createdAt: result.invite.createdAt.toISOString(),
        },
        user: toResponseUser(result.user),
        delivery: emailDelivered ? 'EMAIL' : 'MANUAL',
        deliveryErrorMessage,
        inviteLink: buildInviteLink(rawToken, context),
      };
    },

    async validateInvite(query: ValidateInviteQueryInput) {
      const invite = await getValidatedInvite(query.token);

      return {
        valid: true,
        invite: {
          email: invite.user.email,
          expiresAt: invite.expiresAt.toISOString(),
          workspace: invite.user.workspace
            ? {
                id: invite.user.workspace.id,
                companyName: invite.user.workspace.companyName,
              }
            : null,
          role: invite.user.role
            ? {
                id: invite.user.role.id,
                name: invite.user.role.name,
              }
            : null,
          user: {
            id: invite.user.id,
            name: invite.user.name,
          },
        },
      };
    },

    async acceptInvite(input: AcceptInviteInput, context?: InviteActionContext) {
      const invite = await getValidatedInvite(input.token);
      const passwordHash = await deps.hashPassword(input.password, 12);
      const acceptedAt = deps.now();

      const user = await deps.repository.acceptInvite({
        inviteId: invite.id,
        userId: invite.user.id,
        passwordHash,
        acceptedAt,
      });

      if (!user) {
        throw new InviteError('Invite token has already been used or expired.', 409, 'INVITE_ALREADY_CONSUMED');
      }

      await deps.audit.log({
        userId: user.id,
        workspaceId: user.workspaceId || undefined,
        action: 'USER_INVITE_ACCEPTED',
        entityType: 'Invite',
        entityId: invite.id,
        details: {
          acceptedAt: acceptedAt.toISOString(),
        },
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      return {
        message: 'Invitation accepted successfully.',
        user: toResponseUser(user),
      };
    },

    async resendInvite(inviteId: string, actor: Actor, context?: InviteActionContext) {
      const workspaceId = actor.workspaceId?.trim();
      if (!workspaceId) throw new InviteError('Workspace context required.', 403, 'WORKSPACE_REQUIRED');
      const workspace = await assertWorkspace(workspaceId);

      const invite = await deps.repository.findInviteById(inviteId, workspaceId);
      if (!invite || invite.workspaceId !== workspaceId) {
        throw new InviteError('Invite not found.', 404, 'INVITE_NOT_FOUND');
      }

      if (invite.usedAt) throw new InviteError('Cannot resend an already consumed invite.', 409, 'INVITE_ALREADY_USED');

      const inviteUser = await deps.repository.reprovisionUserForInvite(invite.user.id);
      const { rawToken, tokenHash } = deps.tokenFactory();
      const now = deps.now();
      const expiresAt = buildExpiryDate(now);

      await deps.repository.updateInviteForResend(inviteId, tokenHash, expiresAt);

      return buildMailIconInvitePayload({
        user: inviteUser,
        workspace,
        actor,
        context,
        rawToken,
        expiresAt,
        invite: { id: inviteId, createdAt: invite.createdAt },
        auditAction: 'USER_INVITE_LINK_REFRESHED',
        auditEntityId: inviteId,
        auditDetails: {
          inviteeUserId: inviteUser.id,
          inviteeEmail: inviteUser.email,
          expiresAt: expiresAt.toISOString(),
        },
      });
    },

    async revokeInvite(inviteId: string, actor: Actor, context?: InviteActionContext) {
      const workspaceId = actor.workspaceId?.trim();
      if (!workspaceId) throw new InviteError('Workspace context required.', 403, 'WORKSPACE_REQUIRED');

      const invite = await deps.repository.findInviteById(inviteId, workspaceId);
      if (!invite || invite.workspaceId !== workspaceId) {
        throw new InviteError('Invite not found.', 404, 'INVITE_NOT_FOUND');
      }

      if (invite.usedAt) throw new InviteError('Cannot revoke an already consumed invite.', 409, 'INVITE_ALREADY_USED');

      const now = deps.now();
      await deps.repository.updateInviteForRevoke(inviteId, now);

      await deps.audit.log({
        userId: actor.id,
        workspaceId,
        action: 'USER_INVITE_REVOKED',
        entityType: 'Invite',
        entityId: inviteId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });

      return { message: 'Invite revoked successfully.' };
    },

    async sendInviteToUser(userId: string, actor: Actor, context?: InviteActionContext) {
      const workspaceId = actor.workspaceId?.trim();
      if (!workspaceId) throw new InviteError('Workspace context required.', 403, 'WORKSPACE_REQUIRED');

      const workspace = await assertWorkspace(workspaceId);

      let user = await deps.repository.findInvitableUserById(userId, workspaceId);
      if (!user) {
        throw new InviteError('User not found in this workspace.', 404, 'USER_NOT_FOUND');
      }

      if (!user.workspaceId || user.workspaceId !== workspaceId) {
        throw new InviteError('User workspace mismatch. Cannot send invite.', 409, 'USER_WORKSPACE_MISMATCH');
      }

      // Refresh credentials so the link always opens password setup (never blocked as "already active").
      user = await deps.repository.reprovisionUserForInvite(user.id);

      const now = deps.now();
      const latestInvite = await deps.repository.findLatestInviteForUser(user.id, workspaceId);
      const latestStatus = latestInvite ? computeInviteStatus(latestInvite, now) : null;

      const { rawToken, tokenHash } = deps.tokenFactory();
      const expiresAt = buildExpiryDate(now);

      if (latestStatus === 'PENDING' && latestInvite?.id) {
        await deps.repository.updateInviteForResend(latestInvite.id, tokenHash, expiresAt);

        return buildMailIconInvitePayload({
          user,
          workspace,
          actor,
          context,
          rawToken,
          expiresAt,
          invite: { id: latestInvite.id, createdAt: latestInvite.createdAt },
          auditAction: 'USER_INVITE_LINK_REFRESHED',
          auditEntityId: latestInvite.id,
          auditDetails: {
            inviteeUserId: user.id,
            inviteeEmail: user.email,
            expiresAt: expiresAt.toISOString(),
          },
        });
      }

      const invite = await deps.repository.createInviteForUser({
        userId: user.id,
        workspaceId,
        tokenHash,
        expiresAt,
        createdBy: actor.id,
      });

      return buildMailIconInvitePayload({
        user,
        workspace,
        actor,
        context,
        rawToken,
        expiresAt,
        invite: { id: invite.id, createdAt: invite.createdAt },
        auditAction: 'USER_INVITE_LINK_CREATED',
        auditEntityId: invite.id,
        auditDetails: {
          inviteeUserId: user.id,
          inviteeEmail: user.email,
          expiresAt: expiresAt.toISOString(),
        },
      });
    },
  };
};

export const computeInviteStatus = (invite: any, now: Date) => {
  if (invite.usedAt) return 'ACCEPTED';
  if (invite.expiresAt <= now) return 'EXPIRED';
  return 'PENDING';
};

export const inviteService = createInviteService({
  repository,
  tokenFactory: createInviteTokenPair,
  hashToken: hashInviteToken,
  sendInvitationEmail,
  hashPassword: bcrypt.hash,
  audit: auditService,
  now: () => new Date(),
});
