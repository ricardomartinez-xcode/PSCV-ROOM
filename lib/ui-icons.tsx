import {
  Bell,
  BookOpen,
  Brain,
  CalendarDays,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  FileText,
  FolderOpen,
  GraduationCap,
  Layers3,
  ListTodo,
  Network,
  Presentation,
  Users,
  type LucideIcon,
} from "lucide-react";

const ICON_REGISTRY: Record<string, LucideIcon> = {
  bell: Bell,
  book: BookOpen,
  "book-open": BookOpen,
  brain: Brain,
  calendar: CalendarDays,
  "calendar-days": CalendarDays,
  "check-circle": CheckCircle2,
  clipboard: ClipboardCheck,
  "clipboard-check": ClipboardCheck,
  file: FileText,
  "file-text": FileText,
  folder: FolderOpen,
  "folder-check": FolderOpen,
  graduation: GraduationCap,
  layers: Layers3,
  network: Network,
  presentation: Presentation,
  task: ListTodo,
  users: Users,
};

export const UI_ICON_OPTIONS = Object.keys(ICON_REGISTRY).sort();

export function resolveUiIcon(name: string | null | undefined): LucideIcon {
  const normalized = name?.trim().toLocaleLowerCase("en") ?? "";
  return ICON_REGISTRY[normalized] ?? CircleHelp;
}

export function UiIcon({ name, size = 18, className }: { name: string | null | undefined; size?: number; className?: string }) {
  const Icon = resolveUiIcon(name);
  return <Icon size={size} className={className} aria-hidden="true" />;
}
