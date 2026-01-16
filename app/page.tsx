import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

import { EnvVarWarning } from "@/components/env-var-warning";
import { AuthButton } from "@/components/auth-button";
import { ParallaxCharacter } from "@/components/parallax-character";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { hasEnvVars } from "@/lib/utils";

export default function Home() {
  return (
    <main className="relative min-h-screen bg-background text-foreground dark:bg-[#0b0b0f] dark:text-neutral-50">
      {/* Background Character - Fixed Position with Parallax */}
      <ParallaxCharacter />

      {/* Content Layer */}
      <div className="relative z-10">
        {/* Top navigation */}
        <nav className="relative border-b bg-card/50 backdrop-blur-sm dark:border-neutral-800 dark:bg-neutral-900/60">
          <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center justify-between px-4 sm:px-6 lg:px-12">
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="flex items-center gap-2"
              >
                <Image
                  src="/fonts/ppt girl.png"
                  alt="PPT Girl"
                  width={40}
                  height={40}
                  className="h-10 w-10 rounded-full border-2 border-primary/50 shadow-md ring-1 ring-primary/20 object-cover"
                  priority
                />
                <span className="text-lg font-semibold tracking-tight">
                  Acontext PPT Girl
                </span>
              </Link>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground hidden sm:inline-block">
                Acontext-based AI slide generator for beautiful PPT-style decks
              </span>
              <Suspense>
                <AuthButton />
              </Suspense>
              <ThemeSwitcher />
            </div>
          </div>
        </nav>

        {/* Main Hero Section */}
        <div className="relative min-h-[calc(100vh-4rem)] flex items-center">
          <div className="mx-auto w-full max-w-[1600px] px-4 py-12 sm:px-6 sm:py-16 lg:px-12 lg:py-24">
            <div className="max-w-3xl space-y-8 sm:space-y-10 lg:space-y-12">
              {/* Tag */}
              <div className="animate-slide-up" style={{ animationDelay: '0.2s' }}>
                <Badge variant="secondary" className="text-sm sm:text-base">
                  Acontext PPT Girl · AI Slide Generator
                </Badge>
              </div>

              {/* Main headline */}
              <div className="space-y-6 animate-slide-up" style={{ animationDelay: '0.3s' }}>
                <h1 className="text-5xl font-bold leading-tight sm:text-6xl md:text-7xl lg:text-8xl">
                  <span className="block text-primary">Acontext</span>
                  <span className="block">PPT Girl</span>
                  <span className="block text-primary">Slide Generator</span>
                </h1>
                
                <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl lg:text-2xl">
                  Turn any long text into clean, professional PPT-style slides with the Acontext PPT Girl Slide Generator.
                  Built on Acontext, it helps you outline your deck, confirm the structure, and auto-generate slide-ready
                  images with 16:9 layouts and space for your content.
                </p>
              </div>

              {/* Highlighted Description */}
              <div className="animate-slide-up" style={{ animationDelay: '0.35s' }}>
                <Card className="bg-primary/10 border-primary/30 backdrop-blur-sm shadow-lg dark:bg-neutral-900/70 dark:border-neutral-800 dark:shadow-[0_30px_80px_-50px_rgba(0,0,0,0.9)]">
                  <CardContent className="pt-6">
                    <p className="text-base sm:text-lg font-medium text-foreground leading-relaxed mb-4">
                      Paste your content, let Acontext PPT Girl propose a slide outline, then approve to auto-generate
                      consistent, on-brand slide visuals for each page of your deck.
                    </p>
                    <p className="text-sm sm:text-base text-muted-foreground">
                      Every image is optimized for 16:9 PPT slides, keeping PPT Girl in the background so your text stays readable.
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* CTA section */}
              <div className="space-y-6 animate-slide-up" style={{ animationDelay: '0.4s' }}>
                {hasEnvVars ? (
                  <Link href="/protected" className="inline-block group">
                    <Button 
                      size="lg" 
                      className="text-lg px-8 py-7 h-auto font-semibold transition-all duration-300 group-hover:scale-105 group-hover:shadow-lg"
                    >
                      Start PPT Girl Session
                      <span className="ml-2 transition-transform duration-300 group-hover:translate-x-1">→</span>
                    </Button>
                  </Link>
                ) : (
                  <div className="w-full max-w-md">
                    <EnvVarWarning />
                  </div>
                )}

                {/* Feature tags */}
                <div className="flex flex-wrap gap-3 pt-2">
                {['Auto slide outline', '16:9 PPT visuals', 'Anime assistant style'].map((tag, index) => (
                    <Badge 
                      key={tag} 
                      variant="outline" 
                      className="text-sm transition-all duration-300 hover:bg-primary/10 hover:border-primary/50 dark:bg-neutral-900/60 dark:border-neutral-800"
                      style={{ animationDelay: `${0.5 + index * 0.1}s` }}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Preview Section */}
        <div className="relative py-12 sm:py-16 lg:py-20">
          <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-12">
            <div className="max-w-2xl">
              <Card
                className="backdrop-blur-sm bg-card/80 border-primary/20 shadow-xl animate-slide-up dark:bg-neutral-900/80 dark:border-neutral-800 dark:shadow-[0_30px_80px_-50px_rgba(0,0,0,0.9)]"
                style={{ animationDelay: "0.6s" }}
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xl sm:text-2xl">
                      Example Acontext PPT Girl Flow
                    </CardTitle>
                    <Badge variant="secondary">Sample</Badge>
                  </div>
                    <CardDescription className="text-sm sm:text-base mt-2">
                      See how Acontext PPT Girl turns long-form content into a slide deck with outline confirmation and
                      image generation.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {[
                    {
                      role: "User",
                      content:
                        "Here is my product introduction article. Please turn it into a 10-slide presentation for investors.",
                    },
                    {
                      role: "PPT Girl",
                      content:
                        "I will first propose a 10-slide outline with titles and bullet points. Once you confirm, I will generate 16:9 PPT-style images for each slide with space for your text, powered by Acontext.",
                      tools: "image_generate x10",
                    },
                  ].map((msg, i) => (
                    <div
                      key={i}
                      className="space-y-2 border-l-2 border-primary/30 bg-muted/30 p-4 rounded-r-md transition-all duration-300 hover:bg-muted/50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-foreground">
                          {msg.role}
                        </span>
                        {msg.tools && (
                          <Badge variant="outline" className="text-xs">
                            {msg.tools}
                          </Badge>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed text-foreground">
                        {msg.content}
                      </p>
                    </div>
                  ))}

                  {/* Tool call info */}
                  <div className="mt-6 border-t pt-4">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
                      <span>Slide Image Generation</span>
                      <Badge variant="outline" className="text-xs">
                        10 slides created
                      </Badge>
                    </div>
                    <div className="space-y-1 text-xs font-mono text-muted-foreground">
                      <div className="flex items-center justify-between">
                        <span className="text-primary">
                          ppt_girl.image_generate_batch
                        </span>
                        <span>~25s</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Footer */}
                <footer className="relative border-t bg-card/50 backdrop-blur-sm py-6 sm:py-8">
          <div className="mx-auto w-full max-w-[1600px] px-4 sm:px-6 lg:px-12">
            <div className="text-center">
              <p className="text-xs text-muted-foreground">
                © 2026 Acontext PPT Girl Slide Generator
              </p>
            </div>
          </div>
        </footer>
      </div>
    </main>
  );
}
