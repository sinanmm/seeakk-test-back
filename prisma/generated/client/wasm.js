
Object.defineProperty(exports, "__esModule", { value: true });

const {
  PrismaClientKnownRequestError,
  PrismaClientUnknownRequestError,
  PrismaClientRustPanicError,
  PrismaClientInitializationError,
  PrismaClientValidationError,
  NotFoundError,
  getPrismaClient,
  sqltag,
  empty,
  join,
  raw,
  skip,
  Decimal,
  Debug,
  objectEnumValues,
  makeStrictEnum,
  Extensions,
  warnOnce,
  defineDmmfProperty,
  Public,
  getRuntime
} = require('./runtime/wasm.js')


const Prisma = {}

exports.Prisma = Prisma
exports.$Enums = {}

/**
 * Prisma Client JS version: 5.22.0
 * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
 */
Prisma.prismaVersion = {
  client: "5.22.0",
  engine: "605197351a3c8bdd595af2d2a9bc3025bca48ea2"
}

Prisma.PrismaClientKnownRequestError = PrismaClientKnownRequestError;
Prisma.PrismaClientUnknownRequestError = PrismaClientUnknownRequestError
Prisma.PrismaClientRustPanicError = PrismaClientRustPanicError
Prisma.PrismaClientInitializationError = PrismaClientInitializationError
Prisma.PrismaClientValidationError = PrismaClientValidationError
Prisma.NotFoundError = NotFoundError
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = sqltag
Prisma.empty = empty
Prisma.join = join
Prisma.raw = raw
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = Extensions.getExtensionContext
Prisma.defineExtension = Extensions.defineExtension

/**
 * Shorthand utilities for JSON filtering
 */
Prisma.DbNull = objectEnumValues.instances.DbNull
Prisma.JsonNull = objectEnumValues.instances.JsonNull
Prisma.AnyNull = objectEnumValues.instances.AnyNull

Prisma.NullTypes = {
  DbNull: objectEnumValues.classes.DbNull,
  JsonNull: objectEnumValues.classes.JsonNull,
  AnyNull: objectEnumValues.classes.AnyNull
}





/**
 * Enums
 */
exports.Prisma.TransactionIsolationLevel = makeStrictEnum({
  ReadUncommitted: 'ReadUncommitted',
  ReadCommitted: 'ReadCommitted',
  RepeatableRead: 'RepeatableRead',
  Serializable: 'Serializable'
});

