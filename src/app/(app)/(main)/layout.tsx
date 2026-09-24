import { AppShell } from "@/components/shell/app-shell";
import { requireUser } from "@/lib/auth/session";

export default async function MainLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  return <AppShell user={{ name: user.name, email: user.email }}>{children}</AppShell>;
}
