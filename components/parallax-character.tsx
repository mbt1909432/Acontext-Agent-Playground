"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

export function ParallaxCharacter() {
  const [scrollY, setScrollY] = useState(0);

  useEffect(() => {
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          setScrollY(window.scrollY || window.pageYOffset || document.documentElement.scrollTop);
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Calculate parallax offset (character moves opposite to scroll direction)
  // Negative value: character moves up when scrolling down, moves down when scrolling up
  const parallaxOffset = scrollY * -0.02; // Adjust this value to control movement speed (-0.02 = 2% of scroll speed, opposite direction)

  return (
    <div className="fixed inset-0 z-0 pointer-events-none">
      {/* Adjust vertical position: modify the following parameters to control vertical positioning
          Vertical alignment: items-end (bottom) | items-center (center) | items-start (top)
          Bottom spacing: lg:pb-0 (bottom aligned) | lg:pb-10 (move up) | lg:pb-20 (more down)
          Top spacing: lg:pt-20 (position from top)
          Horizontal position: lg:pl-[800px] (adjust left margin to place character on the right side of text) */}
      <div className="absolute inset-0 flex items-end justify-center lg:justify-start lg:items-start lg:pl-[800px] lg:pt-[00px]">
        <div 
          className="relative w-full max-w-[420px] lg:max-w-[360px] xl:max-w-[580px] opacity-100 dark:opacity-80"
          style={{
            transform: `translateY(${parallaxOffset}px)`,
            willChange: 'transform',
          }}
        >
          <Image
            src="/fonts/ppt girl.png"
            alt="PPT Girl"
            width={800}
            height={800}
            className="w-full h-auto object-contain rounded-3xl shadow-[0_40px_120px_rgba(0,0,0,0.0)]"
            priority
          />
        </div>
      </div>
      {/* Gradient overlay for better text readability */}
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-transparent lg:bg-gradient-to-l lg:from-transparent lg:via-background/60 lg:to-background dark:from-[#0b0b0f] dark:via-[#0b0b0f]/80 dark:to-transparent" />
    </div>
  );
}