exports.Prisma.RoleScalarFieldEnum = {
  id: 'id',
  name: 'name',
  status: 'status',
  description: 'description',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.PermissionScalarFieldEnum = {
  id: 'id',
  key: 'key',
  group: 'group',
  description: 'description',
  createdAt: 'createdAt'
};

exports.Prisma.RolePermissionScalarFieldEnum = {
  roleId: 'roleId',
  permissionId: 'permissionId'
};

exports.Prisma.WorkspaceScalarFieldEnum = {
  id: 'id',
  companyName: 'companyName',
  employeeCount: 'employeeCount',
  timeZone: 'timeZone',
  language: 'language',
  currencyLocale: 'currencyLocale',
  loadSampleData: 'loadSampleData',
  ownerId: 'ownerId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.DepartmentScalarFieldEnum = {
  id: 'id',
  name: 'name',
  description: 'description',
  status: 'status',
  workspaceId: 'workspaceId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.LeadSourceScalarFieldEnum = {
  id: 'id',
  name: 'name',
  status: 'status',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.LeadStageScalarFieldEnum = {
  id: 'id',
  name: 'name',
  color: 'color',
  isApprovalRequired: 'isApprovalRequired',
  isLOB: 'isLOB',
  isClosed: 'isClosed',
  order: 'order',
  status: 'status',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.StageRuleScalarFieldEnum = {
  id: 'id',
  name: 'name',
  inputType: 'inputType',
  sortOrder: 'sortOrder',
  required: 'required',
  legacyField: 'legacyField',
  legacyCondition: 'legacyCondition',
  legacyValue: 'legacyValue',
  legacyIsMandatory: 'legacyIsMandatory',
  status: 'status',
  stageId: 'stageId',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.LeadStageInputScalarFieldEnum = {
  id: 'id',
  leadId: 'leadId',
  ruleId: 'ruleId',
  value: 'value',
  createdAt: 'createdAt'
};

exports.Prisma.OfficeScalarFieldEnum = {
  id: 'id',
  name: 'name',
  address: 'address',
  countryId: 'countryId',
  stateId: 'stateId',
  districtId: 'districtId',
  isActive: 'isActive',
  createdBy: 'createdBy',
  workspaceId: 'workspaceId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.CountryScalarFieldEnum = {
  id: 'id',
  workspaceId: 'workspaceId',
  name: 'name',
  code: 'code',
  isActive: 'isActive',
  createdById: 'createdById',
  updatedById: 'updatedById',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.LocationLevelScalarFieldEnum = {
  id: 'id',
  workspaceId: 'workspaceId',
  countryId: 'countryId',
  levelName: 'levelName',
  levelOrder: 'levelOrder',
  isActive: 'isActive',
  createdById: 'createdById',
  updatedById: 'updatedById',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LocationScalarFieldEnum = {
  id: 'id',
  name: 'name',
  type: 'type',
  workspaceId: 'workspaceId',
  countryId: 'countryId',
  levelId: 'levelId',
  isActive: 'isActive',
  createdById: 'createdById',
  updatedById: 'updatedById',
  deletedAt: 'deletedAt',
  parentId: 'parentId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.UserLocationAssignmentScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  locationId: 'locationId',
  workspaceId: 'workspaceId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TargetTypeScalarFieldEnum = {
  id: 'id',
  name: 'name',
  description: 'description',
  workspaceId: 'workspaceId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TargetCycleScalarFieldEnum = {
  id: 'id',
  name: 'name',
  workspaceId: 'workspaceId',
  totalDays: 'totalDays',
  status: 'status',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.TargetCycleRangeScalarFieldEnum = {
  id: 'id',
  targetCycleId: 'targetCycleId',
  startDay: 'startDay',
  endDay: 'endDay',
  createdAt: 'createdAt'
};

exports.Prisma.LeadLifeCycleScalarFieldEnum = {
  id: 'id',
  name: 'name',
  isDefault: 'isDefault',
  workspaceId: 'workspaceId',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LeadScalarFieldEnum = {
  id: 'id',
  name: 'name',
  email: 'email',
  phone: 'phone',
  expectedRevenue: 'expectedRevenue',
  generatedRevenue: 'generatedRevenue',
  assignedToId: 'assignedToId',
  stageId: 'stageId',
  lifecycleId: 'lifecycleId',
  sourceId: 'sourceId',
  nextFollowUpAt: 'nextFollowUpAt',
  stageEnteredAt: 'stageEnteredAt',
  stageExpiresAt: 'stageExpiresAt',
  slaAction: 'slaAction',
  slaWarningDays: 'slaWarningDays',
  approvalState: 'approvalState',
  pendingApprovalToStageId: 'pendingApprovalToStageId',
  pendingApprovalRequestedAt: 'pendingApprovalRequestedAt',
  isClosed: 'isClosed',
  isLOB: 'isLOB',
  closedAt: 'closedAt',
  closedById: 'closedById',
  closureType: 'closureType',
  workspaceId: 'workspaceId',
  createdById: 'createdById',
  deletedAt: 'deletedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LeadLOBLogScalarFieldEnum = {
  id: 'id',
  leadId: 'leadId',
  reasonId: 'reasonId',
  remarks: 'remarks',
  changedById: 'changedById',
  changedAt: 'changedAt',
  workspaceId: 'workspaceId'
};

exports.Prisma.LOBReasonScalarFieldEnum = {
  id: 'id',
  workspaceId: 'workspaceId',
  name: 'name',
  status: 'status',
  createdById: 'createdById',
  updatedById: 'updatedById',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.LeadStageApprovalScalarFieldEnum = {
  id: 'id',
  workspaceId: 'workspaceId',
  leadId: 'leadId',
  fromStageId: 'fromStageId',
  toStageId: 'toStageId',
  requestedById: 'requestedById',
  assignedToId: 'assignedToId',
  status: 'status',
  comment: 'comment',
  requestData: 'requestData',
  approvedById: 'approvedById',
  approvedAt: 'approvedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LeadLifeCycleTransitionScalarFieldEnum = {
  id: 'id',
  lifecycleId: 'lifecycleId',
  fromStageId: 'fromStageId',
  toStageId: 'toStageId',
  numberOfDays: 'numberOfDays',
  expiryAction: 'expiryAction',
  warningDays: 'warningDays',
  sortOrder: 'sortOrder',
  workspaceId: 'workspaceId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LeadDynamicFieldScalarFieldEnum = {
  id: 'id',
  name: 'name',
  inputType: 'inputType',
  sortOrder: 'sortOrder',
  isRequired: 'isRequired',
  isActive: 'isActive',
  workspaceId: 'workspaceId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.LeadDynamicOptionScalarFieldEnum = {
  id: 'id',
  fieldId: 'fieldId',
  value: 'value',
  sortOrder: 'sortOrder'
};

exports.Prisma.LeadDynamicValueScalarFieldEnum = {
  id: 'id',
  leadId: 'leadId',
  fieldId: 'fieldId',
  value: 'value',
  createdAt: 'createdAt'
};

exports.Prisma.LeadActivityScalarFieldEnum = {
  id: 'id',
  leadId: 'leadId',
  performedById: 'performedById',
  workspaceId: 'workspaceId',
  action: 'action',
  metadata: 'metadata',
  createdAt: 'createdAt'
};

exports.Prisma.TargetSettingScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  targetTypeId: 'targetTypeId',
  cycle: 'cycle',
  targetCycleId: 'targetCycleId',
  monthlyTargetLeads: 'monthlyTargetLeads',
  dailyFollowupTarget: 'dailyFollowupTarget',
  revenueTarget: 'revenueTarget',
  startDate: 'startDate',
  endDate: 'endDate',
  workspaceId: 'workspaceId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.TargetViolationScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  date: 'date',
  type: 'type',
  attemptCount: 'attemptCount',
  status: 'status',
  message: 'message',
  workspaceId: 'workspaceId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.UserScalarFieldEnum = {
  id: 'id',
  name: 'name',
  username: 'username',
  email: 'email',
  password: 'password',
  phone: 'phone',
  googleId: 'googleId',
  isOnboarded: 'isOnboarded',
  isActive: 'isActive',
  isEmailVerified: 'isEmailVerified',
  isLocked: 'isLocked',
  verificationToken: 'verificationToken',
  verificationTokenExpires: 'verificationTokenExpires',
  invitationToken: 'invitationToken',
  invitationExpires: 'invitationExpires',
  deletedAt: 'deletedAt',
  roleId: 'roleId',
  workspaceId: 'workspaceId',
  departmentId: 'departmentId',
  officeId: 'officeId',
  countryId: 'countryId',
  stateId: 'stateId',
  districtId: 'districtId',
  supervisorId: 'supervisorId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.FollowUpScalarFieldEnum = {
  id: 'id',
  leadId: 'leadId',
  userId: 'userId',
  workspaceId: 'workspaceId',
  type: 'type',
  description: 'description',
  status: 'status',
  scheduledAt: 'scheduledAt',
  completedAt: 'completedAt',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.FollowUpImageScalarFieldEnum = {
  id: 'id',
  followUpId: 'followUpId',
  url: 'url',
  createdAt: 'createdAt'
};

exports.Prisma.RosterEntryScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  rosterType: 'rosterType',
  name: 'name',
  startDate: 'startDate',
  endDate: 'endDate',
  shiftSession: 'shiftSession',
  shiftStartTime: 'shiftStartTime',
  shiftEndTime: 'shiftEndTime',
  status: 'status',
  createdBy: 'createdBy',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.AuditLogScalarFieldEnum = {
  id: 'id',
  userId: 'userId',
  workspaceId: 'workspaceId',
  action: 'action',
  entityType: 'entityType',
  entityId: 'entityId',
  details: 'details',
  ipAddress: 'ipAddress',
  userAgent: 'userAgent',
  createdAt: 'createdAt'
};

exports.Prisma.DeviceScalarFieldEnum = {
  id: 'id',
  deviceId: 'deviceId',
  os: 'os',
  browser: 'browser',
  deviceType: 'deviceType',
  ipAddress: 'ipAddress',
  lastActive: 'lastActive',
  userId: 'userId',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.HolidayScalarFieldEnum = {
  id: 'id',
  workspaceId: 'workspaceId',
  name: 'name',
  holidayDate: 'holidayDate',
  countryId: 'countryId',
  stateId: 'stateId',
  districtId: 'districtId',
  isRecurring: 'isRecurring',
  recurrenceRule: 'recurrenceRule',
  source: 'source',
  status: 'status',
  createdById: 'createdById',
  updatedById: 'updatedById',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt'
};

exports.Prisma.HolidaySyncLogScalarFieldEnum = {
  id: 'id',
  workspaceId: 'workspaceId',
  source: 'source',
  status: 'status',
  message: 'message',
  syncedAt: 'syncedAt'
};

exports.Prisma.ReportTypeScalarFieldEnum = {
  id: 'id',
  workspaceId: 'workspaceId',
  name: 'name',
  module: 'module',
  baseDataSource: 'baseDataSource',
  description: 'description',
  allowedFilters: 'allowedFilters',
  status: 'status',
  createdById: 'createdById',
  updatedById: 'updatedById',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.ReportLogScalarFieldEnum = {
  id: 'id',
  workspaceId: 'workspaceId',
  reportTypeId: 'reportTypeId',
  reportId: 'reportId',
  generatedById: 'generatedById',
  action: 'action',
  filters: 'filters',
  resultCount: 'resultCount',
  meta: 'meta',
  createdAt: 'createdAt'
};

exports.Prisma.ReportScalarFieldEnum = {
  id: 'id',
  workspaceId: 'workspaceId',
  reportName: 'reportName',
  reportTypeId: 'reportTypeId',
  reportDate: 'reportDate',
  isActive: 'isActive',
  isGenerated: 'isGenerated',
  generatedFileUrl: 'generatedFileUrl',
  generatedAt: 'generatedAt',
  createdById: 'createdById',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
  deletedAt: 'deletedAt'
};

exports.Prisma.ReportFilterScalarFieldEnum = {
  id: 'id',
  reportId: 'reportId',
  filterKey: 'filterKey',
  filterValue: 'filterValue',
  createdAt: 'createdAt'
};

exports.Prisma.SortOrder = {
  asc: 'asc',
  desc: 'desc'
};

exports.Prisma.NullableJsonNullValueInput = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull
};

exports.Prisma.JsonNullValueInput = {
  JsonNull: Prisma.JsonNull
};

exports.Prisma.QueryMode = {
  default: 'default',
  insensitive: 'insensitive'
};

exports.Prisma.NullsOrder = {
  first: 'first',
  last: 'last'
};

exports.Prisma.JsonNullValueFilter = {
  DbNull: Prisma.DbNull,
  JsonNull: Prisma.JsonNull,
  AnyNull: Prisma.AnyNull
};
exports.RoleStatus = exports.$Enums.RoleStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

exports.DepartmentStatus = exports.$Enums.DepartmentStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

exports.LeadSourceStatus = exports.$Enums.LeadSourceStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

exports.StageStatus = exports.$Enums.StageStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

exports.InputType = exports.$Enums.InputType = {
  TEXT: 'TEXT',
  TEXTAREA: 'TEXTAREA',
  RADIO: 'RADIO',
  SELECT: 'SELECT'
};

exports.RuleStatus = exports.$Enums.RuleStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

exports.LocationType = exports.$Enums.LocationType = {
  COUNTRY: 'COUNTRY',
  STATE: 'STATE',
  DISTRICT: 'DISTRICT',
  CITY: 'CITY',
  WARD: 'WARD',
  CONSTITUENCY: 'CONSTITUENCY',
  OFFICE: 'OFFICE'
};

exports.LeadExpiryAction = exports.$Enums.LeadExpiryAction = {
  AUTO_LOB: 'AUTO_LOB',
  WARN_AND_CHOOSE: 'WARN_AND_CHOOSE'
};

exports.LeadApprovalState = exports.$Enums.LeadApprovalState = {
  NONE: 'NONE',
  PENDING: 'PENDING'
};

exports.LeadClosureType = exports.$Enums.LeadClosureType = {
  WON: 'WON',
  LOST: 'LOST',
  CANCELLED: 'CANCELLED'
};

exports.LOBReasonStatus = exports.$Enums.LOBReasonStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

exports.LeadApprovalStatus = exports.$Enums.LeadApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  DENIED: 'DENIED'
};

exports.TargetSettingCycle = exports.$Enums.TargetSettingCycle = {
  MONTHLY: 'MONTHLY',
  QUARTERLY: 'QUARTERLY',
  YEARLY: 'YEARLY',
  CUSTOM: 'CUSTOM'
};

exports.ViolationType = exports.$Enums.ViolationType = {
  DAILY: 'DAILY',
  MONTHLY: 'MONTHLY'
};

exports.RosterType = exports.$Enums.RosterType = {
  HOLIDAY: 'HOLIDAY',
  WEEKLY_OFF: 'WEEKLY_OFF',
  SHIFT: 'SHIFT',
  SPECIAL_WORKING_DAY: 'SPECIAL_WORKING_DAY'
};

exports.ShiftSession = exports.$Enums.ShiftSession = {
  DAY: 'DAY',
  NIGHT: 'NIGHT'
};

exports.RosterStatus = exports.$Enums.RosterStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

exports.HolidaySource = exports.$Enums.HolidaySource = {
  MANUAL: 'MANUAL',
  API: 'API',
  AI: 'AI',
  GOOGLE: 'GOOGLE'
};

exports.HolidayStatus = exports.$Enums.HolidayStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

exports.ReportModule = exports.$Enums.ReportModule = {
  LEADS: 'LEADS',
  USERS: 'USERS',
  REPORTS: 'REPORTS',
  TARGETS: 'TARGETS',
  FOLLOWUPS: 'FOLLOWUPS'
};

exports.ReportBaseDataSource = exports.$Enums.ReportBaseDataSource = {
  LEADS: 'LEADS',
  USERS: 'USERS',
  FOLLOWUPS: 'FOLLOWUPS'
};

exports.ReportTypeStatus = exports.$Enums.ReportTypeStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

exports.Prisma.ModelName = {
  Role: 'Role',
  Permission: 'Permission',
  RolePermission: 'RolePermission',
  Workspace: 'Workspace',
  Department: 'Department',
  LeadSource: 'LeadSource',
  LeadStage: 'LeadStage',
  StageRule: 'StageRule',
  LeadStageInput: 'LeadStageInput',
  Office: 'Office',
  Country: 'Country',
  LocationLevel: 'LocationLevel',
  Location: 'Location',
  UserLocationAssignment: 'UserLocationAssignment',
  TargetType: 'TargetType',
  TargetCycle: 'TargetCycle',
  TargetCycleRange: 'TargetCycleRange',
  LeadLifeCycle: 'LeadLifeCycle',
  Lead: 'Lead',
  LeadLOBLog: 'LeadLOBLog',
  LOBReason: 'LOBReason',
  LeadStageApproval: 'LeadStageApproval',
  LeadLifeCycleTransition: 'LeadLifeCycleTransition',
  LeadDynamicField: 'LeadDynamicField',
  LeadDynamicOption: 'LeadDynamicOption',
  LeadDynamicValue: 'LeadDynamicValue',
  LeadActivity: 'LeadActivity',
  TargetSetting: 'TargetSetting',
  TargetViolation: 'TargetViolation',
  User: 'User',
  FollowUp: 'FollowUp',
  FollowUpImage: 'FollowUpImage',
  RosterEntry: 'RosterEntry',
  AuditLog: 'AuditLog',
  Device: 'Device',
  Holiday: 'Holiday',
  HolidaySyncLog: 'HolidaySyncLog',
  ReportType: 'ReportType',
  ReportLog: 'ReportLog',
  Report: 'Report',
  ReportFilter: 'ReportFilter'
};
/**
 * Create the Client
 */
const config = {
  "generator": {
    "name": "client",
    "provider": {
      "fromEnvVar": null,
      "value": "prisma-client-js"
    },
    "output": {
      "value": "/Users/harshadmt/Downloads/Seeakk/backend/prisma/generated/client",
      "fromEnvVar": null
    },
    "config": {
      "engineType": "library"
    },
    "binaryTargets": [
      {
        "fromEnvVar": null,
        "value": "darwin-arm64",
        "native": true
      },
      {
        "fromEnvVar": null,
        "value": "darwin-arm64"
      }
    ],
    "previewFeatures": [
      "driverAdapters"
    ],
    "sourceFilePath": "/Users/harshadmt/Downloads/Seeakk/backend/prisma/schema.prisma",
    "isCustomOutput": true
  },
  "relativeEnvPaths": {
    "rootEnvPath": null,
    "schemaEnvPath": "../../../.env"
  },
  "relativePath": "../..",
  "clientVersion": "5.22.0",
  "engineVersion": "605197351a3c8bdd595af2d2a9bc3025bca48ea2",
  "datasourceNames": [
    "db"
  ],
  "activeProvider": "postgresql",
  "inlineDatasources": {
    "db": {
      "url": {
        "fromEnvVar": "DATABASE_URL",
        "value": null
      }
    }
  },
  "inlineSchema": "generator client {\n  provider        = \"prisma-client-js\"\n  output          = \"./generated/client\"\n  previewFeatures = [\"driverAdapters\"]\n  binaryTargets   = [\"native\", \"darwin-arm64\"]\n}\n\ndatasource db {\n  provider = \"postgresql\"\n  url      = env(\"DATABASE_URL\")\n}\n\nenum TargetSettingCycle {\n  MONTHLY\n  QUARTERLY\n  YEARLY\n  CUSTOM\n\n  @@map(\"TargetCycle\")\n}\n\nenum ViolationType {\n  DAILY\n  MONTHLY\n}\n\nenum LocationType {\n  COUNTRY\n  STATE\n  DISTRICT\n  CITY\n  WARD\n  CONSTITUENCY\n  OFFICE\n}\n\nenum RoleStatus {\n  ACTIVE\n  INACTIVE\n}\n\nmodel Role {\n  id          String     @id @default(uuid())\n  name        String     @unique\n  status      RoleStatus @default(ACTIVE)\n  description String?\n\n  createdBy String?\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  permissions RolePermission[]\n  users       User[]\n\n  @@map(\"roles\")\n}\n\nmodel Permission {\n  id          String  @id @default(uuid())\n  key         String  @unique\n  group       String\n  description String?\n\n  createdAt DateTime @default(now())\n\n  roles RolePermission[]\n\n  @@map(\"permissions\")\n}\n\nmodel RolePermission {\n  roleId       String\n  permissionId String\n\n  role       Role       @relation(fields: [roleId], references: [id])\n  permission Permission @relation(fields: [permissionId], references: [id])\n\n  @@id([roleId, permissionId])\n  @@map(\"role_permissions\")\n}\n\nmodel Workspace {\n  id                 String              @id @default(cuid())\n  companyName        String\n  employeeCount      String\n  timeZone           String              @default(\"UTC\")\n  language           String              @default(\"en-US\")\n  currencyLocale     String              @default(\"USD\")\n  loadSampleData     Boolean             @default(false)\n  owner              User                @relation(\"WorkspaceOwner\", fields: [ownerId], references: [id])\n  ownerId            String              @unique\n  users              User[]              @relation(\"WorkspaceMembers\")\n  departments        Department[]\n  targetCycles       TargetCycle[]\n  leadLifeCycles     LeadLifeCycle[]\n  leadDynamicFields  LeadDynamicField[]\n  leads              Lead[]\n  leadActivities     LeadActivity[]\n  leadStageApprovals LeadStageApproval[]\n  holidays           Holiday[]\n  holidaySyncLogs    HolidaySyncLog[]\n  countries          Country[]\n  locationLevels     LocationLevel[]\n  lobReasons         LOBReason[]\n  reportTypes        ReportType[]\n  reports            Report[]\n  reportLogs         ReportLog[]\n  createdAt          DateTime            @default(now())\n  updatedAt          DateTime            @updatedAt\n\n  @@map(\"workspaces\")\n}\n\nenum DepartmentStatus {\n  ACTIVE\n  INACTIVE\n}\n\nenum LeadSourceStatus {\n  ACTIVE\n  INACTIVE\n}\n\nenum StageStatus {\n  ACTIVE\n  INACTIVE\n}\n\nenum LeadClosureType {\n  WON\n  LOST\n  CANCELLED\n}\n\nenum LeadExpiryAction {\n  AUTO_LOB\n  WARN_AND_CHOOSE\n}\n\nenum LeadApprovalStatus {\n  PENDING\n  APPROVED\n  DENIED\n}\n\nenum LeadApprovalState {\n  NONE\n  PENDING\n}\n\nenum ReportTypeStatus {\n  ACTIVE\n  INACTIVE\n}\n\nenum LOBReasonStatus {\n  ACTIVE\n  INACTIVE\n}\n\nenum ReportBaseDataSource {\n  LEADS\n  USERS\n  FOLLOWUPS\n}\n\nenum ReportModule {\n  LEADS\n  USERS\n  REPORTS\n  TARGETS\n  FOLLOWUPS\n}\n\nenum InputType {\n  TEXT\n  TEXTAREA\n  RADIO\n  SELECT\n}\n\nenum RuleStatus {\n  ACTIVE\n  INACTIVE\n}\n\nenum RosterType {\n  HOLIDAY\n  WEEKLY_OFF\n  SHIFT\n  SPECIAL_WORKING_DAY\n}\n\nenum RosterStatus {\n  ACTIVE\n  INACTIVE\n}\n\nenum ShiftSession {\n  DAY\n  NIGHT\n}\n\nmodel Department {\n  id          String           @id @default(uuid())\n  name        String\n  description String?\n  status      DepartmentStatus @default(ACTIVE)\n\n  workspace   Workspace? @relation(fields: [workspaceId], references: [id])\n  workspaceId String?\n\n  createdAt DateTime  @default(now())\n  updatedAt DateTime  @updatedAt\n  deletedAt DateTime?\n\n  users User[]\n\n  @@unique([name, workspaceId])\n  @@index([workspaceId])\n  @@index([name])\n  @@index([status])\n  @@index([createdAt])\n  @@index([workspaceId, deletedAt, status, createdAt(sort: Desc)])\n  @@map(\"departments\")\n}\n\nmodel LeadSource {\n  id        String           @id @default(uuid())\n  name      String           @unique\n  status    LeadSourceStatus @default(ACTIVE)\n  createdBy String?\n  createdAt DateTime         @default(now())\n  updatedAt DateTime         @updatedAt\n  deletedAt DateTime?\n  leads     Lead[]\n\n  @@index([name])\n  @@index([status])\n  @@map(\"lead_sources\")\n}\n\nmodel LeadStage {\n  id                 String              @id @default(uuid())\n  name               String\n  color              String              @default(\"#10b981\")\n  isApprovalRequired Boolean             @default(false)\n  isLOB              Boolean             @default(false)\n  isClosed           Boolean             @default(false)\n  order              Int\n  status             StageStatus         @default(ACTIVE)\n  createdBy          String?\n  createdAt          DateTime            @default(now())\n  updatedAt          DateTime            @updatedAt\n  deletedAt          DateTime?\n  rules              StageRule[]\n  leads              Lead[]\n  approvalsFrom      LeadStageApproval[] @relation(\"LeadStageApprovalFromStage\")\n  approvalsTo        LeadStageApproval[] @relation(\"LeadStageApprovalToStage\")\n\n  @@index([name])\n  @@index([status])\n  @@index([order])\n  @@map(\"lead_stages\")\n}\n\nmodel StageRule {\n  id                String     @id @default(uuid())\n  name              String     @default(\"Untitled Rule\")\n  inputType         InputType  @default(TEXT)\n  sortOrder         Int        @default(1)\n  required          Boolean    @default(false)\n  // Legacy columns kept for backward compatibility to avoid destructive schema pushes.\n  legacyField       String?    @map(\"field\")\n  legacyCondition   String?    @map(\"condition\")\n  legacyValue       String?    @map(\"value\")\n  legacyIsMandatory Boolean?   @map(\"isMandatory\")\n  status            RuleStatus @default(ACTIVE)\n  stageId           String?\n  createdBy         String?\n  createdAt         DateTime   @default(now())\n  updatedAt         DateTime   @default(now()) @updatedAt\n  deletedAt         DateTime?\n\n  stage      LeadStage?       @relation(fields: [stageId], references: [id], onDelete: SetNull)\n  leadInputs LeadStageInput[]\n\n  @@index([name])\n  @@index([status])\n  @@index([sortOrder])\n  @@index([stageId])\n  @@map(\"stage_rules\")\n}\n\nmodel LeadStageInput {\n  id        String   @id @default(uuid())\n  leadId    String\n  ruleId    String\n  value     String\n  createdAt DateTime @default(now())\n\n  rule StageRule @relation(fields: [ruleId], references: [id], onDelete: Cascade)\n\n  @@index([leadId])\n  @@index([ruleId])\n  @@map(\"lead_stage_inputs\")\n}\n\nmodel Office {\n  id          String   @id @default(cuid())\n  name        String\n  address     String?\n  countryId   String?\n  stateId     String?\n  districtId  String?\n  isActive    Boolean  @default(true)\n  createdBy   String?\n  workspaceId String\n  users       User[]\n  createdAt   DateTime @default(now())\n  updatedAt   DateTime @updatedAt\n\n  @@index([workspaceId])\n  @@index([name])\n  @@index([countryId])\n  @@index([stateId])\n  @@index([districtId])\n  @@map(\"offices\")\n}\n\nmodel Country {\n  id          String    @id @default(uuid())\n  workspaceId String\n  name        String\n  code        String?\n  isActive    Boolean   @default(true)\n  createdById String?\n  updatedById String?\n  createdAt   DateTime  @default(now())\n  updatedAt   DateTime  @updatedAt\n  deletedAt   DateTime?\n\n  workspace Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)\n  createdBy User?           @relation(\"CountryCreatedBy\", fields: [createdById], references: [id], onDelete: SetNull)\n  updatedBy User?           @relation(\"CountryUpdatedBy\", fields: [updatedById], references: [id], onDelete: SetNull)\n  levels    LocationLevel[]\n  locations Location[]\n\n  @@index([workspaceId])\n  @@index([workspaceId, isActive, createdAt(sort: Desc)])\n  @@map(\"countries\")\n}\n\nmodel LocationLevel {\n  id          String   @id @default(uuid())\n  workspaceId String\n  countryId   String\n  levelName   String\n  levelOrder  Int\n  isActive    Boolean  @default(true)\n  createdById String?\n  updatedById String?\n  createdAt   DateTime @default(now())\n  updatedAt   DateTime @updatedAt\n\n  workspace Workspace  @relation(fields: [workspaceId], references: [id], onDelete: Cascade)\n  country   Country    @relation(fields: [countryId], references: [id], onDelete: Cascade)\n  createdBy User?      @relation(\"LocationLevelCreatedBy\", fields: [createdById], references: [id], onDelete: SetNull)\n  updatedBy User?      @relation(\"LocationLevelUpdatedBy\", fields: [updatedById], references: [id], onDelete: SetNull)\n  locations Location[]\n\n  @@unique([countryId, levelOrder])\n  @@index([workspaceId])\n  @@index([countryId, isActive, levelOrder])\n  @@map(\"location_levels\")\n}\n\nmodel Location {\n  id          String       @id @default(cuid())\n  name        String\n  type        LocationType\n  workspaceId String\n  countryId   String?\n  levelId     String?\n  isActive    Boolean      @default(true)\n  createdById String?\n  updatedById String?\n  deletedAt   DateTime?\n\n  parentId String?\n  parent   Location?      @relation(\"LocationHierarchy\", fields: [parentId], references: [id])\n  children Location[]     @relation(\"LocationHierarchy\")\n  country  Country?       @relation(fields: [countryId], references: [id], onDelete: SetNull)\n  level    LocationLevel? @relation(fields: [levelId], references: [id], onDelete: SetNull)\n\n  assignedUsers UserLocationAssignment[]\n\n  // Potential address relations for users (where they live)\n  usersAtCountry  User[] @relation(\"UserCountry\")\n  usersAtState    User[] @relation(\"UserState\")\n  usersAtDistrict User[] @relation(\"UserDistrict\")\n\n  holidaysAtCountry  Holiday[] @relation(\"HolidayCountry\")\n  holidaysAtState    Holiday[] @relation(\"HolidayState\")\n  holidaysAtDistrict Holiday[] @relation(\"HolidayDistrict\")\n\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  @@index([workspaceId])\n  @@index([parentId])\n  @@index([countryId])\n  @@index([levelId])\n  @@index([workspaceId, countryId, levelId, isActive])\n  @@map(\"locations\")\n}\n\nmodel UserLocationAssignment {\n  id         String   @id @default(cuid())\n  userId     String\n  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)\n  locationId String\n  location   Location @relation(fields: [locationId], references: [id], onDelete: Cascade)\n\n  workspaceId String\n\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  @@unique([userId, locationId])\n  @@index([workspaceId])\n  @@map(\"user_location_assignments\")\n}\n\nmodel TargetType {\n  id          String          @id @default(cuid())\n  name        String          @unique // e.g., \"Revenue\", \"Leads Generated\"\n  description String?\n  workspaceId String? // Optional: Global types or workspace-specific\n  settings    TargetSetting[]\n  createdAt   DateTime        @default(now())\n  updatedAt   DateTime        @updatedAt\n\n  @@map(\"target_types\")\n}\n\nmodel TargetCycle {\n  id          String @id @default(cuid())\n  name        String\n  workspaceId String\n\n  totalDays Int\n  status    String @default(\"ACTIVE\")\n\n  createdBy String?\n  createdAt DateTime  @default(now())\n  updatedAt DateTime  @updatedAt\n  deletedAt DateTime?\n\n  workspace Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)\n  ranges    TargetCycleRange[]\n  targets   TargetSetting[]\n\n  @@unique([name, workspaceId])\n  @@index([workspaceId])\n  @@map(\"target_cycles\")\n}\n\nmodel TargetCycleRange {\n  id            String @id @default(cuid())\n  targetCycleId String\n\n  startDay Int\n  endDay   Int\n\n  createdAt DateTime @default(now())\n\n  targetCycle TargetCycle @relation(fields: [targetCycleId], references: [id], onDelete: Cascade)\n\n  @@index([targetCycleId])\n  @@map(\"target_cycle_ranges\")\n}\n\nmodel LeadLifeCycle {\n  id        String  @id @default(cuid())\n  name      String\n  isDefault Boolean @default(false)\n\n  workspaceId String\n\n  createdBy String?\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  workspace   Workspace                 @relation(fields: [workspaceId], references: [id], onDelete: Cascade)\n  transitions LeadLifeCycleTransition[]\n  leads       Lead[]\n\n  @@unique([name, workspaceId])\n  @@index([workspaceId])\n  @@index([workspaceId, isDefault, name])\n  @@map(\"lead_life_cycles\")\n}\n\nmodel Lead {\n  id                         String            @id @default(cuid())\n  name                       String\n  email                      String?\n  phone                      String?\n  expectedRevenue            Float?\n  generatedRevenue           Float             @default(0)\n  assignedToId               String?\n  stageId                    String?\n  lifecycleId                String?\n  sourceId                   String?\n  nextFollowUpAt             DateTime?\n  stageEnteredAt             DateTime?\n  stageExpiresAt             DateTime?\n  slaAction                  LeadExpiryAction?\n  slaWarningDays             Int?\n  approvalState              LeadApprovalState @default(NONE)\n  pendingApprovalToStageId   String?\n  pendingApprovalRequestedAt DateTime?\n  isClosed                   Boolean           @default(false)\n  isLOB                      Boolean           @default(false)\n  closedAt                   DateTime?\n  closedById                 String?\n  closureType                LeadClosureType?\n  workspaceId                String\n  createdById                String\n  deletedAt                  DateTime?\n  createdAt                  DateTime          @default(now())\n  updatedAt                  DateTime          @updatedAt\n\n  assignedTo     User?               @relation(\"LeadAssignedTo\", fields: [assignedToId], references: [id], onDelete: SetNull)\n  stage          LeadStage?          @relation(fields: [stageId], references: [id], onDelete: SetNull)\n  lifecycle      LeadLifeCycle?      @relation(fields: [lifecycleId], references: [id], onDelete: SetNull)\n  source         LeadSource?         @relation(fields: [sourceId], references: [id], onDelete: SetNull)\n  createdBy      User                @relation(\"LeadCreatedBy\", fields: [createdById], references: [id], onDelete: Restrict)\n  closedBy       User?               @relation(\"LeadClosedBy\", fields: [closedById], references: [id], onDelete: SetNull)\n  workspace      Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)\n  followUps      FollowUp[]\n  lobLogs        LeadLOBLog[]\n  activities     LeadActivity[]\n  stageApprovals LeadStageApproval[]\n\n  @@index([workspaceId, assignedToId, stageId])\n  @@index([workspaceId, sourceId, createdAt])\n  @@index([workspaceId, deletedAt])\n  @@index([workspaceId, isLOB, isClosed])\n  @@index([isClosed])\n  @@index([workspaceId, isClosed])\n  @@index([closureType])\n  @@index([closedAt(sort: Desc)])\n  @@index([nextFollowUpAt])\n  @@index([workspaceId, isClosed, isLOB, stageExpiresAt])\n  @@index([workspaceId, stageId, deletedAt, isClosed])\n  @@index([workspaceId, assignedToId, deletedAt, isClosed])\n  @@index([workspaceId, sourceId, deletedAt, isClosed])\n  @@index([workspaceId, lifecycleId, deletedAt, isClosed])\n  @@index([workspaceId, nextFollowUpAt, deletedAt, isClosed])\n  @@index([workspaceId, createdAt(sort: Desc), deletedAt, isClosed])\n  @@index([workspaceId, approvalState, pendingApprovalRequestedAt])\n  @@map(\"leads\")\n}\n\nmodel LeadLOBLog {\n  id          String   @id @default(cuid())\n  leadId      String\n  reasonId    String\n  remarks     String?\n  changedById String\n  changedAt   DateTime @default(now())\n  workspaceId String\n\n  lead Lead @relation(fields: [leadId], references: [id], onDelete: Cascade)\n\n  @@index([leadId, changedAt])\n  @@index([workspaceId, reasonId])\n  @@map(\"lead_lob_logs\")\n}\n\nmodel LOBReason {\n  id          String          @id @default(uuid())\n  workspaceId String\n  name        String\n  status      LOBReasonStatus @default(ACTIVE)\n  createdById String?\n  updatedById String?\n  createdAt   DateTime        @default(now())\n  updatedAt   DateTime        @updatedAt\n  deletedAt   DateTime?\n\n  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)\n  createdBy User?     @relation(\"LOBReasonCreatedBy\", fields: [createdById], references: [id], onDelete: SetNull)\n  updatedBy User?     @relation(\"LOBReasonUpdatedBy\", fields: [updatedById], references: [id], onDelete: SetNull)\n\n  @@index([workspaceId])\n  @@index([status])\n  @@index([workspaceId, status, createdAt(sort: Desc)])\n  @@map(\"lob_reasons\")\n}\n\nmodel LeadStageApproval {\n  id            String             @id @default(cuid())\n  workspaceId   String\n  leadId        String\n  fromStageId   String\n  toStageId     String\n  requestedById String\n  assignedToId  String?\n  status        LeadApprovalStatus @default(PENDING)\n  comment       String?\n  requestData   Json?\n  approvedById  String?\n  approvedAt    DateTime?\n  createdAt     DateTime           @default(now())\n  updatedAt     DateTime           @updatedAt\n\n  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)\n  lead        Lead      @relation(fields: [leadId], references: [id], onDelete: Cascade)\n  fromStage   LeadStage @relation(\"LeadStageApprovalFromStage\", fields: [fromStageId], references: [id], onDelete: Restrict)\n  toStage     LeadStage @relation(\"LeadStageApprovalToStage\", fields: [toStageId], references: [id], onDelete: Restrict)\n  requestedBy User      @relation(\"LeadStageApprovalRequestedBy\", fields: [requestedById], references: [id], onDelete: Restrict)\n  assignedTo  User?     @relation(\"LeadStageApprovalAssignedTo\", fields: [assignedToId], references: [id], onDelete: SetNull)\n  approvedBy  User?     @relation(\"LeadStageApprovalApprovedBy\", fields: [approvedById], references: [id], onDelete: SetNull)\n\n  @@index([workspaceId])\n  @@index([status])\n  @@index([leadId])\n  @@index([assignedToId])\n  @@index([workspaceId, status, createdAt(sort: Desc)])\n  @@index([workspaceId, requestedById, createdAt(sort: Desc)])\n  @@map(\"lead_stage_approvals\")\n}\n\nmodel LeadLifeCycleTransition {\n  id          String        @id @default(cuid())\n  lifecycleId String\n  lifecycle   LeadLifeCycle @relation(fields: [lifecycleId], references: [id], onDelete: Cascade)\n\n  fromStageId String\n  toStageId   String\n\n  numberOfDays Int\n  expiryAction LeadExpiryAction @default(WARN_AND_CHOOSE)\n  warningDays  Int              @default(1)\n\n  sortOrder Int\n\n  workspaceId String\n\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  @@index([lifecycleId])\n  @@index([workspaceId])\n  @@map(\"lead_life_cycle_transitions\")\n}\n\nmodel LeadDynamicField {\n  id         String  @id @default(cuid())\n  name       String\n  inputType  String\n  sortOrder  Int\n  isRequired Boolean @default(false)\n  isActive   Boolean @default(true)\n\n  workspaceId String\n\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  workspace Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)\n  options   LeadDynamicOption[]\n  values    LeadDynamicValue[]\n\n  @@unique([name, workspaceId])\n  @@index([workspaceId, sortOrder])\n  @@index([workspaceId, isActive, inputType, sortOrder])\n  @@map(\"lead_dynamic_fields\")\n}\n\nmodel LeadDynamicOption {\n  id      String @id @default(cuid())\n  fieldId String\n\n  value     String\n  sortOrder Int\n\n  field LeadDynamicField @relation(fields: [fieldId], references: [id], onDelete: Cascade)\n\n  @@index([fieldId])\n  @@map(\"lead_dynamic_options\")\n}\n\nmodel LeadDynamicValue {\n  id      String @id @default(cuid())\n  leadId  String\n  fieldId String\n\n  value String\n\n  createdAt DateTime @default(now())\n\n  field LeadDynamicField @relation(fields: [fieldId], references: [id], onDelete: Restrict)\n\n  @@index([leadId])\n  @@index([fieldId])\n  @@map(\"lead_dynamic_values\")\n}\n\nmodel LeadActivity {\n  id            String   @id @default(cuid())\n  leadId        String\n  performedById String?\n  workspaceId   String\n  action        String\n  metadata      Json?\n  createdAt     DateTime @default(now())\n\n  lead        Lead      @relation(fields: [leadId], references: [id], onDelete: Cascade)\n  performedBy User?     @relation(\"LeadActivityPerformedBy\", fields: [performedById], references: [id], onDelete: SetNull)\n  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)\n\n  @@index([leadId, createdAt(sort: Desc)])\n  @@index([workspaceId, action, createdAt(sort: Desc)])\n  @@map(\"lead_activities\")\n}\n\nmodel TargetSetting {\n  id            String             @id @default(cuid())\n  user          User               @relation(fields: [userId], references: [id], onDelete: Cascade)\n  userId        String\n  targetType    TargetType         @relation(fields: [targetTypeId], references: [id])\n  targetTypeId  String\n  cycle         TargetSettingCycle @default(MONTHLY)\n  targetCycleId String?\n  targetCycle   TargetCycle?       @relation(fields: [targetCycleId], references: [id], onDelete: SetNull)\n\n  monthlyTargetLeads  Int   @default(0)\n  dailyFollowupTarget Int   @default(0)\n  revenueTarget       Float @default(0)\n\n  startDate DateTime\n  endDate   DateTime?\n\n  workspaceId String\n  createdAt   DateTime @default(now())\n  updatedAt   DateTime @updatedAt\n\n  @@index([userId, workspaceId])\n  @@index([targetTypeId])\n  @@index([targetCycleId])\n  @@map(\"target_settings\")\n}\n\nmodel TargetViolation {\n  id           String        @id @default(cuid())\n  user         User          @relation(fields: [userId], references: [id], onDelete: Cascade)\n  userId       String\n  date         DateTime      @default(now())\n  type         ViolationType\n  attemptCount Int           @default(1)\n  status       String        @default(\"WARNING\") // WARNING, FINAL_WARNING, LOCKED\n  message      String?\n\n  workspaceId String\n  createdAt   DateTime @default(now())\n  updatedAt   DateTime @updatedAt\n\n  @@index([userId, date])\n  @@index([workspaceId])\n  @@map(\"target_violations\")\n}\n\nmodel User {\n  id                       String    @id @default(cuid())\n  name                     String?\n  username                 String?   @unique\n  email                    String    @unique\n  password                 String?\n  phone                    String?\n  googleId                 String?   @unique\n  isOnboarded              Boolean   @default(false)\n  isActive                 Boolean   @default(true)\n  isEmailVerified          Boolean   @default(false)\n  isLocked                 Boolean   @default(false) // Target compliance lock\n  verificationToken        String?\n  verificationTokenExpires DateTime?\n  invitationToken          String?\n  invitationExpires        DateTime?\n  deletedAt                DateTime?\n\n  // Role relation\n  role   Role?   @relation(fields: [roleId], references: [id])\n  roleId String?\n\n  // Workspace relation\n  workspace      Workspace? @relation(\"WorkspaceMembers\", fields: [workspaceId], references: [id])\n  workspaceId    String?\n  ownedWorkspace Workspace? @relation(\"WorkspaceOwner\")\n\n  // Department relation\n  department   Department? @relation(fields: [departmentId], references: [id])\n  departmentId String?\n\n  // Office relation\n  office   Office? @relation(fields: [officeId], references: [id])\n  officeId String?\n\n  // User's own location fields (Address)\n  countryId  String?\n  country    Location? @relation(\"UserCountry\", fields: [countryId], references: [id])\n  stateId    String?\n  state      Location? @relation(\"UserState\", fields: [stateId], references: [id])\n  districtId String?\n  district   Location? @relation(\"UserDistrict\", fields: [districtId], references: [id])\n\n  // Assigned Locations for Visibility Boundary\n  assignedLocations UserLocationAssignment[]\n\n  // Supervisor self-relation\n  supervisor   User?   @relation(\"UserSupervisor\", fields: [supervisorId], references: [id])\n  supervisorId String?\n  subordinates User[]  @relation(\"UserSupervisor\")\n\n  // Target relations\n  targetSettings TargetSetting[]\n  violations     TargetViolation[]\n\n  // Devices\n  devices Device[]\n\n  // Audit logs relation\n  auditLogs                   AuditLog[]\n  performedLeadActivities     LeadActivity[]      @relation(\"LeadActivityPerformedBy\")\n  requestedLeadStageApprovals LeadStageApproval[] @relation(\"LeadStageApprovalRequestedBy\")\n  assignedLeadStageApprovals  LeadStageApproval[] @relation(\"LeadStageApprovalAssignedTo\")\n  approvedLeadStageApprovals  LeadStageApproval[] @relation(\"LeadStageApprovalApprovedBy\")\n  rosterEntries               RosterEntry[]\n  followUps                   FollowUp[]\n  createdLeads                Lead[]              @relation(\"LeadCreatedBy\")\n  assignedLeads               Lead[]              @relation(\"LeadAssignedTo\")\n  closedLeads                 Lead[]              @relation(\"LeadClosedBy\")\n\n  createdHolidays       Holiday[]       @relation(\"HolidayCreatedBy\")\n  updatedHolidays       Holiday[]       @relation(\"HolidayUpdatedBy\")\n  createdCountries      Country[]       @relation(\"CountryCreatedBy\")\n  updatedCountries      Country[]       @relation(\"CountryUpdatedBy\")\n  createdLocationLevels LocationLevel[] @relation(\"LocationLevelCreatedBy\")\n  updatedLocationLevels LocationLevel[] @relation(\"LocationLevelUpdatedBy\")\n  createdLOBReasons     LOBReason[]     @relation(\"LOBReasonCreatedBy\")\n  updatedLOBReasons     LOBReason[]     @relation(\"LOBReasonUpdatedBy\")\n  createdReportTypes    ReportType[]    @relation(\"ReportTypeCreatedBy\")\n  updatedReportTypes    ReportType[]    @relation(\"ReportTypeUpdatedBy\")\n  createdReports        Report[]        @relation(\"ReportCreatedBy\")\n  generatedReportLogs   ReportLog[]     @relation(\"ReportLogGeneratedBy\")\n\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  @@index([workspaceId])\n  @@index([roleId])\n  @@index([departmentId])\n  @@index([officeId])\n  @@index([supervisorId])\n  @@index([workspaceId, deletedAt, createdAt(sort: Desc)])\n  @@index([workspaceId, roleId, deletedAt])\n  @@index([workspaceId, supervisorId, deletedAt])\n  @@map(\"users\")\n}\n\nmodel FollowUp {\n  id          String @id @default(cuid())\n  leadId      String\n  userId      String\n  workspaceId String\n\n  type        String\n  description String?\n  status      String  @default(\"PENDING\")\n\n  scheduledAt DateTime\n  completedAt DateTime?\n\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  user   User            @relation(fields: [userId], references: [id], onDelete: Cascade)\n  lead   Lead            @relation(fields: [leadId], references: [id], onDelete: Cascade)\n  images FollowUpImage[]\n\n  @@index([workspaceId, userId, scheduledAt])\n  @@index([workspaceId, status, scheduledAt])\n  @@index([leadId])\n  @@index([workspaceId, userId, status, scheduledAt(sort: Desc)])\n  @@map(\"follow_ups\")\n}\n\nmodel FollowUpImage {\n  id         String @id @default(cuid())\n  followUpId String\n  url        String\n\n  createdAt DateTime @default(now())\n\n  followUp FollowUp @relation(fields: [followUpId], references: [id], onDelete: Cascade)\n\n  @@index([followUpId])\n  @@map(\"follow_up_images\")\n}\n\nmodel RosterEntry {\n  id             String        @id @default(uuid())\n  userId         String\n  rosterType     RosterType\n  name           String\n  startDate      DateTime\n  endDate        DateTime?\n  shiftSession   ShiftSession?\n  shiftStartTime String?\n  shiftEndTime   String?\n  status         RosterStatus  @default(ACTIVE)\n  createdBy      String?\n  createdAt      DateTime      @default(now())\n  updatedAt      DateTime      @updatedAt\n  deletedAt      DateTime?\n\n  user User @relation(fields: [userId], references: [id], onDelete: Cascade)\n\n  @@index([userId])\n  @@index([startDate])\n  @@index([status])\n  @@map(\"roster_entries\")\n}\n\nmodel AuditLog {\n  id          String   @id @default(cuid())\n  userId      String?\n  user        User?    @relation(fields: [userId], references: [id], onDelete: SetNull)\n  workspaceId String?\n  action      String // e.g., \"USER_LOGIN\", \"USER_CREATED\", \"SETTINGS_UPDATED\"\n  entityType  String? // e.g., \"User\", \"Workspace\"\n  entityId    String?\n  details     Json? // Store old/new values or extra metadata\n  ipAddress   String?\n  userAgent   String?\n  createdAt   DateTime @default(now())\n\n  @@index([userId])\n  @@index([workspaceId])\n  @@index([action])\n  @@index([workspaceId, createdAt(sort: Desc)])\n  @@index([userId, createdAt(sort: Desc)])\n  @@index([workspaceId, action, createdAt(sort: Desc)])\n  @@map(\"audit_logs\")\n}\n\nmodel Device {\n  id         String   @id @default(cuid())\n  deviceId   String\n  os         String?\n  browser    String?\n  deviceType String?\n  ipAddress  String?\n  lastActive DateTime @default(now())\n\n  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)\n  userId String\n\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  @@unique([userId, deviceId])\n  @@map(\"devices\")\n}\n\nenum HolidaySource {\n  MANUAL\n  API\n  AI\n  GOOGLE\n}\n\nenum HolidayStatus {\n  ACTIVE\n  INACTIVE\n}\n\nmodel Holiday {\n  id             String        @id @default(uuid())\n  workspaceId    String\n  name           String\n  holidayDate    DateTime      @db.Date\n  countryId      String?\n  stateId        String?\n  districtId     String?\n  isRecurring    Boolean       @default(false)\n  recurrenceRule String?\n  source         HolidaySource @default(MANUAL)\n  status         HolidayStatus @default(ACTIVE)\n\n  createdById String?\n  updatedById String?\n\n  createdAt DateTime @default(now())\n  updatedAt DateTime @updatedAt\n\n  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)\n  country   Location? @relation(\"HolidayCountry\", fields: [countryId], references: [id])\n  state     Location? @relation(\"HolidayState\", fields: [stateId], references: [id])\n  district  Location? @relation(\"HolidayDistrict\", fields: [districtId], references: [id])\n\n  createdBy User? @relation(\"HolidayCreatedBy\", fields: [createdById], references: [id], onDelete: SetNull)\n  updatedBy User? @relation(\"HolidayUpdatedBy\", fields: [updatedById], references: [id], onDelete: SetNull)\n\n  @@index([workspaceId])\n  @@index([countryId, stateId, districtId])\n  @@index([holidayDate])\n  @@map(\"holidays\")\n}\n\nmodel HolidaySyncLog {\n  id          String        @id @default(uuid())\n  workspaceId String\n  source      HolidaySource\n  status      String\n  message     String?       @db.Text\n  syncedAt    DateTime      @default(now())\n\n  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)\n\n  @@index([workspaceId])\n  @@index([syncedAt])\n  @@map(\"holiday_sync_logs\")\n}\n\nmodel ReportType {\n  id             String               @id @default(uuid())\n  workspaceId    String\n  name           String\n  module         ReportModule\n  baseDataSource ReportBaseDataSource\n  description    String?\n  allowedFilters Json                 @default(\"[]\")\n  status         ReportTypeStatus     @default(ACTIVE)\n  createdById    String?\n  updatedById    String?\n  createdAt      DateTime             @default(now())\n  updatedAt      DateTime             @updatedAt\n  deletedAt      DateTime?\n\n  workspace Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)\n  createdBy User?       @relation(\"ReportTypeCreatedBy\", fields: [createdById], references: [id], onDelete: SetNull)\n  updatedBy User?       @relation(\"ReportTypeUpdatedBy\", fields: [updatedById], references: [id], onDelete: SetNull)\n  logs      ReportLog[]\n  reports   Report[]\n\n  @@index([workspaceId])\n  @@index([status])\n  @@index([module])\n  @@index([workspaceId, status, module, createdAt(sort: Desc)])\n  @@map(\"report_types\")\n}\n\nmodel ReportLog {\n  id            String   @id @default(uuid())\n  workspaceId   String\n  reportTypeId  String?\n  reportId      String?\n  generatedById String?\n  action        String?\n  filters       Json     @default(\"[]\")\n  resultCount   Int      @default(0)\n  meta          Json     @default(\"{}\")\n  createdAt     DateTime @default(now())\n\n  workspace   Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)\n  reportType  ReportType? @relation(fields: [reportTypeId], references: [id], onDelete: SetNull)\n  report      Report?     @relation(\"ReportInstanceLogs\", fields: [reportId], references: [id], onDelete: Cascade)\n  generatedBy User?       @relation(\"ReportLogGeneratedBy\", fields: [generatedById], references: [id], onDelete: SetNull)\n\n  @@index([workspaceId])\n  @@index([reportTypeId])\n  @@index([reportId])\n  @@index([generatedById])\n  @@index([action])\n  @@index([workspaceId, createdAt(sort: Desc)])\n  @@map(\"report_logs\")\n}\n\nmodel Report {\n  id               String    @id @default(uuid())\n  workspaceId      String\n  reportName       String\n  reportTypeId     String\n  reportDate       DateTime  @db.Date\n  isActive         Boolean   @default(true)\n  isGenerated      Boolean   @default(false)\n  generatedFileUrl String?\n  generatedAt      DateTime?\n  createdById      String\n  createdAt        DateTime  @default(now())\n  updatedAt        DateTime  @updatedAt\n  deletedAt        DateTime?\n\n  workspace  Workspace      @relation(fields: [workspaceId], references: [id], onDelete: Cascade)\n  reportType ReportType     @relation(fields: [reportTypeId], references: [id], onDelete: Restrict)\n  createdBy  User           @relation(\"ReportCreatedBy\", fields: [createdById], references: [id], onDelete: Restrict)\n  filters    ReportFilter[]\n  logs       ReportLog[]    @relation(\"ReportInstanceLogs\")\n\n  @@index([workspaceId])\n  @@index([reportTypeId])\n  @@index([createdById])\n  @@index([isActive])\n  @@index([isGenerated])\n  @@index([reportDate])\n  @@index([workspaceId, deletedAt, createdAt(sort: Desc)])\n  @@index([workspaceId, reportTypeId, reportDate])\n  @@map(\"reports\")\n}\n\nmodel ReportFilter {\n  id          String   @id @default(uuid())\n  reportId    String\n  filterKey   String\n  filterValue String   @db.Text\n  createdAt   DateTime @default(now())\n\n  report Report @relation(fields: [reportId], references: [id], onDelete: Cascade)\n\n  @@index([reportId])\n  @@index([filterKey])\n  @@map(\"report_filters\")\n}\n",
  "inlineSchemaHash": "cbf37f7725bf0b89cb0f44c54844dd2b56148dab3df7ed7a8675b4fc125d1581",
  "copyEngine": true
}
config.dirname = '/'

config.runtimeDataModel = JSON.parse("{\"models\":{\"Role\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"enum\",\"type\":\"RoleStatus\"},{\"name\":\"description\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdBy\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"permissions\",\"kind\":\"object\",\"type\":\"RolePermission\",\"relationName\":\"RoleToRolePermission\"},{\"name\":\"users\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"RoleToUser\"}],\"dbName\":\"roles\"},\"Permission\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"key\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"group\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"description\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"roles\",\"kind\":\"object\",\"type\":\"RolePermission\",\"relationName\":\"PermissionToRolePermission\"}],\"dbName\":\"permissions\"},\"RolePermission\":{\"fields\":[{\"name\":\"roleId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"permissionId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"role\",\"kind\":\"object\",\"type\":\"Role\",\"relationName\":\"RoleToRolePermission\"},{\"name\":\"permission\",\"kind\":\"object\",\"type\":\"Permission\",\"relationName\":\"PermissionToRolePermission\"}],\"dbName\":\"role_permissions\"},\"Workspace\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"companyName\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"employeeCount\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"timeZone\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"language\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"currencyLocale\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"loadSampleData\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"owner\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"WorkspaceOwner\"},{\"name\":\"ownerId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"users\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"WorkspaceMembers\"},{\"name\":\"departments\",\"kind\":\"object\",\"type\":\"Department\",\"relationName\":\"DepartmentToWorkspace\"},{\"name\":\"targetCycles\",\"kind\":\"object\",\"type\":\"TargetCycle\",\"relationName\":\"TargetCycleToWorkspace\"},{\"name\":\"leadLifeCycles\",\"kind\":\"object\",\"type\":\"LeadLifeCycle\",\"relationName\":\"LeadLifeCycleToWorkspace\"},{\"name\":\"leadDynamicFields\",\"kind\":\"object\",\"type\":\"LeadDynamicField\",\"relationName\":\"LeadDynamicFieldToWorkspace\"},{\"name\":\"leads\",\"kind\":\"object\",\"type\":\"Lead\",\"relationName\":\"LeadToWorkspace\"},{\"name\":\"leadActivities\",\"kind\":\"object\",\"type\":\"LeadActivity\",\"relationName\":\"LeadActivityToWorkspace\"},{\"name\":\"leadStageApprovals\",\"kind\":\"object\",\"type\":\"LeadStageApproval\",\"relationName\":\"LeadStageApprovalToWorkspace\"},{\"name\":\"holidays\",\"kind\":\"object\",\"type\":\"Holiday\",\"relationName\":\"HolidayToWorkspace\"},{\"name\":\"holidaySyncLogs\",\"kind\":\"object\",\"type\":\"HolidaySyncLog\",\"relationName\":\"HolidaySyncLogToWorkspace\"},{\"name\":\"countries\",\"kind\":\"object\",\"type\":\"Country\",\"relationName\":\"CountryToWorkspace\"},{\"name\":\"locationLevels\",\"kind\":\"object\",\"type\":\"LocationLevel\",\"relationName\":\"LocationLevelToWorkspace\"},{\"name\":\"lobReasons\",\"kind\":\"object\",\"type\":\"LOBReason\",\"relationName\":\"LOBReasonToWorkspace\"},{\"name\":\"reportTypes\",\"kind\":\"object\",\"type\":\"ReportType\",\"relationName\":\"ReportTypeToWorkspace\"},{\"name\":\"reports\",\"kind\":\"object\",\"type\":\"Report\",\"relationName\":\"ReportToWorkspace\"},{\"name\":\"reportLogs\",\"kind\":\"object\",\"type\":\"ReportLog\",\"relationName\":\"ReportLogToWorkspace\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":\"workspaces\"},\"Department\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"description\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"enum\",\"type\":\"DepartmentStatus\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"DepartmentToWorkspace\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"users\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"DepartmentToUser\"}],\"dbName\":\"departments\"},\"LeadSource\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"enum\",\"type\":\"LeadSourceStatus\"},{\"name\":\"createdBy\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"leads\",\"kind\":\"object\",\"type\":\"Lead\",\"relationName\":\"LeadToLeadSource\"}],\"dbName\":\"lead_sources\"},\"LeadStage\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"color\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"isApprovalRequired\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"isLOB\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"isClosed\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"order\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"status\",\"kind\":\"enum\",\"type\":\"StageStatus\"},{\"name\":\"createdBy\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"rules\",\"kind\":\"object\",\"type\":\"StageRule\",\"relationName\":\"LeadStageToStageRule\"},{\"name\":\"leads\",\"kind\":\"object\",\"type\":\"Lead\",\"relationName\":\"LeadToLeadStage\"},{\"name\":\"approvalsFrom\",\"kind\":\"object\",\"type\":\"LeadStageApproval\",\"relationName\":\"LeadStageApprovalFromStage\"},{\"name\":\"approvalsTo\",\"kind\":\"object\",\"type\":\"LeadStageApproval\",\"relationName\":\"LeadStageApprovalToStage\"}],\"dbName\":\"lead_stages\"},\"StageRule\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"inputType\",\"kind\":\"enum\",\"type\":\"InputType\"},{\"name\":\"sortOrder\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"required\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"legacyField\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"field\"},{\"name\":\"legacyCondition\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"condition\"},{\"name\":\"legacyValue\",\"kind\":\"scalar\",\"type\":\"String\",\"dbName\":\"value\"},{\"name\":\"legacyIsMandatory\",\"kind\":\"scalar\",\"type\":\"Boolean\",\"dbName\":\"isMandatory\"},{\"name\":\"status\",\"kind\":\"enum\",\"type\":\"RuleStatus\"},{\"name\":\"stageId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdBy\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"stage\",\"kind\":\"object\",\"type\":\"LeadStage\",\"relationName\":\"LeadStageToStageRule\"},{\"name\":\"leadInputs\",\"kind\":\"object\",\"type\":\"LeadStageInput\",\"relationName\":\"LeadStageInputToStageRule\"}],\"dbName\":\"stage_rules\"},\"LeadStageInput\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"leadId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"ruleId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"value\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"rule\",\"kind\":\"object\",\"type\":\"StageRule\",\"relationName\":\"LeadStageInputToStageRule\"}],\"dbName\":\"lead_stage_inputs\"},\"Office\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"address\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"countryId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"stateId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"districtId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"isActive\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"createdBy\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"users\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"OfficeToUser\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":\"offices\"},\"Country\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"code\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"isActive\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"createdById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"updatedById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"CountryToWorkspace\"},{\"name\":\"createdBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"CountryCreatedBy\"},{\"name\":\"updatedBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"CountryUpdatedBy\"},{\"name\":\"levels\",\"kind\":\"object\",\"type\":\"LocationLevel\",\"relationName\":\"CountryToLocationLevel\"},{\"name\":\"locations\",\"kind\":\"object\",\"type\":\"Location\",\"relationName\":\"CountryToLocation\"}],\"dbName\":\"countries\"},\"LocationLevel\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"countryId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"levelName\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"levelOrder\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"isActive\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"createdById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"updatedById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"LocationLevelToWorkspace\"},{\"name\":\"country\",\"kind\":\"object\",\"type\":\"Country\",\"relationName\":\"CountryToLocationLevel\"},{\"name\":\"createdBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"LocationLevelCreatedBy\"},{\"name\":\"updatedBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"LocationLevelUpdatedBy\"},{\"name\":\"locations\",\"kind\":\"object\",\"type\":\"Location\",\"relationName\":\"LocationToLocationLevel\"}],\"dbName\":\"location_levels\"},\"Location\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"type\",\"kind\":\"enum\",\"type\":\"LocationType\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"countryId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"levelId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"isActive\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"createdById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"updatedById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"parentId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"parent\",\"kind\":\"object\",\"type\":\"Location\",\"relationName\":\"LocationHierarchy\"},{\"name\":\"children\",\"kind\":\"object\",\"type\":\"Location\",\"relationName\":\"LocationHierarchy\"},{\"name\":\"country\",\"kind\":\"object\",\"type\":\"Country\",\"relationName\":\"CountryToLocation\"},{\"name\":\"level\",\"kind\":\"object\",\"type\":\"LocationLevel\",\"relationName\":\"LocationToLocationLevel\"},{\"name\":\"assignedUsers\",\"kind\":\"object\",\"type\":\"UserLocationAssignment\",\"relationName\":\"LocationToUserLocationAssignment\"},{\"name\":\"usersAtCountry\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"UserCountry\"},{\"name\":\"usersAtState\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"UserState\"},{\"name\":\"usersAtDistrict\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"UserDistrict\"},{\"name\":\"holidaysAtCountry\",\"kind\":\"object\",\"type\":\"Holiday\",\"relationName\":\"HolidayCountry\"},{\"name\":\"holidaysAtState\",\"kind\":\"object\",\"type\":\"Holiday\",\"relationName\":\"HolidayState\"},{\"name\":\"holidaysAtDistrict\",\"kind\":\"object\",\"type\":\"Holiday\",\"relationName\":\"HolidayDistrict\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":\"locations\"},\"UserLocationAssignment\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"userId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"user\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"UserToUserLocationAssignment\"},{\"name\":\"locationId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"location\",\"kind\":\"object\",\"type\":\"Location\",\"relationName\":\"LocationToUserLocationAssignment\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":\"user_location_assignments\"},\"TargetType\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"description\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"settings\",\"kind\":\"object\",\"type\":\"TargetSetting\",\"relationName\":\"TargetSettingToTargetType\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":\"target_types\"},\"TargetCycle\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"totalDays\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdBy\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"TargetCycleToWorkspace\"},{\"name\":\"ranges\",\"kind\":\"object\",\"type\":\"TargetCycleRange\",\"relationName\":\"TargetCycleToTargetCycleRange\"},{\"name\":\"targets\",\"kind\":\"object\",\"type\":\"TargetSetting\",\"relationName\":\"TargetCycleToTargetSetting\"}],\"dbName\":\"target_cycles\"},\"TargetCycleRange\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"targetCycleId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"startDay\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"endDay\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"targetCycle\",\"kind\":\"object\",\"type\":\"TargetCycle\",\"relationName\":\"TargetCycleToTargetCycleRange\"}],\"dbName\":\"target_cycle_ranges\"},\"LeadLifeCycle\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"isDefault\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdBy\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"LeadLifeCycleToWorkspace\"},{\"name\":\"transitions\",\"kind\":\"object\",\"type\":\"LeadLifeCycleTransition\",\"relationName\":\"LeadLifeCycleToLeadLifeCycleTransition\"},{\"name\":\"leads\",\"kind\":\"object\",\"type\":\"Lead\",\"relationName\":\"LeadToLeadLifeCycle\"}],\"dbName\":\"lead_life_cycles\"},\"Lead\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"email\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"phone\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"expectedRevenue\",\"kind\":\"scalar\",\"type\":\"Float\"},{\"name\":\"generatedRevenue\",\"kind\":\"scalar\",\"type\":\"Float\"},{\"name\":\"assignedToId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"stageId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"lifecycleId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"sourceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"nextFollowUpAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"stageEnteredAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"stageExpiresAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"slaAction\",\"kind\":\"enum\",\"type\":\"LeadExpiryAction\"},{\"name\":\"slaWarningDays\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"approvalState\",\"kind\":\"enum\",\"type\":\"LeadApprovalState\"},{\"name\":\"pendingApprovalToStageId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"pendingApprovalRequestedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"isClosed\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"isLOB\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"closedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"closedById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"closureType\",\"kind\":\"enum\",\"type\":\"LeadClosureType\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"assignedTo\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"LeadAssignedTo\"},{\"name\":\"stage\",\"kind\":\"object\",\"type\":\"LeadStage\",\"relationName\":\"LeadToLeadStage\"},{\"name\":\"lifecycle\",\"kind\":\"object\",\"type\":\"LeadLifeCycle\",\"relationName\":\"LeadToLeadLifeCycle\"},{\"name\":\"source\",\"kind\":\"object\",\"type\":\"LeadSource\",\"relationName\":\"LeadToLeadSource\"},{\"name\":\"createdBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"LeadCreatedBy\"},{\"name\":\"closedBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"LeadClosedBy\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"LeadToWorkspace\"},{\"name\":\"followUps\",\"kind\":\"object\",\"type\":\"FollowUp\",\"relationName\":\"FollowUpToLead\"},{\"name\":\"lobLogs\",\"kind\":\"object\",\"type\":\"LeadLOBLog\",\"relationName\":\"LeadToLeadLOBLog\"},{\"name\":\"activities\",\"kind\":\"object\",\"type\":\"LeadActivity\",\"relationName\":\"LeadToLeadActivity\"},{\"name\":\"stageApprovals\",\"kind\":\"object\",\"type\":\"LeadStageApproval\",\"relationName\":\"LeadToLeadStageApproval\"}],\"dbName\":\"leads\"},\"LeadLOBLog\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"leadId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"reasonId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"remarks\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"changedById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"changedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"lead\",\"kind\":\"object\",\"type\":\"Lead\",\"relationName\":\"LeadToLeadLOBLog\"}],\"dbName\":\"lead_lob_logs\"},\"LOBReason\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"enum\",\"type\":\"LOBReasonStatus\"},{\"name\":\"createdById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"updatedById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"LOBReasonToWorkspace\"},{\"name\":\"createdBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"LOBReasonCreatedBy\"},{\"name\":\"updatedBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"LOBReasonUpdatedBy\"}],\"dbName\":\"lob_reasons\"},\"LeadStageApproval\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"leadId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"fromStageId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"toStageId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"requestedById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"assignedToId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"enum\",\"type\":\"LeadApprovalStatus\"},{\"name\":\"comment\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"requestData\",\"kind\":\"scalar\",\"type\":\"Json\"},{\"name\":\"approvedById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"approvedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"LeadStageApprovalToWorkspace\"},{\"name\":\"lead\",\"kind\":\"object\",\"type\":\"Lead\",\"relationName\":\"LeadToLeadStageApproval\"},{\"name\":\"fromStage\",\"kind\":\"object\",\"type\":\"LeadStage\",\"relationName\":\"LeadStageApprovalFromStage\"},{\"name\":\"toStage\",\"kind\":\"object\",\"type\":\"LeadStage\",\"relationName\":\"LeadStageApprovalToStage\"},{\"name\":\"requestedBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"LeadStageApprovalRequestedBy\"},{\"name\":\"assignedTo\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"LeadStageApprovalAssignedTo\"},{\"name\":\"approvedBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"LeadStageApprovalApprovedBy\"}],\"dbName\":\"lead_stage_approvals\"},\"LeadLifeCycleTransition\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"lifecycleId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"lifecycle\",\"kind\":\"object\",\"type\":\"LeadLifeCycle\",\"relationName\":\"LeadLifeCycleToLeadLifeCycleTransition\"},{\"name\":\"fromStageId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"toStageId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"numberOfDays\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"expiryAction\",\"kind\":\"enum\",\"type\":\"LeadExpiryAction\"},{\"name\":\"warningDays\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"sortOrder\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":\"lead_life_cycle_transitions\"},\"LeadDynamicField\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"inputType\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"sortOrder\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"isRequired\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"isActive\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"LeadDynamicFieldToWorkspace\"},{\"name\":\"options\",\"kind\":\"object\",\"type\":\"LeadDynamicOption\",\"relationName\":\"LeadDynamicFieldToLeadDynamicOption\"},{\"name\":\"values\",\"kind\":\"object\",\"type\":\"LeadDynamicValue\",\"relationName\":\"LeadDynamicFieldToLeadDynamicValue\"}],\"dbName\":\"lead_dynamic_fields\"},\"LeadDynamicOption\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"fieldId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"value\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"sortOrder\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"field\",\"kind\":\"object\",\"type\":\"LeadDynamicField\",\"relationName\":\"LeadDynamicFieldToLeadDynamicOption\"}],\"dbName\":\"lead_dynamic_options\"},\"LeadDynamicValue\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"leadId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"fieldId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"value\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"field\",\"kind\":\"object\",\"type\":\"LeadDynamicField\",\"relationName\":\"LeadDynamicFieldToLeadDynamicValue\"}],\"dbName\":\"lead_dynamic_values\"},\"LeadActivity\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"leadId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"performedById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"action\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"metadata\",\"kind\":\"scalar\",\"type\":\"Json\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"lead\",\"kind\":\"object\",\"type\":\"Lead\",\"relationName\":\"LeadToLeadActivity\"},{\"name\":\"performedBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"LeadActivityPerformedBy\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"LeadActivityToWorkspace\"}],\"dbName\":\"lead_activities\"},\"TargetSetting\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"user\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"TargetSettingToUser\"},{\"name\":\"userId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"targetType\",\"kind\":\"object\",\"type\":\"TargetType\",\"relationName\":\"TargetSettingToTargetType\"},{\"name\":\"targetTypeId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"cycle\",\"kind\":\"enum\",\"type\":\"TargetSettingCycle\"},{\"name\":\"targetCycleId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"targetCycle\",\"kind\":\"object\",\"type\":\"TargetCycle\",\"relationName\":\"TargetCycleToTargetSetting\"},{\"name\":\"monthlyTargetLeads\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"dailyFollowupTarget\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"revenueTarget\",\"kind\":\"scalar\",\"type\":\"Float\"},{\"name\":\"startDate\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"endDate\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":\"target_settings\"},\"TargetViolation\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"user\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"TargetViolationToUser\"},{\"name\":\"userId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"date\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"type\",\"kind\":\"enum\",\"type\":\"ViolationType\"},{\"name\":\"attemptCount\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"message\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":\"target_violations\"},\"User\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"username\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"email\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"password\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"phone\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"googleId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"isOnboarded\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"isActive\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"isEmailVerified\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"isLocked\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"verificationToken\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"verificationTokenExpires\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"invitationToken\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"invitationExpires\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"role\",\"kind\":\"object\",\"type\":\"Role\",\"relationName\":\"RoleToUser\"},{\"name\":\"roleId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"WorkspaceMembers\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"ownedWorkspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"WorkspaceOwner\"},{\"name\":\"department\",\"kind\":\"object\",\"type\":\"Department\",\"relationName\":\"DepartmentToUser\"},{\"name\":\"departmentId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"office\",\"kind\":\"object\",\"type\":\"Office\",\"relationName\":\"OfficeToUser\"},{\"name\":\"officeId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"countryId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"country\",\"kind\":\"object\",\"type\":\"Location\",\"relationName\":\"UserCountry\"},{\"name\":\"stateId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"state\",\"kind\":\"object\",\"type\":\"Location\",\"relationName\":\"UserState\"},{\"name\":\"districtId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"district\",\"kind\":\"object\",\"type\":\"Location\",\"relationName\":\"UserDistrict\"},{\"name\":\"assignedLocations\",\"kind\":\"object\",\"type\":\"UserLocationAssignment\",\"relationName\":\"UserToUserLocationAssignment\"},{\"name\":\"supervisor\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"UserSupervisor\"},{\"name\":\"supervisorId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"subordinates\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"UserSupervisor\"},{\"name\":\"targetSettings\",\"kind\":\"object\",\"type\":\"TargetSetting\",\"relationName\":\"TargetSettingToUser\"},{\"name\":\"violations\",\"kind\":\"object\",\"type\":\"TargetViolation\",\"relationName\":\"TargetViolationToUser\"},{\"name\":\"devices\",\"kind\":\"object\",\"type\":\"Device\",\"relationName\":\"DeviceToUser\"},{\"name\":\"auditLogs\",\"kind\":\"object\",\"type\":\"AuditLog\",\"relationName\":\"AuditLogToUser\"},{\"name\":\"performedLeadActivities\",\"kind\":\"object\",\"type\":\"LeadActivity\",\"relationName\":\"LeadActivityPerformedBy\"},{\"name\":\"requestedLeadStageApprovals\",\"kind\":\"object\",\"type\":\"LeadStageApproval\",\"relationName\":\"LeadStageApprovalRequestedBy\"},{\"name\":\"assignedLeadStageApprovals\",\"kind\":\"object\",\"type\":\"LeadStageApproval\",\"relationName\":\"LeadStageApprovalAssignedTo\"},{\"name\":\"approvedLeadStageApprovals\",\"kind\":\"object\",\"type\":\"LeadStageApproval\",\"relationName\":\"LeadStageApprovalApprovedBy\"},{\"name\":\"rosterEntries\",\"kind\":\"object\",\"type\":\"RosterEntry\",\"relationName\":\"RosterEntryToUser\"},{\"name\":\"followUps\",\"kind\":\"object\",\"type\":\"FollowUp\",\"relationName\":\"FollowUpToUser\"},{\"name\":\"createdLeads\",\"kind\":\"object\",\"type\":\"Lead\",\"relationName\":\"LeadCreatedBy\"},{\"name\":\"assignedLeads\",\"kind\":\"object\",\"type\":\"Lead\",\"relationName\":\"LeadAssignedTo\"},{\"name\":\"closedLeads\",\"kind\":\"object\",\"type\":\"Lead\",\"relationName\":\"LeadClosedBy\"},{\"name\":\"createdHolidays\",\"kind\":\"object\",\"type\":\"Holiday\",\"relationName\":\"HolidayCreatedBy\"},{\"name\":\"updatedHolidays\",\"kind\":\"object\",\"type\":\"Holiday\",\"relationName\":\"HolidayUpdatedBy\"},{\"name\":\"createdCountries\",\"kind\":\"object\",\"type\":\"Country\",\"relationName\":\"CountryCreatedBy\"},{\"name\":\"updatedCountries\",\"kind\":\"object\",\"type\":\"Country\",\"relationName\":\"CountryUpdatedBy\"},{\"name\":\"createdLocationLevels\",\"kind\":\"object\",\"type\":\"LocationLevel\",\"relationName\":\"LocationLevelCreatedBy\"},{\"name\":\"updatedLocationLevels\",\"kind\":\"object\",\"type\":\"LocationLevel\",\"relationName\":\"LocationLevelUpdatedBy\"},{\"name\":\"createdLOBReasons\",\"kind\":\"object\",\"type\":\"LOBReason\",\"relationName\":\"LOBReasonCreatedBy\"},{\"name\":\"updatedLOBReasons\",\"kind\":\"object\",\"type\":\"LOBReason\",\"relationName\":\"LOBReasonUpdatedBy\"},{\"name\":\"createdReportTypes\",\"kind\":\"object\",\"type\":\"ReportType\",\"relationName\":\"ReportTypeCreatedBy\"},{\"name\":\"updatedReportTypes\",\"kind\":\"object\",\"type\":\"ReportType\",\"relationName\":\"ReportTypeUpdatedBy\"},{\"name\":\"createdReports\",\"kind\":\"object\",\"type\":\"Report\",\"relationName\":\"ReportCreatedBy\"},{\"name\":\"generatedReportLogs\",\"kind\":\"object\",\"type\":\"ReportLog\",\"relationName\":\"ReportLogGeneratedBy\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":\"users\"},\"FollowUp\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"leadId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"userId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"type\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"description\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"scheduledAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"completedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"user\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"FollowUpToUser\"},{\"name\":\"lead\",\"kind\":\"object\",\"type\":\"Lead\",\"relationName\":\"FollowUpToLead\"},{\"name\":\"images\",\"kind\":\"object\",\"type\":\"FollowUpImage\",\"relationName\":\"FollowUpToFollowUpImage\"}],\"dbName\":\"follow_ups\"},\"FollowUpImage\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"followUpId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"url\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"followUp\",\"kind\":\"object\",\"type\":\"FollowUp\",\"relationName\":\"FollowUpToFollowUpImage\"}],\"dbName\":\"follow_up_images\"},\"RosterEntry\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"userId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"rosterType\",\"kind\":\"enum\",\"type\":\"RosterType\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"startDate\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"endDate\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"shiftSession\",\"kind\":\"enum\",\"type\":\"ShiftSession\"},{\"name\":\"shiftStartTime\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"shiftEndTime\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"status\",\"kind\":\"enum\",\"type\":\"RosterStatus\"},{\"name\":\"createdBy\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"user\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"RosterEntryToUser\"}],\"dbName\":\"roster_entries\"},\"AuditLog\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"userId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"user\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"AuditLogToUser\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"action\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"entityType\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"entityId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"details\",\"kind\":\"scalar\",\"type\":\"Json\"},{\"name\":\"ipAddress\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"userAgent\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":\"audit_logs\"},\"Device\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"deviceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"os\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"browser\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"deviceType\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"ipAddress\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"lastActive\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"user\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"DeviceToUser\"},{\"name\":\"userId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"}],\"dbName\":\"devices\"},\"Holiday\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"holidayDate\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"countryId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"stateId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"districtId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"isRecurring\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"recurrenceRule\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"source\",\"kind\":\"enum\",\"type\":\"HolidaySource\"},{\"name\":\"status\",\"kind\":\"enum\",\"type\":\"HolidayStatus\"},{\"name\":\"createdById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"updatedById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"HolidayToWorkspace\"},{\"name\":\"country\",\"kind\":\"object\",\"type\":\"Location\",\"relationName\":\"HolidayCountry\"},{\"name\":\"state\",\"kind\":\"object\",\"type\":\"Location\",\"relationName\":\"HolidayState\"},{\"name\":\"district\",\"kind\":\"object\",\"type\":\"Location\",\"relationName\":\"HolidayDistrict\"},{\"name\":\"createdBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"HolidayCreatedBy\"},{\"name\":\"updatedBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"HolidayUpdatedBy\"}],\"dbName\":\"holidays\"},\"HolidaySyncLog\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"source\",\"kind\":\"enum\",\"type\":\"HolidaySource\"},{\"name\":\"status\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"message\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"syncedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"HolidaySyncLogToWorkspace\"}],\"dbName\":\"holiday_sync_logs\"},\"ReportType\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"name\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"module\",\"kind\":\"enum\",\"type\":\"ReportModule\"},{\"name\":\"baseDataSource\",\"kind\":\"enum\",\"type\":\"ReportBaseDataSource\"},{\"name\":\"description\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"allowedFilters\",\"kind\":\"scalar\",\"type\":\"Json\"},{\"name\":\"status\",\"kind\":\"enum\",\"type\":\"ReportTypeStatus\"},{\"name\":\"createdById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"updatedById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"ReportTypeToWorkspace\"},{\"name\":\"createdBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"ReportTypeCreatedBy\"},{\"name\":\"updatedBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"ReportTypeUpdatedBy\"},{\"name\":\"logs\",\"kind\":\"object\",\"type\":\"ReportLog\",\"relationName\":\"ReportLogToReportType\"},{\"name\":\"reports\",\"kind\":\"object\",\"type\":\"Report\",\"relationName\":\"ReportToReportType\"}],\"dbName\":\"report_types\"},\"ReportLog\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"reportTypeId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"reportId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"generatedById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"action\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"filters\",\"kind\":\"scalar\",\"type\":\"Json\"},{\"name\":\"resultCount\",\"kind\":\"scalar\",\"type\":\"Int\"},{\"name\":\"meta\",\"kind\":\"scalar\",\"type\":\"Json\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"ReportLogToWorkspace\"},{\"name\":\"reportType\",\"kind\":\"object\",\"type\":\"ReportType\",\"relationName\":\"ReportLogToReportType\"},{\"name\":\"report\",\"kind\":\"object\",\"type\":\"Report\",\"relationName\":\"ReportInstanceLogs\"},{\"name\":\"generatedBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"ReportLogGeneratedBy\"}],\"dbName\":\"report_logs\"},\"Report\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"workspaceId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"reportName\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"reportTypeId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"reportDate\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"isActive\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"isGenerated\",\"kind\":\"scalar\",\"type\":\"Boolean\"},{\"name\":\"generatedFileUrl\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"generatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"createdById\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"updatedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"deletedAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"workspace\",\"kind\":\"object\",\"type\":\"Workspace\",\"relationName\":\"ReportToWorkspace\"},{\"name\":\"reportType\",\"kind\":\"object\",\"type\":\"ReportType\",\"relationName\":\"ReportToReportType\"},{\"name\":\"createdBy\",\"kind\":\"object\",\"type\":\"User\",\"relationName\":\"ReportCreatedBy\"},{\"name\":\"filters\",\"kind\":\"object\",\"type\":\"ReportFilter\",\"relationName\":\"ReportToReportFilter\"},{\"name\":\"logs\",\"kind\":\"object\",\"type\":\"ReportLog\",\"relationName\":\"ReportInstanceLogs\"}],\"dbName\":\"reports\"},\"ReportFilter\":{\"fields\":[{\"name\":\"id\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"reportId\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"filterKey\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"filterValue\",\"kind\":\"scalar\",\"type\":\"String\"},{\"name\":\"createdAt\",\"kind\":\"scalar\",\"type\":\"DateTime\"},{\"name\":\"report\",\"kind\":\"object\",\"type\":\"Report\",\"relationName\":\"ReportToReportFilter\"}],\"dbName\":\"report_filters\"}},\"enums\":{},\"types\":{}}")
defineDmmfProperty(exports.Prisma, config.runtimeDataModel)
config.engineWasm = {
  getRuntime: () => require('./query_engine_bg.js'),
  getQueryEngineWasmModule: async () => {
    const loader = (await import('#wasm-engine-loader')).default
    const engine = (await loader).default
    return engine 
  }
}

config.injectableEdgeEnv = () => ({
  parsed: {
    DATABASE_URL: typeof globalThis !== 'undefined' && globalThis['DATABASE_URL'] || typeof process !== 'undefined' && process.env && process.env.DATABASE_URL || undefined
  }
})

if (typeof globalThis !== 'undefined' && globalThis['DEBUG'] || typeof process !== 'undefined' && process.env && process.env.DEBUG || undefined) {
  Debug.enable(typeof globalThis !== 'undefined' && globalThis['DEBUG'] || typeof process !== 'undefined' && process.env && process.env.DEBUG || undefined)
}

const PrismaClient = getPrismaClient(config)
exports.PrismaClient = PrismaClient
Object.assign(exports, Prisma)

