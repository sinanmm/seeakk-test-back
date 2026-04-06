
Object.defineProperty(exports, "__esModule", { value: true });

const {
  Decimal,
  objectEnumValues,
  makeStrictEnum,
  Public,
  getRuntime,
  skip
} = require('./runtime/index-browser.js')


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

Prisma.PrismaClientKnownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientKnownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)};
Prisma.PrismaClientUnknownRequestError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientUnknownRequestError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientRustPanicError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientRustPanicError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientInitializationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientInitializationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.PrismaClientValidationError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`PrismaClientValidationError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.NotFoundError = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`NotFoundError is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.Decimal = Decimal

/**
 * Re-export of sql-template-tag
 */
Prisma.sql = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`sqltag is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.empty = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`empty is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.join = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`join is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.raw = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`raw is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.validator = Public.validator

/**
* Extensions
*/
Prisma.getExtensionContext = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.getExtensionContext is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}
Prisma.defineExtension = () => {
  const runtimeName = getRuntime().prettyName;
  throw new Error(`Extensions.defineExtension is unable to run in this browser environment, or has been bundled for the browser (running in ${runtimeName}).
In case this error is unexpected for you, please report it in https://pris.ly/prisma-prisma-bug-report`,
)}

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

exports.Prisma.LocationScalarFieldEnum = {
  id: 'id',
  name: 'name',
  type: 'type',
  workspaceId: 'workspaceId',
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
  generatedById: 'generatedById',
  filters: 'filters',
  resultCount: 'resultCount',
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
  Location: 'Location',
  UserLocationAssignment: 'UserLocationAssignment',
  TargetType: 'TargetType',
  TargetCycle: 'TargetCycle',
  TargetCycleRange: 'TargetCycleRange',
  LeadLifeCycle: 'LeadLifeCycle',
  Lead: 'Lead',
  LeadLOBLog: 'LeadLOBLog',
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
  ReportLog: 'ReportLog'
};

/**
 * This is a stub Prisma Client that will error at runtime if called.
 */
class PrismaClient {
  constructor() {
    return new Proxy(this, {
      get(target, prop) {
        let message
        const runtime = getRuntime()
        if (runtime.isEdge) {
          message = `PrismaClient is not configured to run in ${runtime.prettyName}. In order to run Prisma Client on edge runtime, either:
- Use Prisma Accelerate: https://pris.ly/d/accelerate
- Use Driver Adapters: https://pris.ly/d/driver-adapters
`;
        } else {
          message = 'PrismaClient is unable to run in this browser environment, or has been bundled for the browser (running in `' + runtime.prettyName + '`).'
        }
        
        message += `
If this is unexpected, please open an issue: https://pris.ly/prisma-prisma-bug-report`

        throw new Error(message)
      }
    })
  }
}

exports.PrismaClient = PrismaClient

Object.assign(exports, Prisma)
