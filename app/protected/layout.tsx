import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";

export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      {/* Top navigation */}
      <nav className="flex-shrink-0 border-b bg-card/50 backdrop-blur-sm">
        <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center justify-between px-6 lg:px-12">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="flex items-center gap-2"
            >
              <Image
                src="/fonts/ppt girl.png"
                alt="PPT Girl"
                width={100}
                height={100}
                className="h-8 w-8 rounded-full border-2 border-primary/50 shadow-md ring-1 ring-primary/20 object-cover object-top"
                priority
              />
              <span className="text-sm font-semibold tracking-tight">
                PPT Girl
              </span>
            </Link>
            <Link href="/">
              <Button variant="ghost" size="sm">
                ← Back to Home
              </Button>
            </Link>
          </div>

          <div className="flex items-center gap-4">
            <Suspense>
              <AuthButton />
            </Suspense>
            <ThemeSwitcher />
          </div>
        </div>
      </nav>

      {/* Main content area */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {children}
      </div>
    </main>
  );
}
