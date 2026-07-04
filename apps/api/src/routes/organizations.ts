import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@yourstack/db';
import {
  createOrganizationSchema,
  inviteOrgMemberSchema,
  createTeamSchema,
  addTeamMemberSchema,
  grantWorkspaceSchema,
  type OrgRole,
  type TeamRole,
  type WorkspaceRole,
} from '@yourstack/shared';
import { requireUser } from '../lib/auth.js';
import { requireOrgRole, resolveOrgRole } from '../lib/rbac.js';
import { parse } from '../lib/validate.js';
import { Errors } from '../lib/errors.js';
import { slugify } from '../lib/util.js';
import {
  toOrganizationDTO,
  toOrgMemberDTO,
  toTeamDTO,
  toTeamMemberDTO,
  toWorkspaceDTO,
} from '../lib/dto.js';

const ORG_COUNTS = { _count: { select: { workspaces: true, teams: true, members: true } } } as const;

async function uniqueOrgSlug(prisma: PrismaClient, base: string): Promise<string> {
  let slug = base;
  let n = 1;
  while (await prisma.organization.findUnique({ where: { slug } })) slug = `${base}-${n++}`;
  return slug;
}

async function teamOrg(prisma: PrismaClient, teamId: string) {
  const team = await prisma.team.findFirst({ where: { id: teamId, deletedAt: null } });
  if (!team) throw Errors.notFound('Team not found');
  return team;
}

