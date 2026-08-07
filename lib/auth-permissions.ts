import type { Profile } from "./app-data.ts";

export type AuthSessionProfile = Profile;
type PermissionProfile = Pick<
  AuthSessionProfile,
  | "role"
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
export const MICROSOFT_LOGOUT_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/logout";

const EMPTY_CAPABILITIES: SessionCapabilities = {
  isStudent: false,
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

export function getRoleLabel(profile: Pick<AuthSessionProfile, "role"> | null | undefined) {
  if (profile?.role === "owner") return "Propietario";
  if (profile?.role === "admin") return "Administrador";
  return "Alumno";
}

export function getSessionCapabilities(profile: PermissionProfile | null | undefined): SessionCapabilities {
  if (!profile) return EMPTY_CAPABILITIES;
  const isOwner = profile.role === "owner";
  const isAdmin = profile.role === "admin";
  const isStudent = profile.role === "student";

  const capabilities: SessionCapabilities = {
    isStudent,
    isAdmin,
    isOwner,
    canAccessAdmin: false,
    canEditTasks: isOwner || (isAdmin && profile.canEditTasks),
    canDeleteTasks: isOwner || (isAdmin && profile.canDeleteTasks),
    canManageMaterials: isOwner || (isAdmin && profile.canManageMaterials),
    canManageUsers: isOwner || (isAdmin && profile.canManageUsers),
    canManageSettings: isOwner || (isAdmin && profile.canManageSettings),
    canManageGroup: isOwner || (isAdmin && profile.canManageGroup),
    canManageNotifications: isOwner || (isAdmin && profile.canManageNotifications),
    canViewReports: isOwner || (isAdmin && profile.canViewReports),
    canManageR2: isOwner || (isAdmin && profile.canManageR2),
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
