import type { Profile } from "./app-data.ts";

export type AuthSessionProfile = Profile;
type PermissionProfile = Pick<
  AuthSessionProfile,
  | "role"
  | "profileRole"
  | "canEditTasks"
  | "canDeleteTasks"
  | "canManageMaterials"
  | "canManageUsers"
  | "canManageSettings"
  | "canManageGroup"
  | "canManageNotifications"
  | "canViewReports"
  | "canManageR2"
>;

export type AdminTabId =
  | "general"
  | "tasks"
  | "courses"
  | "sections"
  | "materials"
  | "users"
  | "notifications"
  | "reports"
  | "diagnostics";

export type SessionCapabilities = {
  isStudent: boolean;
  isProfessor: boolean;
  canViewAttendance: boolean;
  canManageAttendance: boolean;
  isAdmin: boolean;
  isOwner: boolean;
  canAccessAdmin: boolean;
  canEditTasks: boolean;
  canDeleteTasks: boolean;
  canManageMaterials: boolean;
  canManageUsers: boolean;
  canManageSettings: boolean;
  canManageGroup: boolean;
  canManageNotifications: boolean;
  canViewReports: boolean;
  canManageR2: boolean;
};

export const ACCESS_LOGOUT_PATH = "/cdn-cgi/access/logout";

const EMPTY_CAPABILITIES: SessionCapabilities = {
  isStudent: false,
  isProfessor: false,
  canViewAttendance: false,
  canManageAttendance: false,
  isAdmin: false,
  isOwner: false,
  canAccessAdmin: false,
  canEditTasks: false,
  canDeleteTasks: false,
  canManageMaterials: false,
  canManageUsers: false,
  canManageSettings: false,
  canManageGroup: false,
  canManageNotifications: false,
  canViewReports: false,
  canManageR2: false,
};

export function getRoleLabel(profile: Pick<AuthSessionProfile, "role" | "profileRole"> | null | undefined) {
  if (profile?.profileRole === "professor") return "Profesor";
  if (profile?.profileRole === "administrator" || profile?.role === "owner" || profile?.role === "admin") return "Administrador";
  return "Alumno";
}

export function getSessionCapabilities(profile: PermissionProfile | null | undefined): SessionCapabilities {
  if (!profile) return EMPTY_CAPABILITIES;
  const isOwner = profile.role === "owner";
  const isAdmin = profile.profileRole === "administrator" && profile.role === "admin";
  const isProfessor = profile.profileRole === "professor";
  const isStudent = profile.profileRole === "student";
  const allowedAdmin = isOwner || isAdmin;

  const capabilities: SessionCapabilities = {
    isStudent,
    isProfessor,
    canViewAttendance: true,
    canManageAttendance: allowedAdmin && (isOwner || profile.canManageGroup) || isProfessor,
    isAdmin,
    isOwner,
    canAccessAdmin: false,
    canEditTasks: isOwner || (allowedAdmin && profile.canEditTasks),
    canDeleteTasks: isOwner || (allowedAdmin && profile.canDeleteTasks),
    canManageMaterials: isOwner || (allowedAdmin && profile.canManageMaterials),
    canManageUsers: isOwner || (allowedAdmin && profile.canManageUsers),
    canManageSettings: isOwner || (allowedAdmin && profile.canManageSettings),
    canManageGroup: isOwner || (allowedAdmin && profile.canManageGroup),
    canManageNotifications: isOwner || (allowedAdmin && profile.canManageNotifications),
    canViewReports: isOwner || (allowedAdmin && profile.canViewReports),
    canManageR2: isOwner || (allowedAdmin && profile.canManageR2),
  };

  capabilities.canAccessAdmin = isOwner || Boolean(
    capabilities.canEditTasks ||
    capabilities.canDeleteTasks ||
    capabilities.canManageMaterials ||
    capabilities.canManageUsers ||
    capabilities.canManageSettings ||
    capabilities.canManageGroup ||
    capabilities.canManageNotifications ||
    capabilities.canViewReports ||
    capabilities.canManageR2
  );

  return capabilities;
}

export function canAccessAdminTab(capabilities: SessionCapabilities, tab: AdminTabId) {
  if (!capabilities.canAccessAdmin) return false;
  if (capabilities.isOwner) return true;
  if (tab === "general") return true;
  if (tab === "tasks") return capabilities.canEditTasks;
  if (tab === "courses") return capabilities.canManageSettings;
  if (tab === "sections" || tab === "materials") return capabilities.canManageMaterials;
  if (tab === "users") return capabilities.canManageUsers;
  if (tab === "notifications") return capabilities.canManageNotifications;
  if (tab === "reports") return capabilities.canViewReports;
  if (tab === "diagnostics") return capabilities.canManageR2 || capabilities.canViewReports;
  return false;
}