export default async function organizationRoutes(app: FastifyInstance) {
  const { prisma, audit } = app.ctx;

  /* -------------------------------- Organizations ------------------------- */

  app.get('/organizations', async (req) => {
    const user = requireUser(req);
    const memberships = await prisma.orgMember.findMany({
      where: { organization: { deletedAt: null }, userId: user.id },
      include: { organization: { include: ORG_COUNTS } },
      orderBy: { createdAt: 'asc' },
    });
    return {
      organizations: memberships.map((m) => toOrganizationDTO({ ...m.organization, role: m.role })),
    };
  });

  app.post('/organizations', async (req) => {
    const user = requireUser(req);
    const body = parse(createOrganizationSchema, req.body);
    const slug = await uniqueOrgSlug(prisma, body.slug ?? slugify(body.name));
    const org = await prisma.organization.create({
      data: { name: body.name, slug, members: { create: { userId: user.id, role: 'owner' } } },
      include: ORG_COUNTS,
    });
    await audit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'organization.create',
      targetType: 'organization',
      targetId: org.id,
      ip: req.ip,
    });
    return { organization: toOrganizationDTO({ ...org, role: 'owner' }) };
  });

  app.get('/organizations/:id', async (req) => {
    const { id } = req.params as { id: string };
    const role = await resolveOrgRole(prisma, req, id);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id }, include: ORG_COUNTS });
    return { organization: toOrganizationDTO({ ...org, role }) };
  });

  app.get('/organizations/:id/workspaces', async (req) => {
    const { id } = req.params as { id: string };
    const role = await resolveOrgRole(prisma, req, id);
    const workspaces = await prisma.workspace.findMany({
      where: { organizationId: id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    // Org owner/admin see themselves as owner/admin; members fall back to viewer.
    const wsRole: WorkspaceRole = role === 'member' ? 'viewer' : role;
    return { workspaces: workspaces.map((w) => toWorkspaceDTO(w, wsRole)) };
  });

  /* --------------------------------- Org members -------------------------- */

  app.get('/organizations/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    await resolveOrgRole(prisma, req, id);
    const members = await prisma.orgMember.findMany({
      where: { organizationId: id },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return { members: members.map(toOrgMemberDTO) };
  });

  app.post('/organizations/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    await requireOrgRole(prisma, req, id, 'admin');
    const body = parse(inviteOrgMemberSchema, req.body);
    const user = await prisma.user.upsert({
      where: { email: body.email },
      update: {},
      create: { email: body.email, name: body.email.split('@')[0] },
    });
    const existing = await prisma.orgMember.findUnique({
      where: { organizationId_userId: { organizationId: id, userId: user.id } },
    });
    if (existing) throw Errors.conflict('User is already a member of this organization');
    const member = await prisma.orgMember.create({
      data: { organizationId: id, userId: user.id, role: body.role as OrgRole },
      include: { user: true },
    });
    await audit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'organization.member_invite',
      targetType: 'user',
      targetId: user.id,
      metadata: { organizationId: id, role: body.role },
    });
    return { member: toOrgMemberDTO(member) };
  });

  app.patch('/organizations/:id/members/:mid', async (req) => {
    const { id, mid } = req.params as { id: string; mid: string };
    await requireOrgRole(prisma, req, id, 'admin');
    const body = parse(inviteOrgMemberSchema.pick({ role: true }), req.body);
    const member = await prisma.orgMember.findFirst({ where: { id: mid, organizationId: id } });
    if (!member) throw Errors.notFound('Member not found');
    if (member.role === 'owner') throw Errors.badRequest('Cannot change an owner’s role');
    const updated = await prisma.orgMember.update({
      where: { id: mid },
      data: { role: body.role as OrgRole },
      include: { user: true },
    });
    return { member: toOrgMemberDTO(updated) };
  });

  app.delete('/organizations/:id/members/:mid', async (req, reply) => {
    const { id, mid } = req.params as { id: string; mid: string };
    await requireOrgRole(prisma, req, id, 'admin');
    const member = await prisma.orgMember.findFirst({ where: { id: mid, organizationId: id } });
    if (!member) throw Errors.notFound('Member not found');
    if (member.role === 'owner') {
      const owners = await prisma.orgMember.count({ where: { organizationId: id, role: 'owner' } });
      if (owners <= 1) throw Errors.badRequest('An organization must have at least one owner');
    }
    await prisma.orgMember.delete({ where: { id: mid } });
    await audit({
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'organization.member_remove',
      targetType: 'user',
      targetId: member.userId,
      metadata: { organizationId: id },
    });
    reply.status(204).send();
  });

  /* ----------------------------------- Teams ------------------------------ */

  app.get('/organizations/:id/teams', async (req) => {
    const { id } = req.params as { id: string };
    await resolveOrgRole(prisma, req, id);
    const teams = await prisma.team.findMany({
      where: { organizationId: id, deletedAt: null },
      include: { _count: { select: { members: true } }, grants: true },
      orderBy: { createdAt: 'asc' },
    });
    return { teams: teams.map(toTeamDTO) };
  });

  app.post('/organizations/:id/teams', async (req) => {
    const { id } = req.params as { id: string };
    await requireOrgRole(prisma, req, id, 'admin');
    const body = parse(createTeamSchema, req.body);
    const slug = body.slug ?? slugify(body.name);
    const exists = await prisma.team.findUnique({
      where: { organizationId_slug: { organizationId: id, slug } },
    });
    if (exists) throw Errors.conflict('A team with that slug already exists');
    const team = await prisma.team.create({
      data: { organizationId: id, name: body.name, slug },
      include: { _count: { select: { members: true } }, grants: true },
    });
    return { team: toTeamDTO(team) };
  });

  app.get('/teams/:id', async (req) => {
    const { id } = req.params as { id: string };
    const team = await teamOrg(prisma, id);
    await resolveOrgRole(prisma, req, team.organizationId);
    const full = await prisma.team.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { members: true } }, grants: true },
    });
    return { team: toTeamDTO(full) };
  });

  app.delete('/teams/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const team = await teamOrg(prisma, id);
    await requireOrgRole(prisma, req, team.organizationId, 'admin');
    await prisma.team.update({ where: { id }, data: { deletedAt: new Date() } });
    reply.status(204).send();
  });

  /* ------------------------------- Team members --------------------------- */

  app.get('/teams/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    const team = await teamOrg(prisma, id);
    await resolveOrgRole(prisma, req, team.organizationId);
    const members = await prisma.teamMember.findMany({
      where: { teamId: id },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    });
    return { members: members.map(toTeamMemberDTO) };
  });

  app.post('/teams/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    const team = await teamOrg(prisma, id);
    await requireOrgRole(prisma, req, team.organizationId, 'admin');
    const body = parse(addTeamMemberSchema, req.body);
    // The user must already belong to the organization.
    const orgMember = await prisma.orgMember.findUnique({
      where: { organizationId_userId: { organizationId: team.organizationId, userId: body.userId } },
    });
    if (!orgMember) throw Errors.badRequest('User must be a member of the organization first');
    const existing = await prisma.teamMember.findUnique({
      where: { teamId_userId: { teamId: id, userId: body.userId } },
    });
    if (existing) throw Errors.conflict('User is already on this team');
    const member = await prisma.teamMember.create({
      data: { teamId: id, userId: body.userId, role: body.role as TeamRole },
      include: { user: true },
    });
    return { member: toTeamMemberDTO(member) };
  });

  app.delete('/teams/:id/members/:uid', async (req, reply) => {
    const { id, uid } = req.params as { id: string; uid: string };
    const team = await teamOrg(prisma, id);
    await requireOrgRole(prisma, req, team.organizationId, 'admin');
    await prisma.teamMember.deleteMany({ where: { teamId: id, userId: uid } });
    reply.status(204).send();
  });

  /* ------------------------------- Workspace grants ----------------------- */

  app.post('/teams/:id/grants', async (req) => {
    const { id } = req.params as { id: string };
    const team = await teamOrg(prisma, id);
    await requireOrgRole(prisma, req, team.organizationId, 'admin');
    const body = parse(grantWorkspaceSchema.omit({ teamId: true }), req.body);
    const workspace = await prisma.workspace.findFirst({
      where: { id: body.workspaceId, deletedAt: null },
      select: { id: true, organizationId: true },
    });
    if (!workspace) throw Errors.notFound('Workspace not found');
    if (workspace.organizationId !== team.organizationId) {
      throw Errors.badRequest('Workspace does not belong to this team’s organization');
    }
    const grant = await prisma.workspaceGrant.upsert({
      where: { teamId_workspaceId: { teamId: id, workspaceId: body.workspaceId } },
      create: { teamId: id, workspaceId: body.workspaceId, role: body.role as WorkspaceRole },
      update: { role: body.role as WorkspaceRole },
    });
    await audit({
      workspaceId: body.workspaceId,
      actorId: req.user!.id,
      actorEmail: req.user!.email,
      action: 'team.grant_workspace',
      targetType: 'team',
      targetId: id,
      metadata: { workspaceId: body.workspaceId, role: body.role },
    });
    return { grant: { workspaceId: grant.workspaceId, role: grant.role } };
  });

  app.delete('/teams/:id/grants/:workspaceId', async (req, reply) => {
    const { id, workspaceId } = req.params as { id: string; workspaceId: string };
    const team = await teamOrg(prisma, id);
    await requireOrgRole(prisma, req, team.organizationId, 'admin');
    await prisma.workspaceGrant.deleteMany({ where: { teamId: id, workspaceId } });
    reply.status(204).send();
  });
}
